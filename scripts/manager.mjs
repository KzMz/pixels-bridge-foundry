import { handleStatus, pendingRoll } from "./handlers.mjs";

/**
 * @typedef {Object} PixelConfiguration
 * @property {string} name              The name of the connected Pixel
 * @property {number} pixelId           The unique pixel device ID.
 * @property {string} denomination      The die denomination.
 * @property {boolean} active           Is this pixel actively connected?
 * @property {number} [batteryLevel]    Battery percentage (from bridge updates)
 * @property {number} [rssi]            RSSI signal strength (from bridge updates)
 */

/**
 * A custom Map which manages Pixels devices via a WebSocket bridge relay.
 * Replaces PixelsManager from the original module — no direct BLE, all proxied via WSS.
 */
export default class BridgeManager extends Map {

  /** @type {WebSocket|null} */
  #ws = null;

  /** @type {string} */
  #relayUrl = "";

  /** @type {boolean} */
  #connected = false;

  /** @type {number|null} */
  #reconnectTimer = null;

  /** @type {number} */
  #reconnectDelay = 1000;

  /* -------------------------------------------- */
  /*  Map Interface                               */
  /* -------------------------------------------- */

  /** @inheritDoc */
  get(k) {
    return super.get(String(k));
  }

  /** @inheritDoc */
  set(k, v) {
    super.set(String(k), v);
    game.settings.set("pixels-bridge", "devices", this.toObject());
    return this;
  }

  /** @inheritDoc */
  delete(k) {
    const r = super.delete(String(k));
    if ( r ) game.settings.set("pixels-bridge", "devices", this.toObject());
    return r;
  }

  /* -------------------------------------------- */
  /*  WebSocket Connection                        */
  /* -------------------------------------------- */

  /** Is the relay WebSocket connected? */
  get relayConnected() {
    return this.#connected;
  }

  /**
   * Connect to the relay server via WebSocket.
   * @param {string} relayUrl   The relay server URL (e.g. "wss://tunnel.trycloudflare.com")
   */
  connectRelay(relayUrl) {
    this.#relayUrl = relayUrl;
    this.#doConnect();
  }

  /**
   * Disconnect from the relay server.
   */
  disconnect() {
    if ( this.#reconnectTimer ) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if ( this.#ws ) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#connected = false;
  }

  /**
   * Check if the relay connection is alive. If not, attempt reconnect.
   */
  checkConnection() {
    if ( !this.#connected && this.#relayUrl ) {
      console.log("Pixels Bridge | Heartbeat: reconnecting to relay");
      this.#doConnect();
    }
  }

  /* -------------------------------------------- */

  #doConnect() {
    if ( this.#ws ) {
      this.#ws.close();
      this.#ws = null;
    }

    const url = this.#relayUrl.replace(/\/$/, "") + "/foundry";
    console.log(`Pixels Bridge | Connecting to relay: ${url}`);

    try {
      this.#ws = new WebSocket(url);
    } catch(err) {
      console.error("Pixels Bridge | Failed to create WebSocket:", err);
      this.#scheduleReconnect();
      return;
    }

    this.#ws.onopen = () => {
      console.log("Pixels Bridge | Connected to relay");
      this.#connected = true;
      this.#reconnectDelay = 1000;
      ui.notifications?.info("PIXELS.ERRORS.BridgeConnected", { localize: true });
      pixelsDice.config?.render();
    };

    this.#ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.#handleMessage(msg);
      } catch(err) {
        console.warn("Pixels Bridge | Invalid message:", event.data);
      }
    };

    this.#ws.onerror = (event) => {
      console.error("Pixels Bridge | WebSocket error");
    };

    this.#ws.onclose = () => {
      console.log("Pixels Bridge | Disconnected from relay");
      const wasConnected = this.#connected;
      this.#connected = false;
      this.#ws = null;
      if ( wasConnected ) {
        ui.notifications?.warn("PIXELS.ERRORS.BridgeDisconnected", { localize: true });
        // Mark all devices as inactive
        for ( const config of this.values() ) {
          if ( config.active ) {
            config.active = false;
          }
        }
        pixelsDice.config?.render();
      }
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect() {
    if ( this.#reconnectTimer ) return;
    console.log(`Pixels Bridge | Reconnecting in ${this.#reconnectDelay}ms`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#doConnect();
    }, this.#reconnectDelay);
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, 30000);
  }

  /* -------------------------------------------- */
  /*  Message Handling                            */
  /* -------------------------------------------- */

  #handleMessage(msg) {
    if ( CONFIG.debug.pixels ) {
      console.debug("Pixels Bridge | Received:", msg);
    }

    switch ( msg.type ) {
      case "roll":
        return this.#onRoll(msg);
      case "deviceConnected":
        return this.#onDeviceConnected(msg);
      case "deviceDisconnected":
        return this.#onDeviceDisconnected(msg);
      case "batteryUpdate":
        return this.#onBatteryUpdate(msg);
      case "rssiUpdate":
        return this.#onRssiUpdate(msg);
    }
  }

  #onRoll({ pixelId, denomination, result, name }) {
    const config = this.get(pixelId);
    if ( !config ) {
      console.warn(`Pixels Bridge | Roll from unknown device: ${pixelId}`);
      return;
    }
    pendingRoll(config, result);
  }

  #onDeviceConnected({ pixelId, name, denomination, batteryLevel }) {
    let config = this.get(pixelId) || {};
    Object.assign(config, {
      pixelId,
      name: name || config.name || `Pixel ${pixelId}`,
      denomination: denomination || config.denomination,
      batteryLevel: batteryLevel ?? config.batteryLevel,
      active: true
    });
    this.set(pixelId, config);
    console.log(`Pixels Bridge | Device connected: ${config.name} (${config.denomination})`);
    pixelsDice.config?.render();
  }

  #onDeviceDisconnected({ pixelId }) {
    const config = this.get(pixelId);
    if ( !config ) return;
    handleStatus(config, "disconnected");
  }

  #onBatteryUpdate({ pixelId, batteryLevel }) {
    const config = this.get(pixelId);
    if ( config ) {
      config.batteryLevel = batteryLevel;
      pixelsDice.config?.render();
    }
  }

  #onRssiUpdate({ pixelId, rssi }) {
    const config = this.get(pixelId);
    if ( config ) {
      config.rssi = rssi;
      pixelsDice.config?.render();
    }
  }

  /* -------------------------------------------- */
  /*  Commands to Bridge                          */
  /* -------------------------------------------- */

  /**
   * Send a command to the bridge via the relay.
   * @param {object} data
   */
  #send(data) {
    if ( this.#ws && this.#ws.readyState === WebSocket.OPEN ) {
      this.#ws.send(JSON.stringify(data));
    }
  }

  /**
   * Request a new device connection (triggers scan on phone app).
   */
  async request() {
    this.#send({ type: "requestDevice" });
    ui.notifications.info("PIXELS.CONFIG.PhonePrompt", { localize: true });
  }

  /**
   * Disconnect a device by its pixel ID.
   * @param {string|number} id
   */
  async disconnectDevice(id) {
    const config = this.get(id);
    if ( !config ) {
      this.delete(id);
      return;
    }
    this.#send({ type: "disconnectDevice", pixelId: Number(id) });
    config.active = false;
    this.set(id, config);
  }

  /**
   * Blink a device by its pixel ID.
   * @param {string|number} id
   */
  blink(id) {
    this.#send({ type: "blink", pixelId: Number(id) });
  }

  /* -------------------------------------------- */
  /*  Saving and Loading                          */
  /* -------------------------------------------- */

  /**
   * Convert the Map to an object for storage as a client setting.
   * @returns {object}
   */
  toObject() {
    const obj = {};
    for ( const [k, { name, pixelId, denomination }] of this.entries() ) {
      obj[k] = { name, pixelId, denomination };
    }
    return obj;
  }

  /**
   * Load and construct the BridgeManager from saved devices.
   * @returns {BridgeManager}
   */
  static fromSetting() {
    const devices = game.settings.get("pixels-bridge", "devices");
    return new this(Object.entries(devices).reduce((arr, [k, v]) => {
      v.active = false;
      if ( v.pixelId ) arr.push([k, v]);
      return arr;
    }, []));
  }
}

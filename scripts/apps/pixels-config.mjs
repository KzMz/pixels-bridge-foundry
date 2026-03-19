const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * An application used for configuration of Pixels dice via the BLE bridge.
 */
export default class PixelsConfiguration extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options) {
    super(options);
    pixelsDice.config = this;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "pixels-configuration",
    classes: ["pixels", "themed", "theme-dark"],
    tag: "form",
    window: {
      title: "PIXELS.CONFIG.Title"
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      disconnectPixel: PixelsConfiguration.#onDisconnectPixel,
      requestPixel: PixelsConfiguration.#onRequestPixel
    }
  };

  /** @override */
  static PARTS = {
    config: {
      template: "modules/pixels-bridge/templates/pixels-config.hbs"
    }
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = {
      connected: [],
      disconnected: [],
      hasDevices: false,
      relayConnected: pixelsDice.PIXELS.relayConnected
    }
    for ( const config of pixelsDice.PIXELS.values() ) {
      const arr = config.active ? context.connected : context.disconnected;
      const icon = config.denomination === "d00" ? "fa-percent" : `fa-dice-${config.denomination}`;

      arr.push({
        rssi: config.rssi,
        cssClass: config.active ? "active" : "inactive",
        name: config.name,
        pixelId: config.pixelId,
        disconnectTooltip: `PIXELS.CONFIG.ACTIONS.${config.active ? "Disconnect" : "Forget"}`,
        denomination: config.denomination,
        denominationIcon: `fa-solid ${icon}`,
        connectionIcon: config.active ? "fa-bluetooth" : "fa-signal-slash",
        battery: config.batteryLevel
      });
    }
    context.hasDevices = (context.connected.length + context.disconnected.length) > 0;
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Forget or disconnect a Pixels die.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDisconnectPixel(event, target) {
    const { pixelId } = target.closest(".pixel").dataset;
    await pixelsDice.PIXELS.disconnectDevice(pixelId);
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Request a new device — sends command to bridge app on phone.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRequestPixel(event, target) {
    target.disabled = true;
    const icon = target.querySelector("i");
    icon.className = "fa-solid fa-spinner fa-spin";
    try {
      await pixelsDice.PIXELS.request();
    } catch(err) {
      ui.notifications.error("PIXELS.ERRORS.ConnectFailed", { localize: true });
      console.error(err);
    }
    // Re-enable after a delay (the phone user needs time to scan + connect)
    setTimeout(() => this.render(), 3000);
  }
}

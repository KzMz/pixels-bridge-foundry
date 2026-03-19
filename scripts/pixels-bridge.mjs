import BridgeManager from "./manager.mjs";
import PixelsConfiguration from "./apps/pixels-config.mjs";
import * as api from "./handlers.mjs";

/* -------------------------------------------- */
/*  Client Initialization                       */
/* -------------------------------------------- */

let reconnectInterval;

Hooks.on("init", function () {

  // Pixels Bridge enabled
  game.settings.register("pixels-bridge", "enabled", {
    scope: "client",
    name: "PIXELS.SETTINGS.ENABLED.Name",
    hint: "PIXELS.SETTINGS.ENABLED.Hint",
    config: true,
    type: Boolean,
    default: false,
    onChange: enabled => {
      module.enabled = enabled;
      _initialize(enabled);
    }
  });

  // Relay URL
  game.settings.register("pixels-bridge", "relayUrl", {
    scope: "client",
    name: "PIXELS.SETTINGS.RELAY.Name",
    hint: "PIXELS.SETTINGS.RELAY.Hint",
    config: true,
    type: String,
    default: "",
    onChange: () => {
      if ( pixelsDice.enabled ) _initialize(true);
    }
  });

  // Unprompted rolls
  game.settings.register("pixels-bridge", "allowUnprompted", {
    scope: "client",
    name: "PIXELS.SETTINGS.UNPROMPTED.Name",
    hint: "PIXELS.SETTINGS.UNPROMPTED.Hint",
    config: true,
    type: Boolean,
    default: true
  });

  // Remember connected devices
  game.settings.register("pixels-bridge", "devices", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Heartbeat interval
  game.settings.register("pixels-bridge", "heartBeatInterval", {
    scope: "client",
    name: "PIXELS.SETTINGS.HEARTBEAT.Name",
    hint: "PIXELS.SETTINGS.HEARTBEAT.Hint",
    config: true,
    type: new foundry.data.fields.NumberField({
      required: true, nullable: false, integer: true, min: 0, max: 60, step: 1, initial: 0
    }),
    onChange: heartBeatInterval => {
      clearInterval(reconnectInterval);
      if ( heartBeatInterval ) {
        reconnectInterval = setInterval(() => pixelsDice.PIXELS.checkConnection(), heartBeatInterval * 60_000);
      }
    }
  });

  // Configuration menu
  game.settings.registerMenu("pixels-bridge", "configuration", {
    name: "PIXELS.SETTINGS.CONFIG.Name",
    label: "PIXELS.SETTINGS.CONFIG.Label",
    icon: "fa-solid fa-dice-d20",
    type: PixelsConfiguration,
    restricted: false
  });

  // Core Dice Configuration — use "pixels" key so existing fulfillment configs work
  CONFIG.Dice.fulfillment.methods.pixels = { label: "Pixels - Electronic Dice (Bridge)", interactive: true };

  // Register module properties
  const module = globalThis.pixelsDice = game.modules.get("pixels-bridge");
  module.enabled = false;
  module.PIXELS = BridgeManager.fromSetting();
  module.api = api;
  module.debounceRoll = foundry.utils.debounce(api.completePendingRoll, 1000);
});

/* -------------------------------------------- */
/*  Client Ready                                */
/* -------------------------------------------- */

Hooks.on("ready", function() {
  const enabled = pixelsDice.enabled = game.settings.get("pixels-bridge", "enabled");
  return _initialize(enabled);
});

/* -------------------------------------------- */

async function _initialize(enabled) {
  if ( !enabled ) {
    pixelsDice.PIXELS.disconnect();
    return;
  }

  const relayUrl = game.settings.get("pixels-bridge", "relayUrl");
  if ( !relayUrl ) {
    ui.notifications.warn("PIXELS.ERRORS.NoRelayUrl", { localize: true });
    return;
  }

  pixelsDice.PIXELS.connectRelay(relayUrl);

  // Schedule heartbeat
  const heartBeatInterval = game.settings.get("pixels-bridge", "heartBeatInterval");
  if ( heartBeatInterval ) {
    clearInterval(reconnectInterval);
    reconnectInterval = setInterval(() => pixelsDice.PIXELS.checkConnection(), heartBeatInterval * 60_000);
  }
}

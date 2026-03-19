import PixelsConfiguration from "./apps/pixels-config.mjs";

/**
 * @typedef PixelsPendingRoll
 * @property {string} denomination  The die denomination.
 * @property {number} result        The roll result.
 */

/**
 * @typedef PixelsRollGroup
 * @property {string} denomination  The die denomination.
 * @property {number[]} results     The results for this denomination.
 */

/**
 * Handle disconnection events from a Pixel device (via bridge).
 * @param {PixelConfiguration} config  The die configuration.
 * @param {string} status              The status.
 * @returns {Promise<void>}
 */
export async function handleStatus(config, status) {
  if ( status !== "disconnected") return;
  if ( !config.active ) return;
  config.active = false;
  pixelsDice.config?.render();
  ui.notifications.warn(game.i18n.format("PIXELS.ERRORS.STATUS.Lost", { name: config.name }));
  // No local reconnect — the bridge app handles BLE reconnection automatically.
  // When the bridge reconnects, it sends a new deviceConnected message.
}

/* -------------------------------------------- */

/**
 * The currently pending rolls.
 * @type {Record<string, PixelsPendingRoll>}
 * @internal
 */
let _pendingRoll = {};

/**
 * Wait for additional physical dice rolls before completing an atomic roll action.
 * @param {PixelConfiguration} config
 * @param {number} result
 */
export function pendingRoll({ denomination, name, pixelId }, result) {
  // Treat a report of 0 on a d10 as a result of 10.
  if ( (denomination === "d10") && (result < 1) ) result = 10;
  if ( CONFIG.debug.pixels ) {
    console.debug(`Pixels Bridge | [${name}] [${pixelId}] Pending roll (${denomination}) - ${result}`);
  }
  _pendingRoll[pixelId] = { denomination, result };
  pixelsDice.debounceRoll();
}

/* -------------------------------------------- */

/**
 * Post an unprompted roll to chat.
 * @param {Record<string, PixelsRollGroup>} groups
 * @returns {Promise<ChatMessage>}
 */
function completeManualRoll(groups) {
  const sorted = Object.values(groups).filter(({ results }) => results.length).sort((a, b) => {
    return Number(b.denomination.slice(1)) - Number(a.denomination.slice(1));
  });

  const formula = sorted.map(group => `${group.results.length}${group.denomination}`).join(" + ");
  const rollData = {
    class: "Roll",
    evaluated: true,
    formula: formula,
    terms: sorted.map(group => {
      return {
        class: "Die",
        evaluated: true,
        number: group.results.length,
        faces: Number(group.denomination.slice(1)),
        modifiers: [],
        results: group.results.map(r => ({active: true, result: r}))
      }
    })
  }
  const roll = Roll.fromData(rollData);
  roll._total = roll._evaluateTotal();
  return roll.toMessage();
}

/* -------------------------------------------- */

/**
 * Submit the pending rolls.
 */
export function completePendingRoll() {
  const groups = Object.values(_pendingRoll).reduce((obj, { denomination, result }) => {
    obj[denomination] ??= { denomination, results: [] };
    obj[denomination].results.push(result);
    return obj;
  }, {});

  _pendingRoll = {};

  // First pass: fulfill requested d10s before d100 conversion
  handleRolls(groups);

  // Detect d100 rolls
  detectD100Rolls(groups);

  // Second pass: fulfill requested d100s
  handleRolls(groups);

  // Unprompted rolls
  const allowUnprompted = game.settings.get("pixels-bridge", "allowUnprompted");
  if ( allowUnprompted && !foundry.utils.isEmpty(groups) ) return completeManualRoll(groups);
}

/* -------------------------------------------- */

/**
 * Detect any d100 rolls in a set of pending rolls.
 * @param {Record<string, PixelsRollGroup>} groups
 */
function detectD100Rolls(groups) {
  if ( CONFIG.debug.pixels ) console.debug("Pixels Bridge | Detecting d100 rolls ", foundry.utils.deepClone(groups));
  if ( !("d10" in groups) ) return;
  const working = foundry.utils.deepClone(groups);

  for ( let i = 0; i < working.d10.results.length; i++ ) {
    let result;
    let d10 = working.d10.results[i];
    let d00 = working.d00?.results[i];

    if ( CONFIG.debug.pixels ) console.debug(`Pixels Bridge | [${i}] Pairing d00 roll with d10 - ${d10}`);

    if ( d00 === undefined ) {
      d00 = working.d10.results[++i];
      if ( CONFIG.debug.pixels ) {
        if ( d00 === undefined ) console.debug(`Pixels Bridge | [${i}] Failed to find another d10 result to pair with`);
        else console.debug(`Pixels Bridge | [${i}] Found d10 result to pair with - ${d00}`);
      }
      if ( d00 === undefined ) break;
      else groups.d10.results = groups.d10.results.slice(2);
    } else {
      if ( CONFIG.debug.pixels ) console.debug(`Pixels Bridge | [${i}] Found d00 result to pair with - ${d00}`);
      groups.d10.results.shift();
      groups.d00.results.shift();
    }

    d10 %= 10;
    if ( (d10 < 1) && (d00 < 1) ) result = 100;
    else result = d00 + d10;

    groups.d100 ??= { denomination: "d100", results: [] };
    groups.d100.results.push(result);
  }

  delete groups.d00;
}

/* -------------------------------------------- */

/**
 * Dispatch pending rolls to any active RollResolvers.
 * @param {Record<string, PixelsRollGroup>} groups
 */
function handleRolls(groups) {
  if ( CONFIG.debug.pixels ) console.debug("Pixels Bridge | Handle pending rolls ", foundry.utils.deepClone(groups));
  for ( const [denomination, { results }] of Object.entries(groups) ) {
    let slice = 0;
    for ( const result of results ) {
      const handled = Roll.defaultImplementation.registerResult("pixels", denomination, result);
      if ( CONFIG.debug.pixels ) {
        console.debug(`Pixels Bridge | Registering result (${denomination}) - ${result}`);
        console.debug(`Pixels Bridge | Handled: ${!!handled}`);
      }
      if ( handled ) slice++;
      else break;
    }
    groups[denomination].results = results.slice(slice);
    if ( !groups[denomination].results.length ) delete groups[denomination];
  }
}

/* -------------------------------------------- */

export function openPixelsConfiguration() {
  new PixelsConfiguration().render({ force: true });
}

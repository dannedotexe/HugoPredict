'use strict';

/** /panel ist ausschließlich für die Discord-IDs aus PANEL_ADMIN_IDS. Geprüft wird bei jeder Interaktion. */
const isPanelAdmin = (deps, userId) => deps.env.panelAdminIds.includes(String(userId));

// Pro Nutzer: noch nicht bestätigte Zahlung (nur im Speicher)
const states = new Map();
const stateOf = (userId) => states.get(userId) ?? states.set(userId, { pay: null }).get(userId);

module.exports = { isPanelAdmin, stateOf };

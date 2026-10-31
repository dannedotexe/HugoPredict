'use strict';

/** /panel ist ausschließlich für die Discord-IDs aus PANEL_ADMIN_IDS. Geprüft wird bei jeder Interaktion. */
const isPanelAdmin = (deps, userId) => deps.env.panelAdminIds.includes(String(userId));

// Pro Nutzer: Suche, Seite und Filter (nur im Speicher)
const states = new Map();
const stateOf = (userId) => states.get(userId) ?? states.set(userId, { q: '', offset: 0, txType: '' }).get(userId);

module.exports = { isPanelAdmin, stateOf };

'use strict';

const { PermissionFlagsBits } = require('discord.js');

/** /panel ist ausschließlich für die Discord-IDs aus PANEL_ADMIN_IDS. Geprüft wird bei jeder Interaktion. */
const isPanelAdmin = (deps, userId) => deps.env.panelAdminIds.includes(String(userId));

/**
 * Darf diese Interaktion das Minecraft-Panel nutzen? Ja für die Inhaber-IDs überall,
 * sonst nur im Channel #minecraft-panel und nur, wer ihn laut Discord sehen darf.
 */
function canUsePanel(interaction, deps) {
  if (isPanelAdmin(deps, interaction.user.id)) return true;
  if (!interaction.inGuild?.() || !interaction.guildId) return false;
  const channelId = deps.store?.guild(interaction.guildId)?.channels?.minecraftPanel;
  if (!channelId || interaction.channelId !== channelId) return false;
  const perms = interaction.channel?.permissionsFor?.(interaction.member ?? interaction.user);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel));
}

// Pro Nutzer: noch nicht bestätigte Zahlung (nur im Speicher)
const states = new Map();
const stateOf = (userId) => states.get(userId) ?? states.set(userId, { pay: null }).get(userId);

module.exports = { isPanelAdmin, canUsePanel, stateOf };

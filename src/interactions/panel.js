'use strict';

const { MessageFlags } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { parseAmount, formatAmount } = require('../minecraft/amount');
const { mainView, payConfirmView, settingsView, commandModal, payModal, limitModal, joinModal } = require('../panel/minecraftPanel');
const { canUsePanel, stateOf } = require('../panel/access');

/* Steuerung von /panel. Jede Interaktion prüft erneut die Discord-ID. */

const PAY_TTL_MS = 2 * 60_000;

/**
 * Zeigt das Ergebnis. Kommt die Aktion vom festen Panel im Channel, antwortet der Bot
 * privat (nur für die Person sichtbar); im privaten Panel wird die Nachricht ersetzt.
 */
async function show(interaction, build) {
  const fromPrivate = interaction.message?.flags?.has?.(MessageFlags.Ephemeral);
  if (!fromPrivate) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await build();
    return interaction.editReply({ ...payload, flags: MessageFlags.IsComponentsV2 });
  }
  await interaction.deferUpdate();
  const payload = await build();
  return interaction.editReply({ ...payload, flags: MessageFlags.IsComponentsV2, files: [] });
}

async function audit(interaction, deps, title, value) {
  if (!interaction.guild) return;
  await deps.ctx.audit(interaction.guild, 'audit', {
    title,
    fields: [{ name: 'Von', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Befehl', value: `\`${value.replace(/`/g, "'")}\``, inline: true }],
  });
}

async function handle(interaction, deps, [action, arg]) {
  if (!canUsePanel(interaction, deps)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Das Minecraft-Panel kann nur nutzen, wer #minecraft-panel sieht.')] });
  }
  if (!deps.checkRate(interaction, 'default')) return;
  const mc = deps.minecraft;
  const state = stateOf(interaction.user.id);

  if (action === 'refresh' && interaction.isButton()) {
    state.pay = null;
    return show(interaction, async () => mainView(mc));
  }
  if (!mc) return show(interaction, async () => mainView(null));

  // --- Einstellungen ---
  const saved = async (title, res) => {
    if (res.ok) await audit(interaction, deps, 'Minecraft-Einstellung über /panel', title);
    return settingsView(mc, res.ok ? { ok: true, text: [title, res.note].filter(Boolean).join('\n') } : { ok: false, text: res.error });
  };
  if (action === 'settings' && interaction.isButton()) return show(interaction, async () => settingsView(mc));
  if (action === 'toggle' && interaction.isButton() && ['balanceCheck', 'payoutsEnabled'].includes(arg)) {
    const value = !mc.settings()[arg];
    const label = arg === 'balanceCheck' ? 'Kontostand-Prüfung' : 'Auszahlungen';
    return show(interaction, () => saved(`${label}: ${value ? 'an' : 'aus'}`, mc.setSetting(arg, value)));
  }
  if (action === 'limit' && interaction.isButton()) return interaction.showModal(limitModal());
  if (action === 'limitmodal' && interaction.isModalSubmit()) {
    const amount = parseAmount(interaction.fields.getTextInputValue('amount').trim());
    return show(interaction, () => (amount === null || amount === undefined
      ? settingsView(mc, { ok: false, text: 'Ungültiger Betrag. Beispiele: 5000, 50k' })
      : saved(`Auszahlungs-Limit: ${formatAmount(amount)}`, mc.setSetting('payoutMax', amount))));
  }
  if (action === 'join' && interaction.isButton()) return interaction.showModal(joinModal(mc.settings().joinCommands));
  if (action === 'joinmodal' && interaction.isModalSubmit()) {
    const cmds = interaction.fields.getTextInputValue('cmds').split('\n').map((c) => c.trim()).filter(Boolean);
    return show(interaction, () => saved(`Join-Befehle: ${cmds.join(' · ') || 'keine'}\nGilt ab dem nächsten Verbinden („Neu verbinden“).`, mc.setSetting('joinCommands', cmds)));
  }
  if (action === 'reconnect' && interaction.isButton()) {
    mc.reconnect();
    await audit(interaction, deps, 'Minecraft-Bot neu verbunden über /panel', 'Neu verbinden');
    return show(interaction, async () => settingsView(mc, { ok: true, text: 'Der Bot trennt sich und verbindet sich in etwa 15 Sekunden neu.' }));
  }

  if (action === 'cmd' && interaction.isButton()) return interaction.showModal(commandModal());
  if (action === 'pay' && interaction.isButton()) return interaction.showModal(payModal());

  if (action === 'balance' && interaction.isButton()) {
    return show(interaction, async () => {
      const res = await mc.runCommand(deps.env.minecraft.balanceCommand);
      return mainView(mc, { title: `Ausgeführt: ${deps.env.minecraft.balanceCommand}`, ...res });
    });
  }

  if (action === 'cmdmodal' && interaction.isModalSubmit()) {
    const cmd = interaction.fields.getTextInputValue('cmd').trim();
    return show(interaction, async () => {
      const res = await mc.runCommand(cmd);
      if (!res.error) {
        deps.logger.info(`/panel: ${interaction.user.tag} → ${cmd}`);
        await audit(interaction, deps, 'Minecraft-Befehl über /panel', cmd);
      }
      return mainView(mc, { title: `Ausgeführt: ${cmd.slice(0, 80)}`, ...res });
    });
  }

  if (action === 'paymodal' && interaction.isModalSubmit()) {
    const name = interaction.fields.getTextInputValue('name').trim();
    const amount = parseAmount(interaction.fields.getTextInputValue('amount').trim());
    return show(interaction, async () => {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return mainView(mc, { title: '/pay', error: 'bad_name' });
      if (amount === null || amount === undefined) return mainView(mc, { title: '/pay', error: 'bad_amount' });
      state.pay = { name, amount, at: Date.now() };
      return payConfirmView(name, amount);
    });
  }

  if (action === 'payok' && interaction.isButton()) {
    const p = state.pay;
    state.pay = null; // nur einmal
    return show(interaction, async () => {
      if (!p || Date.now() - p.at > PAY_TTL_MS) return mainView(mc, { title: '/pay', error: 'Die Bestätigung ist abgelaufen. Bitte neu eingeben.' });
      const res = await mc.pay(p.name, String(p.amount));
      if (!res.error) {
        deps.logger.info(`/panel: ${interaction.user.tag} zahlt ${formatAmount(p.amount)} an ${p.name}`);
        await audit(interaction, deps, 'Minecraft: Zahlung über /panel', `/pay ${p.name} ${formatAmount(p.amount)}`);
      }
      return mainView(mc, { title: `Ausgeführt: /pay ${p.name} ${formatAmount(p.amount)}`, ...res });
    });
  }
}

module.exports = { prefix: 'panel', handle };

'use strict';

const { MessageFlags } = require('discord.js');
const { embeds } = require('../lib/embeds');
const { replyPrivate } = require('../lib/respond');
const { parseAmount, formatAmount } = require('../minecraft/amount');
const { mainView, payConfirmView, commandModal, payModal } = require('../panel/minecraftPanel');
const { isPanelAdmin, stateOf } = require('../panel/access');

/* Steuerung von /panel. Jede Interaktion prüft erneut die Discord-ID. */

const PAY_TTL_MS = 2 * 60_000;

/** Ersetzt die Panel-Nachricht (erst bestätigen, dann in Ruhe bauen). */
async function show(interaction, build) {
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

async function handle(interaction, deps, [action]) {
  if (!isPanelAdmin(deps, interaction.user.id)) {
    return replyPrivate(interaction, { embeds: [embeds.error('Keine Berechtigung', 'Das Panel ist nur für den Inhaber von HugoPredict.')] });
  }
  if (!deps.checkRate(interaction, 'default')) return;
  const mc = deps.minecraft;
  const state = stateOf(interaction.user.id);

  if (action === 'refresh' && interaction.isButton()) {
    state.pay = null;
    return show(interaction, async () => mainView(mc));
  }
  if (!mc) return show(interaction, async () => mainView(null));

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

'use strict';

const { CATEGORIES } = require('../config/serverLayout');

/*
 * Forum #vorschläge: Jeder neue Beitrag bekommt automatisch „In Prüfung“.
 * Setzt das Team einen anderen Status, entfernt der Bot die übrigen Status-Tags,
 * damit jeder Beitrag genau einen Status hat. Bereich-Tags bleiben unberührt.
 * Braucht „Threads verwalten“ für die Bot-Rolle (Status-Tags sind moderiert).
 */

const IDEAS = CATEGORIES.flatMap((c) => c.channels).find((c) => c.key === 'ideas');
const STATUS_NAMES = IDEAS.forum.availableTags.filter((t) => t.moderated).map((t) => t.name);
const INITIAL_STATUS = 'In Prüfung';

function createIdeasForumService({ store, logger }) {
  const isIdeasPost = (thread) => {
    const g = store.guild(thread.guild.id);
    return thread.parentId && thread.parentId === g.channels.ideas && thread.id !== g.panels.ideasTemplate?.threadId;
  };
  const statusIds = (forum) => new Map((forum?.availableTags ?? []).filter((t) => STATUS_NAMES.includes(t.name)).map((t) => [t.id, t.name]));

  async function onThreadCreate(thread, newlyCreated) {
    if (!newlyCreated || !thread.guild || !isIdeasPost(thread)) return;
    const tags = statusIds(thread.parent);
    const initial = [...tags].find(([, name]) => name === INITIAL_STATUS)?.[0];
    if (!initial || thread.appliedTags.some((id) => tags.has(id))) return;
    await thread.setAppliedTags([...thread.appliedTags, initial].slice(0, 5), 'Neuer Vorschlag: In Prüfung')
      .catch((err) => logger.warn('Vorschlag-Tag:', err.message));
  }

  async function onThreadUpdate(oldThread, newThread) {
    if (!newThread.guild || !isIdeasPost(newThread)) return;
    const tags = statusIds(newThread.parent);
    const added = newThread.appliedTags.filter((id) => tags.has(id) && !oldThread.appliedTags.includes(id));
    if (!added.length) return;
    const keep = added.at(-1);
    const next = newThread.appliedTags.filter((id) => !tags.has(id) || id === keep);
    if (next.length === newThread.appliedTags.length) return;
    await newThread.setAppliedTags(next, `Status: ${tags.get(keep)}`)
      .catch((err) => logger.warn('Vorschlag-Status:', err.message));
  }

  return { onThreadCreate, onThreadUpdate };
}

module.exports = { createIdeasForumService, STATUS_NAMES, INITIAL_STATUS };

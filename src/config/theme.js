'use strict';

// Dunkles, sachliches Design: Schwarz/Anthrazit mit dezenten Emerald-Akzenten.
module.exports = {
  brand: process.env.BRAND_NAME?.trim() || 'HugoPredict',
  colors: {
    primary: 0x10b981, // Emerald
    neutral: 0x2b2d31, // Anthrazit (verschmilzt mit dem dunklen Discord-Theme)
    dark: 0x111214,
    success: 0x10b981,
    warning: 0xd4a017,
    danger: 0xc0392b,
    info: 0x3b82f6,
  },
  // Kleine Unicode-Indikatoren statt bunter Emoji-Flut.
  symbols: {
    up: '▲',
    down: '▼',
    dot: '•',
    yes: '●',
    no: '○',
  },
};

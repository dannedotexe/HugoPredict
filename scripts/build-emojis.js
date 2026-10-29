'use strict';

/*
 * Erzeugt die Custom-Emojis (assets/emojis/*.png) aus SVG-Definitionen.
 * Einheitlicher Stil: Linien-Icon in Emerald auf dunkler, abgerundeter Kachel.
 * Nur bei Änderungen am Icon-Set nötig:  node scripts/build-emojis.js
 * Benötigt Playwright mit Chromium (nicht Teil der Bot-Abhängigkeiten).
 */

const fs = require('node:fs');
const path = require('node:path');

const EMERALD = '#34d399';
const AMBER = '#fbbf24';
const RED = '#f87171';
const SLATE = '#cbd5e1';

// Glyphen im 24er-Raster (Linienstil, angelehnt an Lucide-Icons, ISC-Lizenz)
const ICONS = {
  // Marke
  logo: { d: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'] },
  // Rollen
  owner: { d: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'] },
  admin: { d: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'] },
  developer: { d: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'] },
  marketmod: { d: ['m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'M7 21h10', 'M12 3v18', 'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'] },
  moderator: { d: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'] },
  support: { d: ['M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z', 'M21 16v2a4 4 0 0 1-4 4h-5'] },
  verified: { d: ['M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z', 'm9 12 2 2 4-4'] },
  member: { d: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'], circles: [[12, 7, 4]] },
  bot: { d: ['M12 8V4H8', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'], rects: [[4, 8, 16, 12, 2]] },
  // Dokumentation
  platform: { d: ['m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'] },
  coin: { d: ['M18.09 10.37A6 6 0 1 1 10.34 18', 'M7 6h1v4', 'm16.71 13.88.7.71-2.82 2.82'], circles: [[8, 8, 6]] },
  fees: { d: ['M19 5 5 19'], circles: [[6.5, 6.5, 2.5], [17.5, 17.5, 2.5]] },
  rules: { d: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8', 'M16 13H8', 'M16 17H8'] },
  conduct: { d: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  roles: { d: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], circles: [[9, 7, 4]] },
  // Marktstatus
  open: { d: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'] },
  paused: { color: AMBER, rects: [[6, 4, 4, 16, 1], [14, 4, 4, 16, 1]] },
  closed: { color: SLATE, d: ['M12 6v6l4 2'], circles: [[12, 12, 10]] },
  resolved: { d: ['m9 12 2 2 4-4'], circles: [[12, 12, 10]] },
  // Kundenservice
  general: { d: ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'], circles: [[12, 12, 10]] },
  balance: { d: ['M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1', 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'] },
  bug: { d: ['m8 2 1.88 1.88', 'M14.12 3.88 16 2', 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1', 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6', 'M12 20v-9', 'M6.53 9C4.6 8.8 3 7.1 3 5', 'M6 13H2', 'M3 21c0-2.1 1.7-3.9 3.8-4', 'M20.97 5c0 2.1-1.6 3.8-3.5 4', 'M22 13h-4', 'M17.2 17c2.1.1 3.8 1.9 3.8 4'] },
  fraud: { color: AMBER, d: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'] },
  other: { d: ['M12 12h.01', 'M19 12h.01', 'M5 12h.01'], strokeWidth: 3 },
  // Aktionen und Hinweise
  check: { d: ['M20 6 9 17l-5-5'] },
  link: { d: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'] },
  external: { d: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  lock: { d: ['M7 11V7a5 5 0 0 1 10 0v4'], rects: [[3, 11, 18, 11, 2]] },
  claim: { d: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'm16 11 2 2 4-4'], circles: [[9, 7, 4]] },
  announce: { d: ['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'] },
  info: { d: ['M12 16v-4', 'M12 8h.01'], circles: [[12, 12, 10]] },
  warning: { color: AMBER, d: ['M12 8v4', 'M12 16h.01'], circles: [[12, 12, 10]] },
  error: { color: RED, d: ['m15 9-6 6', 'm9 9 6 6'], circles: [[12, 12, 10]] },
};

function svg({ d = [], circles = [], rects = [], color = EMERALD, strokeWidth = 2 }) {
  const glyph = [
    ...d.map((p) => `<path d="${p}"/>`),
    ...circles.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`),
    ...rects.map(([x, y, w, h, rx]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c2127"/><stop offset="1" stop-color="#0d1013"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="30" fill="url(#bg)" stroke="${color}" stroke-opacity="0.28" stroke-width="2"/>
  <g transform="translate(30 30) scale(2.8333)" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;
}

async function main() {
  const { chromium } = require('playwright');
  const out = path.join(__dirname, '..', 'assets', 'emojis');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
  for (const [name, def] of Object.entries(ICONS)) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(def)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  }
  // Hinweis: assets/brand/logo.png ist das offizielle HugoPredict-Logo und wird hier nicht erzeugt.
  await browser.close();
  console.log(`${Object.keys(ICONS).length} Emojis erzeugt.`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { ICONS, svg };

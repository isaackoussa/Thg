// Génère les icônes PNG (favicon, iPhone, Android) à partir des SVG de public/.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const targets = [
  ['icon.svg', 'favicon-32.png', 32],
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512]
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of targets) {
  const svg = readFileSync(new URL('../public/' + src, import.meta.url), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL('../public/' + out, import.meta.url).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('icône', out, size + 'px');
}
await browser.close();

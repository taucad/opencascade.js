#!/usr/bin/env node
/**
 * Playwright-driven render smoke for the v3 web starter templates.
 *
 * Loads a dev-server URL in a headless Chromium, waits for the canvas
 * element, samples a 16x16 region from the centre of the canvas, and
 * fails non-zero if:
 *   - the canvas never appears
 *   - every sampled pixel collapses to a single colour (nothing was painted)
 *   - the page emits a console error mentioning OCCT, OpenCascade, or
 *     emscripten (loader / init / runtime failure that did not crash hard)
 *
 * Usage:
 *   node _shared/smoke-render.mjs \
 *     --url http://localhost:5173 \
 *     --canvas '#three-canvas' \
 *     [--screenshot out.png] \
 *     [--timeout-ms 30000] \
 *     [--sample-size 16]
 *
 * Exit codes:
 *   0  ok
 *   1  args / setup error
 *   2  canvas never mounted within timeout
 *   3  all sampled pixels share a colour (no geometry painted)
 *   4  OCCT/OpenCascade/emscripten console.error observed
 */
import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.canvas) {
  console.error('smoke-render: --url and --canvas are required');
  process.exit(1);
}

const TIMEOUT_MS = Number(args['timeout-ms'] ?? 30000);
const SAMPLE_SIZE = Number(args['sample-size'] ?? 16);
const SCREENSHOT_PATH = args.screenshot ?? null;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const ocjsErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/OCCT|OpenCascade|emscripten/i.test(text)) {
    ocjsErrors.push(text);
  }
});

try {
  await page.goto(args.url, { waitUntil: 'load', timeout: TIMEOUT_MS });
} catch (err) {
  console.error(`smoke-render: navigation failed: ${err.message}`);
  await browser.close();
  process.exit(1);
}

let canvasHandle;
try {
  canvasHandle = await page.waitForSelector(args.canvas, { timeout: TIMEOUT_MS });
} catch {
  console.error(`smoke-render: canvas '${args.canvas}' never appeared within ${TIMEOUT_MS}ms`);
  await browser.close();
  process.exit(2);
}

if (SCREENSHOT_PATH) {
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
}

const pixels = await canvasHandle.evaluate((canvas, sampleSize) => {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return null;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const x = Math.max(0, Math.floor(w / 2 - sampleSize / 2));
    const y = Math.max(0, Math.floor(h / 2 - sampleSize / 2));
    const data = ctx.getImageData(x, y, sampleSize, sampleSize).data;
    return Array.from(data);
  }

  const offscreen = new OffscreenCanvas(w, h);
  const off = offscreen.getContext('2d');
  if (!off) return null;
  off.drawImage(canvas, 0, 0);
  const x2 = Math.max(0, Math.floor(w / 2 - sampleSize / 2));
  const y2 = Math.max(0, Math.floor(h / 2 - sampleSize / 2));
  const data2 = off.getImageData(x2, y2, sampleSize, sampleSize).data;
  return Array.from(data2);
}, SAMPLE_SIZE);

await browser.close();

if (ocjsErrors.length > 0) {
  console.error(
    `smoke-render: ${ocjsErrors.length} OCJS-related console.error observed:\n  ` +
      ocjsErrors.join('\n  '),
  );
  process.exit(4);
}

if (!pixels) {
  console.error('smoke-render: could not read canvas pixels (no 2d/OffscreenCanvas path)');
  process.exit(1);
}

const unique = new Set();
for (let i = 0; i < pixels.length; i += 4) {
  unique.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
}

if (unique.size <= 1) {
  console.error(
    `smoke-render: every sampled pixel collapsed to ${[...unique][0]} — no geometry painted`,
  );
  process.exit(3);
}

console.log(`smoke-render: ok (${unique.size} distinct colours in ${SAMPLE_SIZE}x${SAMPLE_SIZE} centre sample)`);
process.exit(0);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

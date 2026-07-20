#!/usr/bin/env node
/**
 * Playwright-driven render smoke for the v3 web starter templates.
 *
 * Loads a dev-server URL in a headless Chromium, waits for the canvas
 * element, samples a 16x16 grid from a compositor screenshot, and
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
import { PNG } from 'pngjs';

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

let unique = new Set();
const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline && unique.size <= 1 && ocjsErrors.length === 0) {
  const screenshot = PNG.sync.read(await canvasHandle.screenshot());
  unique = sampleGrid(screenshot, SAMPLE_SIZE);
  if (unique.size <= 1) await page.waitForTimeout(250);
}

if (SCREENSHOT_PATH) {
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
}

await browser.close();

if (ocjsErrors.length > 0) {
  console.error(
    `smoke-render: ${ocjsErrors.length} OCJS-related console.error observed:\n  ` +
      ocjsErrors.join('\n  '),
  );
  process.exit(4);
}

if (unique.size <= 1) {
  console.error(
    `smoke-render: every sampled compositor pixel collapsed to ${[...unique][0]} — no geometry painted`,
  );
  process.exit(3);
}

console.log(`smoke-render: ok (${unique.size} distinct colours in a ${SAMPLE_SIZE}x${SAMPLE_SIZE} grid)`);
process.exit(0);

function sampleGrid(image, sampleSize) {
  const colors = new Set();
  for (let row = 0; row < sampleSize; row++) {
    const y = Math.min(image.height - 1, Math.floor(((row + 0.5) * image.height) / sampleSize));
    for (let column = 0; column < sampleSize; column++) {
      const x = Math.min(image.width - 1, Math.floor(((column + 0.5) * image.width) / sampleSize));
      const offset = (y * image.width + x) * 4;
      colors.add(
        `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${image.data[offset + 3]}`,
      );
    }
  }
  return colors;
}

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

#!/usr/bin/env node

import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const output = path.resolve(process.argv[2] ?? '');
const base = process.argv[3] ?? 'opencascade_full_multi_browser';
const html = `<!doctype html><script type="module">
import init from '/${base}.js';
try {
  const oc = await init({ locateFile: file => '/' + file });
  const pool = oc.OSD_ThreadPool.DefaultPool(-1);
  pool.SetNbDefaultThreadsToLaunch(pool.NbThreads());
  const box = new oc.BRepPrimAPI_MakeBox(1, 2, 3);
  const shape = box.Shape();
  window.__ocjs = {
    isolated: crossOriginIsolated,
    threads: pool.NbThreads(),
    shape: !shape.IsNull(),
  };
  shape.delete(); box.delete(); pool.delete();
  oc.PThread?.terminateAllThreads?.();
} catch (error) {
  window.__ocjs = { error: String(error?.stack ?? error) };
}
</script>`;

const server = createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(html);
    return;
  }
  try {
    const file = path.join(output, path.basename(request.url));
    response.setHeader('Content-Type', request.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await fs.readFile(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const address = server.address();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => window.__ocjs, undefined, { timeout: 120_000 });
  const result = await page.evaluate(() => window.__ocjs);
  if (result.error) throw new Error(result.error);
  if (!result.isolated || result.threads <= 1 || !result.shape) {
    throw new Error(`unexpected browser MT result: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  server.close();
}

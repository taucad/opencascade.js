// Run every Pattern 1–4 micro-bench and emit a consolidated JSON report.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports');
await fs.mkdir(REPORTS_DIR, { recursive: true });

const p1 = (await import('./pattern1.mjs')).default;
const p2 = (await import('./pattern2.mjs')).default;
const p3 = (await import('./pattern3.mjs')).default;
const p4 = (await import('./pattern4.mjs')).default;

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  patterns: { P1: p1, P2: p2, P3: p3, P4: p4 },
};

const outPath = path.join(REPORTS_DIR, 'micro-benches.json');
await fs.writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outPath}`);

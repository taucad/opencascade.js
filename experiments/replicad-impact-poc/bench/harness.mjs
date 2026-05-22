// Shared benchmark harness.
// - Times N iterations of a fn.
// - Reports median, p95, p99, mean, stddev, total.
// - Captures V8 heap delta and wasm linear memory delta.
// - Forces GC between iterations when --expose-gc is enabled.

export function quantile(sorted, q) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

export function stddev(samples, mean) {
  const sq = samples.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
  return Math.sqrt(sq / samples.length);
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  return {
    n: sorted.length,
    mean: round(mean, 4),
    median: round(quantile(sorted, 0.5), 4),
    p95: round(quantile(sorted, 0.95), 4),
    p99: round(quantile(sorted, 0.99), 4),
    min: round(sorted[0], 4),
    max: round(sorted[sorted.length - 1], 4),
    stddev: round(stddev(samples, mean), 4),
    total: round(sum, 4),
  };
}

export function round(n, d = 4) {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}

function maybeGc() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

export async function bench(label, oc, iterations, fn, { warmup = 5 } = {}) {
  // Warmup
  for (let i = 0; i < warmup; i++) await fn(i);

  maybeGc();
  const heapBefore = process.memoryUsage().heapUsed;
  const wasmBefore = oc.HEAP8.byteLength;

  const samples = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn(i);
    samples[i] = performance.now() - t0;
  }

  maybeGc();
  const heapAfter = process.memoryUsage().heapUsed;
  const wasmAfter = oc.HEAP8.byteLength;

  return {
    label,
    iterations,
    timing: summarize(samples),
    memory: {
      v8HeapDeltaKB: round((heapAfter - heapBefore) / 1024, 1),
      wasmDeltaKB: round((wasmAfter - wasmBefore) / 1024, 1),
    },
  };
}

export function printResult(r) {
  const t = r.timing;
  const m = r.memory;
  console.log(
    `  ${r.label.padEnd(28)} ` +
    `median=${String(t.median).padStart(8)}ms  ` +
    `p95=${String(t.p95).padStart(8)}ms  ` +
    `mean=${String(t.mean).padStart(8)}ms  ` +
    `Δv8=${String(m.v8HeapDeltaKB).padStart(8)}KB  ` +
    `Δwasm=${String(m.wasmDeltaKB).padStart(8)}KB`,
  );
}

export function ratio(a, b) {
  return b === 0 ? Infinity : a / b;
}

export function verdict(label, statusQuo, strategy, threshold = 0.05) {
  const r = ratio(strategy.timing.median, statusQuo.timing.median);
  const change = (r - 1) * 100;
  const sign = change >= 0 ? '+' : '';
  let assessment;
  if (Math.abs(change) <= threshold * 100) assessment = 'PARITY';
  else if (change < 0) assessment = 'SPEEDUP';
  else assessment = 'REGRESSION';
  return { label, ratio: round(r, 3), changePct: `${sign}${round(change, 1)}%`, assessment };
}

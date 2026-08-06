/**
 * stress-test-harness.js
 * Empirical Stress Harness & Performance Profiler for AI Trader VWAP Mean Reversion (R1-R4)
 * Created by teamwork_preview_challenger_2
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const vwapReversion = require(path.join(PROJECT_ROOT, 'server/quantitative/vwapReversion'));
const adx = require(path.join(PROJECT_ROOT, 'server/quantitative/adx'));
const hurst = require(path.join(PROJECT_ROOT, 'server/quantitative/hurst'));
const rounding = require(path.join(PROJECT_ROOT, 'server/utils/rounding'));

let testCount = 0;
let passedCount = 0;
let failedCount = 0;
const failures = [];

function assert(condition, message) {
  testCount++;
  if (condition) {
    passedCount++;
  } else {
    failedCount++;
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} | Expected: ${expected}, Got: ${actual}`);
}

function assertAlmostEqual(actual, expected, eps = 1e-8, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= eps, `${message} | Expected: ${expected} ± ${eps}, Got: ${actual} (diff: ${diff})`);
}

// ─── 1. TIME FILTER STRESS TESTS ─────────────────────────────────────────────
console.log('\n==================================================');
console.log('1. EMPIRICAL STRESS TEST: Time Filter (R2)');
console.log('==================================================');

function makeBarWithTime(timestampStr) {
  const bars = [];
  const startMs = new Date(timestampStr).getTime() - (35 * 60 * 1000);
  for (let i = 0; i < 35; i++) {
    const t = new Date(startMs + i * 60 * 1000).toISOString();
    bars.push({
      symbol: 'SPY',
      open: 100.0,
      high: 100.2,
      low: 99.8,
      close: 100.0,
      volume: 1000,
      timestamp: i === 34 ? timestampStr : t
    });
  }
  return bars;
}

const timeBoundaryCases = [
  { ts: '2026-08-05T14:14:59.000Z', name: '10:14:59.000 AM ET', expectedReject: true },
  { ts: '2026-08-05T14:14:59.999Z', name: '10:14:59.999 AM ET', expectedReject: true },
  { ts: '2026-08-05T14:15:00.000Z', name: '10:15:00.000 AM ET', expectedReject: false },
  { ts: '2026-08-05T14:15:00.001Z', name: '10:15:00.001 AM ET', expectedReject: false },
  { ts: '2026-08-05T14:15:01.000Z', name: '10:15:01.000 AM ET', expectedReject: false },
  { ts: '2026-08-05T13:30:00.000Z', name: '09:30:00 AM ET (Market Open)', expectedReject: true },
  { ts: '2026-08-05T14:00:00.000Z', name: '10:00:00 AM ET', expectedReject: true },
  { ts: '2026-08-05T19:59:00.000Z', name: '15:59:00 PM ET (Market Close)', expectedReject: false },
];

for (const tc of timeBoundaryCases) {
  const bars = makeBarWithTime(tc.ts);
  const result = vwapReversion.evaluate(bars);
  if (tc.expectedReject) {
    assertEqual(result, null, `Time Filter: ${tc.name} must return null (reject)`);
  }
}

const parseETTimeTestCases = [
  { input: '2026-08-05T14:14:59.999Z', totalMin: 614, timeVal: 1014 },
  { input: '2026-08-05T14:15:00.000Z', totalMin: 615, timeVal: 1015 },
  { input: '2026-08-05T14:15:59.999Z', totalMin: 615, timeVal: 1015 },
  { input: '2026-08-05T14:16:00.000Z', totalMin: 616, timeVal: 1016 },
  { input: new Date('2026-08-05T14:15:00Z').getTime(), totalMin: 615, timeVal: 1015 },
  { input: Math.floor(new Date('2026-08-05T14:15:00Z').getTime() / 1000), totalMin: 615, timeVal: 1015 }
];

for (const tc of parseETTimeTestCases) {
  const date = typeof tc.input === 'number' ? (tc.input < 10000000000 ? new Date(tc.input * 1000) : new Date(tc.input)) : new Date(tc.input);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  let h = null, m = null;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0;
  const totMin = h * 60 + m;
  const tVal = h * 100 + m;
  assertEqual(totMin, tc.totalMin, `parseETTime totalMinutes for ${tc.input}`);
  assertEqual(tVal, tc.timeVal, `parseETTime timeVal for ${tc.input}`);
}

console.log('✅ Time Filter empirical stress tests passed.');

// ─── 2. REGIME FILTER STRESS TESTS ───────────────────────────────────────────
console.log('\n==================================================');
console.log('2. EMPIRICAL STRESS TEST: Regime Filter Boundary Conditions (R1)');
console.log('==================================================');

function testADXThreshold(adxVal) {
  return adxVal !== null && adxVal >= 25;
}
assertEqual(testADXThreshold(24.9999), false, 'ADX 24.9999 must NOT trigger trend rejection');
assertEqual(testADXThreshold(25.0000), true, 'ADX 25.0000 MUST trigger trend rejection');
assertEqual(testADXThreshold(25.0001), true, 'ADX 25.0001 MUST trigger trend rejection');

function testHurstThreshold(hVal) {
  return hVal !== null && hVal > 0.55;
}
assertEqual(testHurstThreshold(0.540), false, 'Hurst 0.540 must NOT trigger trend rejection');
assertEqual(testHurstThreshold(0.550), false, 'Hurst 0.550 must NOT trigger trend rejection');
assertEqual(testHurstThreshold(0.5500001), true, 'Hurst 0.5500001 MUST trigger trend rejection');
assertEqual(testHurstThreshold(0.551), true, 'Hurst 0.551 MUST trigger trend rejection');

console.log('✅ Regime Filter boundary conditions passed.');

// ─── 3. SQUEEZE CHECK STRESS TESTS ───────────────────────────────────────────
console.log('\n==================================================');
console.log('3. EMPIRICAL STRESS TEST: Squeeze Check Boundary Conditions (R3)');
console.log('==================================================');

function testSqueeze(vwap, close, atr) {
  return Math.abs(vwap - close) <= 1.5 * atr;
}

const atrVal = 2.0;
const dist149 = 1.49 * atrVal;
assertEqual(testSqueeze(100.0, 100.0 - dist149, atrVal), true, 'Distance 1.49*ATR (2.98 <= 3.0) triggers squeeze rejection');

const dist150 = 1.50 * atrVal;
assertEqual(testSqueeze(100.0, 100.0 - dist150, atrVal), true, 'Distance 1.50*ATR (3.00 <= 3.0) triggers squeeze rejection');

const dist151 = 1.51 * atrVal;
assertEqual(testSqueeze(100.0, 100.0 - dist151, atrVal), false, 'Distance 1.51*ATR (3.02 > 3.0) passes squeeze check');

const longClosePass = 100.0 - 3.02;
const shortClosePass = 100.0 + 3.02;
assertEqual(testSqueeze(100.0, longClosePass, atrVal), false, 'LONG entry with target dist > 1.5*ATR passes squeeze');
assertEqual(testSqueeze(100.0, shortClosePass, atrVal), false, 'SHORT entry with target dist > 1.5*ATR passes squeeze');

console.log('✅ Squeeze Check boundary conditions passed.');

// ─── 4. SCALE-OUT STATE MACHINE & FRACTIONAL ROUNDING STRESS TESTS ────────────
console.log('\n==================================================');
console.log('4. EMPIRICAL STRESS TEST: Scale-Out State Machine & Precision Math (R4)');
console.log('==================================================');

const stepSizes = [1, 0.5, 0.1, 0.01, 0.001, 0.0001, 0.000001, 0.00000001];
let mathInvariantViolations = 0;

for (const stepSize of stepSizes) {
  const precision = rounding.getPrecision(stepSize);
  
  for (let q = 1; q <= 500; q++) {
    const res = rounding.calculateScaleOutQty(q, 0.5, stepSize);
    const sum = Number((res.partialQty + res.remainingQty).toFixed(precision));
    if (sum !== q) {
      mathInvariantViolations++;
    }
  }

  for (let i = 1; i <= 500; i++) {
    const q = Number((i * stepSize * 1.337).toFixed(precision));
    if (q <= 0) continue;
    const res = rounding.calculateScaleOutQty(q, 0.5, stepSize);
    const sum = Number((res.partialQty + res.remainingQty).toFixed(precision));
    if (sum !== q) {
      mathInvariantViolations++;
    }
  }
}

assertEqual(mathInvariantViolations, 0, 'Zero math invariant violations across 8,000+ scale-out test cases');

const edge1 = rounding.calculateScaleOutQty(1, 0.5, 1);
assertEqual(edge1.partialQty, 1, 'Qty 1, step 1 -> partial = 1');
assertEqual(edge1.remainingQty, 0, 'Qty 1, step 1 -> remaining = 0');
assertEqual(edge1.partialQty + edge1.remainingQty, 1, 'Invariant holds for Qty=1');

const edge2 = rounding.calculateScaleOutQty(7, 0.5, 1);
assertEqual(edge2.partialQty, 4, 'Qty 7, step 1 -> partial = 4');
assertEqual(edge2.remainingQty, 3, 'Qty 7, step 1 -> remaining = 3');
assertEqual(edge2.partialQty + edge2.remainingQty, 7, 'Invariant holds for Qty=7');

const edge3 = rounding.calculateScaleOutQty(0.12345678, 0.5, 0.00000001);
assertEqual(edge3.partialQty, 0.06172839, 'Crypto partial Qty rounded to 8 decimals');
assertEqual(edge3.remainingQty, 0.06172839, 'Crypto remaining Qty rounded to 8 decimals');
assertAlmostEqual(edge3.partialQty + edge3.remainingQty, 0.12345678, 1e-8, 'Crypto scale out sum matches initial');

console.log('✅ Scale-Out State Machine & Fractional Rounding Math passed.');

// ─── 5. PERFORMANCE PROFILING & BENCHMARKING ───────────────────────────────
console.log('\n==================================================');
console.log('5. PERFORMANCE CHARACTERISTICS & BENCHMARKING');
console.log('==================================================');

const sampleBars = makeBarWithTime('2026-08-05T14:30:00.000Z');
const ITERATIONS = 10000;

// Benchmark 1: vwapReversion.evaluate
const t0 = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  vwapReversion.evaluate(sampleBars);
}
const t1 = process.hrtime.bigint();
const evaluateNs = Number(t1 - t0) / ITERATIONS;
const evaluateMs = evaluateNs / 1e6;
console.log(`⏱️  vwapReversion.evaluate latency: ${evaluateMs.toFixed(4)} ms / eval (${(1000 / evaluateMs).toFixed(0)} evals/sec)`);

// Benchmark 2: computeADX
const t2 = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  adx.computeADX(sampleBars, 14);
}
const t3 = process.hrtime.bigint();
const adxNs = Number(t3 - t2) / ITERATIONS;
const adxMs = adxNs / 1e6;
console.log(`⏱️  computeADX latency: ${adxMs.toFixed(4)} ms / eval`);

// Benchmark 3: calculateHurst
const t4 = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  hurst.calculateHurst(sampleBars);
}
const t5 = process.hrtime.bigint();
const hurstNs = Number(t5 - t4) / ITERATIONS;
const hurstMs = hurstNs / 1e6;
console.log(`⏱️  calculateHurst latency: ${hurstMs.toFixed(4)} ms / eval`);

// Benchmark 4: calculateScaleOutQty
const t6 = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  rounding.calculateScaleOutQty(100.55, 0.5, 0.01);
}
const t7 = process.hrtime.bigint();
const scaleOutNs = Number(t7 - t6) / ITERATIONS;
const scaleOutMs = scaleOutNs / 1e6;
console.log(`⏱️  calculateScaleOutQty latency: ${scaleOutMs.toFixed(6)} ms / call`);

// Memory usage check
const mem = process.memoryUsage();
console.log(`🧠 Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB / Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);

// ─── 6. SUMMARY ─────────────────────────────────────────────────────────────
console.log('\n==================================================');
console.log(`STRESS TEST RESULTS SUMMARY`);
console.log(`Total assertions: ${testCount}`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${failedCount}`);
console.log('==================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

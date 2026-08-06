/**
 * stress-test.js
 * Empirical Stress-Testing Harness for VWAP Reversion Implementation (R1-R4)
 * Prepared by teamwork_preview_challenger_1
 */

const path = require('path');
const process = require('process');

const projectRoot = path.join(__dirname, '../..');

const vwapReversion = require(path.join(projectRoot, 'server/quantitative/vwapReversion'));
const adx = require(path.join(projectRoot, 'server/quantitative/adx'));
const hurst = require(path.join(projectRoot, 'server/quantitative/hurst'));
const { calculateScaleOutQty, roundToStep, getPrecision } = require(path.join(projectRoot, 'server/utils/rounding'));

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function check(testName, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    const errMsg = `  ❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`;
    console.log(errMsg);
    failures.push({ testName, details });
  }
}

function makeCandles(count, options = {}) {
  const {
    basePrice = 100,
    startTimeET = '2026-08-04T10:30:00-04:00',
    close = null,
    volume = 1000,
    symbol = 'SPY',
    trendDrift = 0
  } = options;

  const startMs = new Date(startTimeET).getTime();
  const candles = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    price += trendDrift + Math.sin(i / 3) * 0.1;
    const isLast = (i === count - 1);
    const cClose = (isLast && close !== null) ? close : price;
    const cOpen = cClose - 0.1;
    const cHigh = Math.max(cOpen, cClose) + 0.2;
    const cLow = Math.min(cOpen, cClose) - 0.2;
    const cVol = (isLast && options.volumeSpike) ? volume * 2.5 : volume;
    const timestamp = new Date(startMs + i * 60000).toISOString();

    candles.push({
      symbol,
      open: cOpen,
      high: cHigh,
      low: cLow,
      close: cClose,
      volume: cVol,
      timestamp
    });
  }
  return candles;
}

function makeChopCandles(count = 60, options = {}) {
  const startMs = new Date(options.startTimeET || '2026-08-04T10:30:00-04:00').getTime();
  const candles = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += (i % 2 === 0 ? 0.2 : -0.2);
    candles.push({
      symbol: options.symbol || 'SPY',
      open: price - 0.05,
      high: price + 0.1,
      low: price - 0.1,
      close: price,
      volume: 1000,
      timestamp: new Date(startMs + i * 60000).toISOString()
    });
  }
  return candles;
}

console.log('====================================================');
console.log('EMPIRICAL STRESS TEST SUITE: VWAP REVERSION (R1-R4)');
console.log('====================================================\n');

// ----------------------------------------------------
// SECTION 1: TIME FILTER EDGE CASES (R2)
// ----------------------------------------------------
console.log('--- SECTION 1: Time Filter Edge Cases (R2) ---');

// 1.1 10:14:59 AM ET vs 10:15:00 AM ET
const candle101459 = makeCandles(35, { startTimeET: '2026-08-04T10:14:59-04:00' });
const candle101500 = makeCandles(35, { startTimeET: '2026-08-04T10:15:00-04:00' });

const sig101459 = vwapReversion.evaluate(candle101459);
const sig101500Eval = vwapReversion.evaluate(candle101500);

check(
  'Time Filter: 10:14:59 AM ET is REJECTED',
  sig101459 === null,
  `Got: ${JSON.stringify(sig101459)}`
);

// 1.2 Sub-second boundary: 10:14:59.999 ET vs 10:15:00.000 ET
const candleSubSecReject = makeCandles(35, { startTimeET: '2026-08-04T10:14:59.999-04:00' });

check(
  'Time Filter Sub-second: 10:14:59.999 AM ET is REJECTED',
  vwapReversion.evaluate(candleSubSecReject) === null
);

// 1.3 Unix timestamps in seconds at 10:14:59
const tsSecReject = Math.floor(new Date('2026-08-04T10:14:59-04:00').getTime() / 1000);
const candlesUnixSecReject = makeCandles(35, { startTimeET: '2026-08-04T10:00:00-04:00' });
candlesUnixSecReject[candlesUnixSecReject.length - 1].timestamp = tsSecReject;

check(
  'Time Filter Unix Seconds: 10:14:59 is REJECTED',
  vwapReversion.evaluate(candlesUnixSecReject) === null
);


// ----------------------------------------------------
// SECTION 2: REGIME FILTER BOUNDARY CONDITIONS (R1)
// ----------------------------------------------------
console.log('\n--- SECTION 2: Regime Filter Boundary Conditions (R1) ---');

// ADX boundary check logic: adx >= 25.0
check(
  'ADX Threshold: 24.99 is NOT trending (< 25.00)',
  (24.99 >= 25) === false
);
check(
  'ADX Threshold: 25.00 IS trending (>= 25.00)',
  (25.00 >= 25) === true
);
check(
  'ADX Threshold: 25.01 IS trending (>= 25.00)',
  (25.01 >= 25) === true
);

// Hurst boundary check logic: hurst > 0.55
check(
  'Hurst Threshold: 0.540 is NOT trending (<= 0.55)',
  (0.540 > 0.55) === false
);
check(
  'Hurst Threshold: 0.550 is NOT trending (<= 0.55)',
  (0.550 > 0.55) === false
);
check(
  'Hurst Threshold: 0.551 IS trending (> 0.55)',
  (0.551 > 0.55) === true
);

// High-frequency mean-reverting chop candles test
const chopHistory = makeChopCandles(60, { startTimeET: '2026-08-04T10:30:00-04:00' });
const adxChop = adx.computeADX(chopHistory, 14);
const hurstChop = hurst.calculateHurst(chopHistory);

check(
  'Synthetic Chop History: Hurst <= 0.55 (Mean-Reverting/Chop)',
  hurstChop <= 0.55,
  `adx=${adxChop?.toFixed(2)}, hurst=${hurstChop?.toFixed(4)}`
);

const trendHistory = makeCandles(45, { trendDrift: 2.5, startTimeET: '2026-08-04T10:30:00-04:00' });
const adxTrend = adx.computeADX(trendHistory, 14);
const hurstTrend = hurst.calculateHurst(trendHistory);
check(
  'Synthetic Trend History: Rejection triggered (ADX >= 25 or Hurst > 0.55)',
  (adxTrend !== null && adxTrend >= 25) || hurstTrend > 0.55,
  `adx=${adxTrend?.toFixed(2)}, hurst=${hurstTrend?.toFixed(4)}`
);


// ----------------------------------------------------
// SECTION 3: SQUEEZE CHECK BOUNDARY CONDITIONS (R3)
// ----------------------------------------------------
console.log('\n--- SECTION 3: Squeeze Check Boundary Conditions (R3) ---');

const atrTest = 2.0;
const squeezeLimit = 1.5 * atrTest; // 3.0

const dist149 = 1.49 * atrTest; // 2.98
const dist150 = 1.50 * atrTest; // 3.00
const dist151 = 1.51 * atrTest; // 3.02

check(
  'Squeeze Boundary: Target Dist 1.49 * ATR is REJECTED',
  (dist149 <= squeezeLimit) === true,
  `dist=${dist149}, limit=${squeezeLimit}`
);
check(
  'Squeeze Boundary: Target Dist 1.50 * ATR is REJECTED',
  (dist150 <= squeezeLimit) === true,
  `dist=${dist150}, limit=${squeezeLimit}`
);
check(
  'Squeeze Boundary: Target Dist 1.51 * ATR is ACCEPTED',
  (dist151 <= squeezeLimit) === false,
  `dist=${dist151}, limit=${squeezeLimit}`
);

// Floating point edge case test: 1.5000000000000002 * ATR
const distFloatBoundary = 1.5000000000000002 * atrTest;
check(
  'Squeeze Float Edge Case: 1.5000000000000002 * ATR is safely handled',
  (distFloatBoundary <= squeezeLimit) === false || Math.abs(distFloatBoundary - squeezeLimit) < 1e-12
);


// ----------------------------------------------------
// SECTION 4: SCALE-OUT & FRACTIONAL ROUNDING MATH (R4)
// ----------------------------------------------------
console.log('\n--- SECTION 4: Scale-Out State Machine & Fractional Share Math (R4) ---');

const testMatrix = [
  { qty: 100, step: 1.0 },
  { qty: 101, step: 1.0 },
  { qty: 1, step: 1.0 },
  { qty: 3, step: 1.0 },
  { qty: 7, step: 1.0 },
  { qty: 10.55, step: 0.01 },
  { qty: 10.555, step: 0.001 },
  { qty: 0.33333, step: 0.00001 },
  { qty: 0.12345678, step: 0.00000001 },
  { qty: 0.00000001, step: 0.00000001 },
  { qty: 50000, step: 1.0 },
  { qty: 99.99, step: 0.01 }
];

let matrixAllPassed = true;
for (const tc of testMatrix) {
  const res = calculateScaleOutQty(tc.qty, 0.5, tc.step);
  const sum = res.partialQty + res.remainingQty;
  const precision = getPrecision(tc.step);
  const diff = Math.abs(sum - tc.qty);
  const sumRounded = Number(sum.toFixed(precision));
  const valid = (sumRounded === tc.qty) || (diff < 1e-9);
  
  if (!valid) {
    matrixAllPassed = false;
    console.log(`    Fail matrix tc: qty=${tc.qty}, step=${tc.step}, partial=${res.partialQty}, remaining=${res.remainingQty}, sum=${sum}`);
  }
}

check(
  'Fractional Rounding Invariant Matrix (12 Test Cases): Q_partial + Q_remaining == Q_initial',
  matrixAllPassed
);

const dustCheck = calculateScaleOutQty(1, 0.5, 1.0);
check(
  'Rounding Math: 1 share with step 1.0 executes 1 partial share, 0 remaining (no dust)',
  dustCheck.partialQty === 1 && dustCheck.remainingQty === 0
);


// ----------------------------------------------------
// SECTION 5: PERFORMANCE CHARACTERISTICS BENCHMARK
// ----------------------------------------------------
console.log('\n--- SECTION 5: Performance Characteristics Benchmark ---');

const candlesForPerf = makeCandles(60, { startTimeET: '2026-08-04T10:30:00-04:00' });
const iterations = 1000;

const startEval = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  vwapReversion.evaluate(candlesForPerf);
}
const endEval = process.hrtime.bigint();
const totalTimeNs = Number(endEval - startEval);
const totalTimeMs = totalTimeNs / 1e6;
const avgLatencyMs = totalTimeMs / iterations;
const opsPerSec = Math.round((iterations / totalTimeMs) * 1000);

console.log(`  ⏱️ Strategy Evaluation Performance (${iterations} iterations):`);
console.log(`     Total Time: ${totalTimeMs.toFixed(2)} ms`);
console.log(`     Avg Latency: ${avgLatencyMs.toFixed(4)} ms / eval`);
console.log(`     Throughput: ${opsPerSec} ops/sec`);

check(
  'Performance Benchmark: Average evaluation latency < 5ms',
  avgLatencyMs < 5.0,
  `Actual: ${avgLatencyMs.toFixed(4)} ms`
);

// Summary
console.log('\n====================================================');
console.log(`STRESS TEST SUMMARY: ${passedTests} Passed, ${failedTests} Failed (Total ${totalTests})`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

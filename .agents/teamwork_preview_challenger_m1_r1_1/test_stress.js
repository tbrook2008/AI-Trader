/**
 * Stress test runner for M1 VWAP Defensive Filters: R1 and R2
 */

const path = require('path');
const vwapReversion = require('../../server/quantitative/vwapReversion');
const { computeADX } = require('../../server/quantitative/adx');
const { calculateHurst } = require('../../server/quantitative/hurst');

let passed = 0;
let failed = 0;
const results = [];

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg || 'Assertion failed');
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    results.push({ name, status: 'PASS', error: null });
    passed++;
  } catch (err) {
    console.log(`❌ [FAIL] ${name}: ${err.message}`);
    results.push({ name, status: 'FAIL', error: err.message });
    failed++;
  }
}

// ─── Helper: Generate synthetic bar history ──────────────────────────────────

/**
 * Creates 30+ bars of synthetic history.
 * @param {Object} options
 * @param {string} options.regime - 'HIGH_ADX', 'HIGH_HURST', 'LOW_REGIME', 'STRONG_TREND'
 * @param {string} options.signalType - 'LONG', 'SHORT', 'NONE'
 * @param {string} options.timeET - ISO timestamp representing Eastern time
 */
function generateSyntheticHistory(options = {}) {
  const {
    numBars = 60,
    regime = 'LOW_REGIME',
    signalType = 'LONG',
    timeET = '2026-08-04T14:30:00Z' // 10:30 AM ET
  } = options;

  const baseTime = new Date(timeET).getTime() - (numBars - 1) * 60000;
  const bars = [];

  if (regime === 'STRONG_TREND' || regime === 'HIGH_ADX') {
    // Monotonic uptrend creates high ADX (>30) and high Hurst (>0.6)
    let price = 100;
    for (let i = 0; i < numBars - 1; i++) {
      price += 0.8;
      const barTime = new Date(baseTime + i * 60000).toISOString();
      bars.push({
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.3,
        close: price,
        volume: 1000,
        timestamp: barTime
      });
    }
  } else if (regime === 'HIGH_HURST_ONLY') {
    // Persistent trend with low local volatility -> Hurst > 0.55
    let price = 100;
    for (let i = 0; i < numBars - 1; i++) {
      price += 0.4 + (i % 2 === 0 ? 0.05 : -0.05);
      const barTime = new Date(baseTime + i * 60000).toISOString();
      bars.push({
        open: price - 0.1,
        high: price + 0.2,
        low: price - 0.2,
        close: price,
        volume: 1000,
        timestamp: barTime
      });
    }
  } else {
    // LOW_REGIME: Choppy / mean-reverting oscillation around 100
    for (let i = 0; i < numBars - 1; i++) {
      // Oscillate around 100 with small noise
      const delta = (i % 2 === 0 ? 0.3 : -0.3);
      const price = 100 + delta;
      const barTime = new Date(baseTime + i * 60000).toISOString();
      bars.push({
        open: price - (delta / 2),
        high: price + 0.8,
        low: price - 0.8,
        close: price,
        volume: 1000,
        timestamp: barTime
      });
    }
  }

  // Final bar setup for trigger signal
  const lastTime = new Date(baseTime + (numBars - 1) * 60000).toISOString();
  if (signalType === 'LONG') {
    // Oversold spike down below lower VWAP band (which is ~100)
    bars.push({
      open: 94.0,
      high: 94.5,
      low: 88.0,
      close: 89.0, // strong oversold close below lower band (~96)
      volume: 3500, // volume surge > 1.2x 20-bar avg (1000)
      timestamp: lastTime
    });
  } else if (signalType === 'SHORT') {
    // Overbought spike up above upper VWAP band
    bars.push({
      open: 106.0,
      high: 112.0,
      low: 105.5,
      close: 111.0,
      volume: 3500,
      timestamp: lastTime
    });
  } else {
    // Neutral bar
    bars.push({
      open: 100.0,
      high: 100.5,
      low: 99.5,
      close: 100.0,
      volume: 1000,
      timestamp: lastTime
    });
  }

  return bars;
}

console.log('=== STARTING EMPIRICAL STRESS TESTS ===\n');

// ─── SECTION 1: R1 Macro Regime Filter Tests ─────────────────────────────────

test('R1.1 High ADX (ADX >= 25): evaluate returns null despite valid LONG setup', () => {
  const history = generateSyntheticHistory({ regime: 'HIGH_ADX', signalType: 'LONG', timeET: '2026-08-04T14:30:00Z' });
  const adx = computeADX(history, 14);
  const hurst = calculateHurst(history);
  console.log(`     [Calculated metrics] ADX: ${adx?.toFixed(2)}, Hurst: ${hurst?.toFixed(4)}`);
  assert(adx !== null && adx >= 25, `Expected ADX >= 25, got ${adx}`);

  const signal = vwapReversion.evaluate(history);
  assert(signal === null, `Expected null due to high ADX (ADX=${adx?.toFixed(2)}), but got action=${signal?.action}`);
});

test('R1.2 High Hurst (Hurst > 0.55): evaluate returns null despite valid LONG setup', () => {
  const history = generateSyntheticHistory({ regime: 'HIGH_HURST_ONLY', signalType: 'LONG', timeET: '2026-08-04T14:30:00Z' });
  const adx = computeADX(history, 14);
  const hurst = calculateHurst(history);
  console.log(`     [Calculated metrics] ADX: ${adx?.toFixed(2)}, Hurst: ${hurst?.toFixed(4)}`);
  assert(hurst !== null && hurst > 0.55, `Expected Hurst > 0.55, got ${hurst}`);

  const signal = vwapReversion.evaluate(history);
  assert(signal === null, `Expected null due to high Hurst (Hurst=${hurst?.toFixed(4)}), but got action=${signal?.action}`);
});

test('R1.3 Low ADX & Low Hurst (ADX < 25 AND Hurst <= 0.55): evaluate allows signal', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:30:00Z' });
  const adx = computeADX(history, 14);
  const hurst = calculateHurst(history);
  console.log(`     [Calculated metrics] ADX: ${adx?.toFixed(2)}, Hurst: ${hurst?.toFixed(4)}`);
  assert(adx !== null && adx < 25, `Expected ADX < 25, got ${adx}`);
  assert(hurst !== null && hurst <= 0.55, `Expected Hurst <= 0.55, got ${hurst}`);

  const signal = vwapReversion.evaluate(history);
  assert(signal !== null, `Expected valid signal when ADX < 25 & Hurst <= 0.55, but got null`);
  assert(signal.action === 'LONG', `Expected LONG signal, got ${signal.action}`);
  assert(signal.metadata.adx < 25, 'Signal metadata adx should match filter');
  assert(signal.metadata.hurst <= 0.55, 'Signal metadata hurst should match filter');
});

test('R1.4 Edge Case: ADX = null or Hurst = null handled safely without crashing', () => {
  // 29 bars gives null for ADX
  const shortHistory = generateSyntheticHistory({ numBars: 29, regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:30:00Z' });
  const signal = vwapReversion.evaluate(shortHistory);
  assert(signal === null, 'Should safely return null for insufficient history (<30 bars)');
});


// ─── SECTION 2: R2 Time-of-Day Filter Tests ─────────────────────────────────

// 09:30 AM ET -> 13:30 UTC in EDT (UTC-4)
// 10:14 AM ET -> 14:14 UTC in EDT
// 10:15 AM ET -> 14:15 UTC in EDT
// 10:16 AM ET -> 14:16 UTC in EDT
// 15:59 PM ET -> 19:59 UTC in EDT

test('R2.1 09:30 AM ET: evaluate returns null (before 10:15 AM ET)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T13:30:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal === null, `Expected null at 09:30 AM ET, got ${signal?.action}`);
});

test('R2.2 10:14 AM ET: evaluate returns null (1 minute before 10:15 AM ET threshold)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:14:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal === null, `Expected null at 10:14 AM ET, got ${signal?.action}`);
});

test('R2.3 10:15 AM ET: evaluate ALLOWS signal (exact cutoff boundary)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:15:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal !== null, `Expected signal allowed at 10:15 AM ET, got null`);
  assert(signal.metadata.sessionTimeET === '10:15', `Expected sessionTimeET '10:15', got '${signal.metadata.sessionTimeET}'`);
});

test('R2.4 10:16 AM ET: evaluate ALLOWS signal (after cutoff)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:16:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal !== null, `Expected signal allowed at 10:16 AM ET, got null`);
  assert(signal.metadata.sessionTimeET === '10:16', `Expected sessionTimeET '10:16', got '${signal.metadata.sessionTimeET}'`);
});

test('R2.5 15:59 PM ET: evaluate ALLOWS signal (late afternoon bar before market close)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T19:59:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal !== null, `Expected signal allowed at 15:59 PM ET, got null`);
  assert(signal.metadata.sessionTimeET === '15:59', `Expected sessionTimeET '15:59', got '${signal.metadata.sessionTimeET}'`);
});

test('R2.6 Timestamp representations: ISO string, epoch number ms, epoch number s, Date object', () => {
  const baseHistory = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:15:00Z' });
  const lastIndex = baseHistory.length - 1;
  const isoTime = '2026-08-04T14:15:00Z';
  const epochMs = new Date(isoTime).getTime();
  const epochSec = Math.floor(epochMs / 1000);
  const dateObj = new Date(isoTime);

  // Test epoch ms
  baseHistory[lastIndex].timestamp = epochMs;
  let signal = vwapReversion.evaluate(baseHistory);
  assert(signal !== null, 'Should support epoch ms timestamp');

  // Test epoch sec
  baseHistory[lastIndex].timestamp = epochSec;
  signal = vwapReversion.evaluate(baseHistory);
  assert(signal !== null, 'Should support epoch sec timestamp');

  // Test Date object
  baseHistory[lastIndex].timestamp = dateObj;
  signal = vwapReversion.evaluate(baseHistory);
  assert(signal !== null, 'Should support Date object timestamp');
});


// ─── SECTION 3: Combination & Matrix Stress Tests ─────────────────────────────

test('Matrix test: High ADX + 10:15 AM ET -> Returns null (Filter hierarchy test)', () => {
  const history = generateSyntheticHistory({ regime: 'HIGH_ADX', signalType: 'LONG', timeET: '2026-08-04T14:15:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal === null, 'High ADX must block even at valid 10:15 AM ET time');
});

test('Matrix test: Low ADX + 10:14 AM ET -> Returns null (Time filter must block)', () => {
  const history = generateSyntheticHistory({ regime: 'LOW_REGIME', signalType: 'LONG', timeET: '2026-08-04T14:14:00Z' });
  const signal = vwapReversion.evaluate(history);
  assert(signal === null, 'Time filter must block even with low ADX/Hurst');
});

console.log(`\n========================================`);
console.log(`Stress Test Results: ${passed} PASSED, ${failed} FAILED`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

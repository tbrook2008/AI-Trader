/**
 * challenger-test.js
 * Empirical stress test suite for VWAP Reversion strategy R3 validator and Scale-Out target export.
 */

const vwapReversion = require('/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion');
const adx = require('/Users/tbrook/Desktop/AI Trader/server/quantitative/adx');
const hurst = require('/Users/tbrook/Desktop/AI Trader/server/quantitative/hurst');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testDetails = [];

function recordResult(name, success, details) {
  totalTests++;
  if (success) {
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } else {
    failedTests++;
    console.log(`❌ [FAIL] ${name}`);
  }
  testDetails.push({ name, success, details });
}

/**
 * Creates 30 bars (29 base bars + 1 trigger bar) where ADX < 25 and Hurst <= 0.55,
 * time is 10:15 AM ET or later, allowing clean isolation of R3 squeeze and scale-out logic.
 */
function makeBase30Bars(startTimeET = '2026-08-04T13:46:00Z') {
  const bars = [];
  const baseTime = new Date(startTimeET).getTime();
  for (let i = 0; i < 29; i++) {
    const price = 100 + (i % 2 === 0 ? 0.2 : -0.2);
    bars.push({
      open: price,
      high: price + 0.3,
      low: price - 0.3,
      close: price,
      volume: 1000,
      timestamp: new Date(baseTime + i * 60000).toISOString()
    });
  }
  return bars;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST GROUP 1: R3 VWAP Band Squeeze Validator Boundary Tests
// Requirement: |vwap - close| <= 1.5 * atr must return null; |vwap - close| > 1.5 * atr must pass.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Group 1: R3 VWAP Band Squeeze Validator Boundary Tests ---');

try {
  // Test 1.1: Squeeze detected when |vwap - close| <= 1.5 * atr (e.g. SQUEEZE scenario)
  {
    const bars = makeBase30Bars('2026-08-04T13:46:00Z');
    // Modify bars to widen ATR (high/low wide) while keeping close near VWAP
    for (let i = 0; i < bars.length; i++) {
      bars[i].high = bars[i].close + 1.2;
      bars[i].low = bars[i].close - 1.2;
    }
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    bars.push({
      open: 99.1,
      high: 100.3,
      low: 97.9,
      close: 98.9,
      volume: 3000,
      timestamp: lastTimeISO
    });

    const vwapData = vwapReversion.calculateVWAP(bars);
    const atr = vwapReversion.calculateATR(bars, 14);
    const lastClose = bars[bars.length - 1].close;
    const dist = Math.abs(vwapData.vwap - lastClose);
    const thresh = 1.5 * atr;

    const signal = vwapReversion.evaluate(bars);
    const ok = (dist <= thresh) && (signal === null);

    recordResult(
      'R3 Squeeze: Squeeze detected (|vwap - close| <= 1.5 * atr) returns null',
      ok,
      `dist=${dist.toFixed(4)}, 1.5*atr=${thresh.toFixed(4)}, dist<=thresh=${dist <= thresh}, signal=${signal ? signal.action : 'null'}`
    );
  }

  // Test 1.2: Boundary exact equality simulation: |vwap - close| === 1.5 * atr
  {
    const bars = makeBase30Bars('2026-08-04T13:46:00Z');
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    bars.push({
      open: 95.0,
      high: 95.0,
      low: 89.5,
      close: 90.0,
      volume: 3000,
      timestamp: lastTimeISO
    });

    const vwapData = vwapReversion.calculateVWAP(bars);
    const atr = vwapReversion.calculateATR(bars, 14);
    const vwap = vwapData.vwap;
    const thresh = 1.5 * atr;

    // Force close to be EXACTLY vwap - 1.5 * atr
    const exactClose = vwap - thresh;
    bars[bars.length - 1].close = exactClose;

    const newDist = Math.abs(vwapData.vwap - exactClose);
    const signal = vwapReversion.evaluate(bars);
    const ok = (signal === null);

    recordResult(
      'R3 Squeeze: Boundary exact equality (|vwap - close| === 1.5 * atr) returns null',
      ok,
      `dist=${newDist.toFixed(6)}, 1.5*atr=${thresh.toFixed(6)}, signal=${signal ? signal.action : 'null'}`
    );
  }

  // Test 1.3: Boundary breach pass: |vwap - close| > 1.5 * atr (e.g. 1.501 * atr)
  {
    const bars = makeBase30Bars('2026-08-04T13:46:00Z');
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    bars.push({
      open: 95.0,
      high: 95.0,
      low: 89.5,
      close: 90.0,
      volume: 3000,
      timestamp: lastTimeISO
    });

    const vwapData = vwapReversion.calculateVWAP(bars);
    const atr = vwapReversion.calculateATR(bars, 14);
    const vwap = vwapData.vwap;
    const thresh = 1.5 * atr;

    // Force close to be slightly further than 1.5 * atr (vwap - 1.501 * atr)
    // Note: ensure close is also <= lowerBand for LONG signal
    const passClose = Math.min(vwap - (1.501 * atr), vwapData.lowerBand - 0.01);
    bars[bars.length - 1].close = passClose;
    bars[bars.length - 1].low = Math.min(bars[bars.length - 1].low, passClose - 0.1);

    const newDist = Math.abs(vwapData.vwap - passClose);
    const signal = vwapReversion.evaluate(bars);
    const ok = (newDist > thresh) && (signal !== null && signal.action === 'LONG');

    recordResult(
      'R3 Squeeze: Boundary expansion (|vwap - close| > 1.5 * atr) passes squeeze validator',
      ok,
      `dist=${newDist.toFixed(6)}, 1.5*atr=${thresh.toFixed(6)}, signal=${signal ? signal.action : 'null'}`
    );
  }

} catch (err) {
  recordResult('Group 1 Exception', false, err.stack);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST GROUP 2: Scale Out Target Export & Metadata Verification
// Requirements:
// - LONG signals: scaleOutTarget === vwap - sd (lowerBand1SD)
// - SHORT signals: scaleOutTarget === vwap + sd (upperBand1SD)
// - upperBand1SD and lowerBand1SD present in metadata
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Group 2: Scale Out Target Export & Metadata Integrity ---');

try {
  // Test 2.1: LONG Signal Scale Out Target Export & Metadata
  {
    const bars = makeBase30Bars('2026-08-04T13:46:00Z');
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    bars.push({
      open: 95.0,
      high: 95.0,
      low: 89.5,
      close: 90.0,
      volume: 3000,
      timestamp: lastTimeISO
    });

    const signal = vwapReversion.evaluate(bars);
    const vwapData = vwapReversion.calculateVWAP(bars);

    const isLong = signal && signal.action === 'LONG';
    const expectedScaleOut = vwapData.vwap - vwapData.sd;
    const scaleOutMatch = signal && signal.scaleOutTarget === expectedScaleOut;
    const lowerBand1SDMatch = signal && signal.scaleOutTarget === signal.metadata.lowerBand1SD;
    const upperBand1SDExists = signal && typeof signal.metadata.upperBand1SD === 'number';
    const lowerBand1SDExists = signal && typeof signal.metadata.lowerBand1SD === 'number';
    const metadataUpperMatch = signal && signal.metadata.upperBand1SD === (vwapData.vwap + vwapData.sd);
    const metadataLowerMatch = signal && signal.metadata.lowerBand1SD === (vwapData.vwap - vwapData.sd);

    const ok = isLong && scaleOutMatch && lowerBand1SDMatch && upperBand1SDExists && lowerBand1SDExists && metadataUpperMatch && metadataLowerMatch;

    recordResult(
      'LONG Signal: scaleOutTarget === vwap - sd (lowerBand1SD) & metadata bands verified',
      ok,
      `action=${signal?.action}, scaleOutTarget=${signal?.scaleOutTarget}, lowerBand1SD=${signal?.metadata?.lowerBand1SD}, upperBand1SD=${signal?.metadata?.upperBand1SD}`
    );
  }

  // Test 2.2: SHORT Signal Scale Out Target Export & Metadata
  {
    const bars = makeBase30Bars('2026-08-04T13:46:00Z');
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    bars.push({
      open: 105.0,
      high: 111.0,
      low: 105.0,
      close: 110.0,
      volume: 3000,
      timestamp: lastTimeISO
    });

    const signal = vwapReversion.evaluate(bars);
    const vwapData = vwapReversion.calculateVWAP(bars);

    const isShort = signal && signal.action === 'SHORT';
    const expectedScaleOut = vwapData.vwap + vwapData.sd;
    const scaleOutMatch = signal && signal.scaleOutTarget === expectedScaleOut;
    const upperBand1SDMatch = signal && signal.scaleOutTarget === signal.metadata.upperBand1SD;
    const upperBand1SDExists = signal && typeof signal.metadata.upperBand1SD === 'number';
    const lowerBand1SDExists = signal && typeof signal.metadata.lowerBand1SD === 'number';
    const metadataUpperMatch = signal && signal.metadata.upperBand1SD === (vwapData.vwap + vwapData.sd);
    const metadataLowerMatch = signal && signal.metadata.lowerBand1SD === (vwapData.vwap - vwapData.sd);

    const ok = isShort && scaleOutMatch && upperBand1SDMatch && upperBand1SDExists && lowerBand1SDExists && metadataUpperMatch && metadataLowerMatch;

    recordResult(
      'SHORT Signal: scaleOutTarget === vwap + sd (upperBand1SD) & metadata bands verified',
      ok,
      `action=${signal?.action}, scaleOutTarget=${signal?.scaleOutTarget}, upperBand1SD=${signal?.metadata?.upperBand1SD}, lowerBand1SD=${signal?.metadata?.lowerBand1SD}`
    );
  }

  // Test 2.3: Monotonicity & Risk Boundary Check
  // For LONG: stopLoss < entry < scaleOutTarget < target (vwap)
  // For SHORT: stopLoss > entry > scaleOutTarget > target (vwap)
  {
    const longBars = makeBase30Bars('2026-08-04T13:46:00Z');
    longBars.push({
      open: 95.0, high: 95.0, low: 89.5, close: 90.0, volume: 3000,
      timestamp: new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString()
    });
    const longSig = vwapReversion.evaluate(longBars);

    const shortBars = makeBase30Bars('2026-08-04T13:46:00Z');
    shortBars.push({
      open: 105.0, high: 111.0, low: 105.0, close: 110.0, volume: 3000,
      timestamp: new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString()
    });
    const shortSig = vwapReversion.evaluate(shortBars);

    const longMonotonic = longSig && (longSig.stopLoss < longSig.entry) && (longSig.entry < longSig.scaleOutTarget) && (longSig.scaleOutTarget < longSig.target);
    const shortMonotonic = shortSig && (shortSig.stopLoss > shortSig.entry) && (shortSig.entry > shortSig.scaleOutTarget) && (shortSig.scaleOutTarget > shortSig.target);

    const ok = longMonotonic && shortMonotonic;

    recordResult(
      'Risk & Profit Structure Monotonicity (Stop -> Entry -> ScaleOut -> Target)',
      ok,
      `LONG Monotonic: ${longMonotonic} (${longSig?.stopLoss?.toFixed(2)} < ${longSig?.entry} < ${longSig?.scaleOutTarget?.toFixed(2)} < ${longSig?.target?.toFixed(2)}); SHORT Monotonic: ${shortMonotonic} (${shortSig?.stopLoss?.toFixed(2)} > ${shortSig?.entry} > ${shortSig?.scaleOutTarget?.toFixed(2)} > ${shortSig?.target?.toFixed(2)})`
    );
  }

} catch (err) {
  recordResult('Group 2 Exception', false, err.stack);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST GROUP 3: Edge & Failure Mode Mining
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Group 3: Edge & Failure Mode Mining ---');

try {
  // Test 3.1: Zero ATR / Zero SD handling test
  {
    const flatBars = [];
    const baseTime = new Date('2026-08-04T13:46:00Z').getTime();
    for (let i = 0; i < 30; i++) {
      flatBars.push({
        open: 100.0, high: 100.0, low: 100.0, close: 100.0, volume: 1000,
        timestamp: new Date(baseTime + i * 60000).toISOString()
      });
    }
    const signal = vwapReversion.evaluate(flatBars);
    // Flat bars have ATR = 0, distance = 0 <= 1.5 * 0 -> returns null safely
    const ok = (signal === null);
    recordResult(
      'Edge Case: Zero ATR / Flat market returns null without NaN/throw',
      ok,
      `signal=${signal}`
    );
  }

  // Test 3.2: High ATR / High Volatility Squeeze Check
  {
    const volBars = makeBase30Bars('2026-08-04T13:46:00Z');
    // Extremely wide candles: high - low = 100.0 (ATR ~ 100)
    for (let i = 0; i < volBars.length; i++) {
      volBars[i].high = volBars[i].close + 50.0;
      volBars[i].low = volBars[i].close - 50.0;
    }
    const lastTimeISO = new Date(new Date('2026-08-04T13:46:00Z').getTime() + 29 * 60000).toISOString();
    volBars.push({
      open: 95.0, high: 95.0, low: 89.5, close: 90.0, volume: 3000, timestamp: lastTimeISO
    });

    const vwapData = vwapReversion.calculateVWAP(volBars);
    const atr = vwapReversion.calculateATR(volBars, 14);
    const dist = Math.abs(vwapData.vwap - 90.0);
    const thresh = 1.5 * atr;

    const signal = vwapReversion.evaluate(volBars);
    // Since ATR is ~100, 1.5 * ATR is ~150, but distance |vwap - close| is only ~10.
    // 10 <= 150 -> Squeeze detected! Must return null.
    const ok = (dist <= thresh) && (signal === null);

    recordResult(
      'Edge Case: Extreme ATR expansion causes Squeeze rejection as expected',
      ok,
      `dist=${dist.toFixed(2)}, 1.5*atr=${thresh.toFixed(2)}, signal=${signal}`
    );
  }

} catch (err) {
  recordResult('Group 3 Exception', false, err.stack);
}

console.log(`\n==================================================`);
console.log(`SUMMARY: Total=${totalTests}, Passed=${passedTests}, Failed=${failedTests}`);
console.log(`VERDICT: ${failedTests === 0 ? 'APPROVE' : 'REJECT'}`);
process.exit(failedTests === 0 ? 0 : 1);

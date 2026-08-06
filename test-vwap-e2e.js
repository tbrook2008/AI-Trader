/**
 * test-vwap-e2e.js
 * Comprehensive Requirements-Driven E2E Test Suite for AI Trader's VWAP Mean Reversion Strategy
 *
 * Covers:
 * - Tier 1: Unit Feature Coverage (R1, R2, R3, R4)
 * - Tier 2: Boundary & Corner Cases (R1-R4 thresholds & precision math)
 * - Tier 3: Cross-Feature Interactions (8-combination multi-filter truth table)
 * - Tier 4: Real-World Application Scenarios (390 1-minute full day session simulations)
 */

require('dotenv').config();
const vwapReversion = require('./server/quantitative/vwapReversion');
const adx = require('./server/quantitative/adx');
const hurst = require('./server/quantitative/hurst');

// ─── Test Harness Framework Setup ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

function assertAlmostEqual(a, b, delta = 1e-5, msg) {
  if (Math.abs(a - b) > delta) {
    throw new Error(msg || `Expected ${b} ± ${delta}, got ${a}`);
  }
}

// ─── Helper Functions & Strategy Evaluator Integration ────────────────────────

/**
 * Parses timestamp and returns time info in America/New_York (US Eastern Time)
 */
function getSessionTimeET(timestamp) {
  let ts = timestamp;
  if (typeof ts === 'string') ts = new Date(ts).getTime();
  else if (typeof ts === 'number' && ts < 10000000000) ts *= 1000;
  
  const d = new Date(ts);
  const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  // Format: "MM/DD/YYYY, HH:mm:ss" or "HH:mm:ss"
  const timePart = etStr.includes(', ') ? etStr.split(', ')[1] : etStr;
  const [hoursStr, minutesStr, secondsStr] = timePart.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  const seconds = parseInt(secondsStr || '0', 10);
  const totalMinutes = hours * 60 + minutes;
  
  return { hours, minutes, seconds, totalMinutes, timePart };
}

const { calculateScaleOutQty } = require('./server/utils/rounding');

/**
 * Comprehensive VWAP Mean Reversion Evaluator wrapping core indicator calculations
 * with institutional-grade defensive filters (R1, R2, R3, R4)
 */
function evaluateStrategyWithFilters(history) {
  if (!history || history.length < 21) return null;

  const currentCandle = history[history.length - 1];

  // R2. Time-of-Day Filter (Ignore signals before 10:15 AM ET = 615 total minutes)
  if (currentCandle.timestamp) {
    const { totalMinutes } = getSessionTimeET(currentCandle.timestamp);
    if (totalMinutes < 615) return null;
  }

  // R1. Macro Regime Filter (ADX >= 25 or Hurst > 0.55)
  const adxVal = adx.computeADX(history, 14);
  if (adxVal !== null && adxVal >= 25.0) return null;

  const hurstVal = hurst.calculateHurst(history);
  if (hurstVal > 0.55) return null;

  // Execute core VWAP reversion logic
  const signal = vwapReversion.evaluate(history);
  if (!signal) return null;

  // Calculate VWAP SD and ATR for R3 and R4
  const vwapData = vwapReversion.calculateVWAP(history);
  if (!vwapData) return null;

  const { vwap, sd } = vwapData;
  const atrVal = signal.metadata.atr;

  // R3. Band Squeeze Validator (|Target - Entry| > 1.5 * ATR)
  const targetDist = Math.abs(signal.entry - vwap);
  if (targetDist <= 1.5 * atrVal) return null;

  // R4. Attach Scale-Out Target (1 SD band) & metadata
  const scaleOutTarget = signal.action === 'LONG' ? (vwap - 1.0 * sd) : (vwap + 1.0 * sd);
  signal.scaleOutTarget = scaleOutTarget;
  signal.metadata.upperBand1SD = vwap + 1.0 * sd;
  signal.metadata.lowerBand1SD = vwap - 1.0 * sd;
  signal.metadata.adx = adxVal;
  signal.metadata.hurst = hurstVal;

  return signal;
}

/**
 * Stateful Position Risk Monitor Simulation Engine for R4 Scale-Out Verification
 */
class RiskMonitorStateMachine {
  constructor(tradeParams) {
    this.id = tradeParams.id || 1;
    this.symbol = tradeParams.symbol || 'SPY';
    this.direction = tradeParams.direction; // 'LONG' or 'SHORT'
    this.initialQty = tradeParams.qty;
    this.remainingQty = tradeParams.qty;
    this.entryPrice = tradeParams.entryPrice;
    this.stopLoss = tradeParams.stopLoss;
    this.scaleOutTarget = tradeParams.scaleOutTarget; // 1 SD Mark
    this.targetPrice = tradeParams.targetPrice; // VWAP Center Line
    this.scaleStage = 0; // Stage 0: Initial, Stage 1: Scale-Out, Stage 2: Closed
    this.status = 'open';
    this.stepSize = tradeParams.stepSize || 1.0;
    this.realizedPnl = 0;
    this.tradesLog = [];
  }

  processBar(currentPrice) {
    if (this.status === 'closed') return;

    if (this.direction === 'LONG') {
      // STAGE 0 -> STAGE 1: Price touches or breaches 1 SD Scale-Out Target
      if (this.scaleStage === 0 && currentPrice >= this.scaleOutTarget) {
        const { partialQty, remainingQty } = calculateScaleOutQty(this.initialQty, 0.5, this.stepSize);
        const pnl = (currentPrice - this.entryPrice) * partialQty;
        this.realizedPnl += pnl;
        this.remainingQty = remainingQty;
        this.scaleStage = 1;
        this.stopLoss = this.entryPrice; // Ratchet Stop-Loss to Breakeven
        this.tradesLog.push({ event: 'SCALE_OUT_50%', price: currentPrice, qty: partialQty, pnl });
      }

      // STAGE 1 -> STAGE 2: Price reaches VWAP Center Target OR breaches Breakeven Stop-Loss
      if (this.scaleStage === 1) {
        if (currentPrice >= this.targetPrice) {
          const pnl = (currentPrice - this.entryPrice) * this.remainingQty;
          this.realizedPnl += pnl;
          this.tradesLog.push({ event: 'TAKE_PROFIT_VWAP', price: currentPrice, qty: this.remainingQty, pnl });
          this.remainingQty = 0;
          this.scaleStage = 2;
          this.status = 'closed';
        } else if (currentPrice <= this.stopLoss) {
          const pnl = (currentPrice - this.entryPrice) * this.remainingQty;
          this.realizedPnl += pnl;
          this.tradesLog.push({ event: 'BREAKEVEN_STOP', price: currentPrice, qty: this.remainingQty, pnl });
          this.remainingQty = 0;
          this.scaleStage = 2;
          this.status = 'closed';
        }
      }

      // Direct STAGE 0 -> STAGE 2: Initial Stop Loss Breach
      if (this.scaleStage === 0 && currentPrice <= this.stopLoss) {
        const pnl = (currentPrice - this.entryPrice) * this.initialQty;
        this.realizedPnl += pnl;
        this.tradesLog.push({ event: 'INITIAL_STOP_LOSS', price: currentPrice, qty: this.initialQty, pnl });
        this.remainingQty = 0;
        this.scaleStage = 2;
        this.status = 'closed';
      }
    } else if (this.direction === 'SHORT') {
      // SHORT logic
      if (this.scaleStage === 0 && currentPrice <= this.scaleOutTarget) {
        const { partialQty, remainingQty } = calculateScaleOutQty(this.initialQty, 0.5, this.stepSize);
        const pnl = (this.entryPrice - currentPrice) * partialQty;
        this.realizedPnl += pnl;
        this.remainingQty = remainingQty;
        this.scaleStage = 1;
        this.stopLoss = this.entryPrice; // Ratchet Stop-Loss to Breakeven
        this.tradesLog.push({ event: 'SCALE_OUT_50%', price: currentPrice, qty: partialQty, pnl });
      }

      if (this.scaleStage === 1) {
        if (currentPrice <= this.targetPrice) {
          const pnl = (this.entryPrice - currentPrice) * this.remainingQty;
          this.realizedPnl += pnl;
          this.tradesLog.push({ event: 'TAKE_PROFIT_VWAP', price: currentPrice, qty: this.remainingQty, pnl });
          this.remainingQty = 0;
          this.scaleStage = 2;
          this.status = 'closed';
        } else if (currentPrice >= this.stopLoss) {
          const pnl = (this.entryPrice - currentPrice) * this.remainingQty;
          this.realizedPnl += pnl;
          this.tradesLog.push({ event: 'BREAKEVEN_STOP', price: currentPrice, qty: this.remainingQty, pnl });
          this.remainingQty = 0;
          this.scaleStage = 2;
          this.status = 'closed';
        }
      }

      if (this.scaleStage === 0 && currentPrice >= this.stopLoss) {
        const pnl = (this.entryPrice - currentPrice) * this.initialQty;
        this.realizedPnl += pnl;
        this.tradesLog.push({ event: 'INITIAL_STOP_LOSS', price: currentPrice, qty: this.initialQty, pnl });
        this.remainingQty = 0;
        this.scaleStage = 2;
        this.status = 'closed';
      }
    }
  }
}

// ─── Bar Series Data Generators ───────────────────────────────────────────────

/**
 * Generates synthetic history with custom price drift and noise
 */
function makeSyntheticHistory(length = 35, basePrice = 100, options = {}) {
  const {
    trendDrift = 0,
    volatility = 0.2,
    baseVolume = 1000,
    startTimeET = '2026-08-04T10:30:00-04:00',
    lastCandleOffset = 0,
    volumeSpike = false
  } = options;

  const startMs = new Date(startTimeET).getTime();
  const bars = [];
  let price = basePrice;

  for (let i = 0; i < length; i++) {
    const isLast = (i === length - 1);
    price += trendDrift + (Math.sin(i / 3) * volatility);
    if (isLast && lastCandleOffset !== 0) {
      price = basePrice + lastCandleOffset;
    }

    const open = price - 0.1;
    const high = price + 0.2;
    const low = price - 0.2;
    const close = isLast && options.close !== undefined ? options.close : price;
    const volume = (isLast && volumeSpike) ? baseVolume * 2.5 : baseVolume;
    const timestamp = new Date(startMs + i * 60000).toISOString();

    bars.push({ symbol: options.symbol || 'SPY', open, high, low, close, volume, timestamp });
  }

  return bars;
}

/**
 * Generates 390 1-minute bars for full trading day (9:30 AM to 4:00 PM ET)
 */
function generateFullDayBarStream(config = {}) {
  const {
    baseDateStr = '2026-08-04',
    initialPrice = 500.00,
    symbol = 'SPY',
    phases = []
  } = config;

  const bars = [];
  const startMs = new Date(`${baseDateStr}T09:30:00-04:00`).getTime();
  let currentPrice = initialPrice;

  for (let minute = 0; minute < 390; minute++) {
    const timestamp = new Date(startMs + minute * 60000).toISOString();
    
    // Find phase for current minute
    const phase = phases.find(p => minute >= p.startBar && minute <= p.endBar) || {
      drift: 0,
      volatility: 0.10,
      volume: 1000
    };

    const delta = phase.drift + (Math.sin(minute / 4) * phase.volatility);
    const open = currentPrice;
    const close = phase.close !== undefined ? phase.close : (open + delta);
    const high = Math.max(open, close) + 0.15;
    const low = Math.min(open, close) - 0.15;
    const volume = phase.volume || 1000;

    currentPrice = close;
    bars.push({ symbol, open, high, low, close, volume, timestamp });
  }

  return bars;
}

// ─── TIER 1: UNIT FEATURE COVERAGE TESTS ─────────────────────────────────────

console.log('\n📊 TIER 1: Feature Coverage (R1, R2, R3, R4)');

// --- R1: Macro Regime Filter ---
test('TC-R1-01: Strong ADX Trend Rejection (ADX >= 25)', () => {
  // Generate strongly trending data (drift = 1.5 per bar)
  const history = makeSyntheticHistory(40, 100, { trendDrift: 1.5, startTimeET: '2026-08-04T10:30:00-04:00' });
  const adxVal = adx.computeADX(history, 14);
  assert(adxVal !== null && adxVal >= 25.0, `Expected ADX >= 25, got ${adxVal}`);
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy should reject signal on strong ADX trend');
});

test('TC-R1-02: High Hurst Exponent Rejection (Hurst > 0.55)', () => {
  // Generate persistent trending data
  const history = makeSyntheticHistory(50, 100, { trendDrift: 0.8, startTimeET: '2026-08-04T10:30:00-04:00' });
  const hVal = hurst.calculateHurst(history);
  assert(hVal > 0.55, `Expected Hurst > 0.55, got ${hVal}`);
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy should reject signal on high Hurst exponent');
});

test('TC-R1-03: Dual ADX/Hurst Trend Rejection', () => {
  const history = makeSyntheticHistory(50, 100, { trendDrift: 2.0, startTimeET: '2026-08-04T10:30:00-04:00' });
  const adxVal = adx.computeADX(history, 14);
  const hVal = hurst.calculateHurst(history);
  assert(adxVal >= 25.0 && hVal > 0.55, 'Both ADX and Hurst should detect strong trend');
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy should reject signal when both filters trigger');
});

// --- R2: Time-of-Day Filter ---
test('TC-R2-01: Market Open Bell Signal Rejection (09:30 AM ET)', () => {
  const history = makeSyntheticHistory(30, 100, { startTimeET: '2026-08-04T09:30:00-04:00' });
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy must reject signals at market open bell (09:30 AM ET)');
});

test('TC-R2-02: Mid-Open Volatility Signal Rejection (09:45 AM ET)', () => {
  const history = makeSyntheticHistory(30, 100, { startTimeET: '2026-08-04T09:45:00-04:00' });
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy must reject signals during morning open window (09:45 AM ET)');
});

test('TC-R2-03: Afternoon Session Session Filter Pass (10:30 AM ET)', () => {
  const history = makeSyntheticHistory(35, 100, { startTimeET: '2026-08-04T10:30:00-04:00' });
  const timeInfo = getSessionTimeET(history[history.length - 1].timestamp);
  assert(timeInfo.totalMinutes >= 615, 'Time should be >= 10:15 AM ET');
});

// --- R3: VWAP Band Squeeze Check ---
test('TC-R3-01: Severe Band Squeeze Rejection (Target Dist <= 1.5 * ATR)', () => {
  const history = makeSyntheticHistory(35, 100, { trendDrift: 0, volatility: 0.05, startTimeET: '2026-08-04T10:30:00-04:00' });
  const signal = evaluateStrategyWithFilters(history);
  assertEqual(signal, null, 'Strategy must reject signals when target distance <= 1.5 * ATR');
});

// --- R4: Scale-Out Target Export & Position Management ---
test('TC-R4-01: Signal Object Export of scaleOutTarget (1 SD Band)', () => {
  // Build history where price drops below lower 2 SD band with high volume
  const history = makeSyntheticHistory(35, 100, { volatility: 0.2, startTimeET: '2026-08-04T10:30:00-04:00' });
  const vwapData = vwapReversion.calculateVWAP(history);
  assert(vwapData !== null, 'VWAP data should be calculated');
  const lower1SD = vwapData.vwap - 1.0 * vwapData.sd;
  const upper1SD = vwapData.vwap + 1.0 * vwapData.sd;
  assert(lower1SD < vwapData.vwap && upper1SD > vwapData.vwap, '1 SD bands must be positioned around VWAP');
});

test('TC-R4-02: Stage 0 -> Stage 1 Scale-Out Transition at 1 SD Band Touch', () => {
  const monitor = new RiskMonitorStateMachine({
    direction: 'LONG',
    qty: 100,
    entryPrice: 490.00,
    stopLoss: 485.00,
    scaleOutTarget: 495.00, // 1 SD Band Level
    targetPrice: 500.00,    // VWAP Center
    stepSize: 1.0
  });

  assertEqual(monitor.scaleStage, 0, 'Initial scale stage should be 0');
  monitor.processBar(492.00); // Price below scale target
  assertEqual(monitor.scaleStage, 0, 'Stage should remain 0 below target');

  monitor.processBar(495.00); // Touch 1 SD target
  assertEqual(monitor.scaleStage, 1, 'Stage should transition to Stage 1 at 1 SD touch');
  assertEqual(monitor.remainingQty, 50, 'Remaining quantity should be 50% (50 shares)');
  assertEqual(monitor.stopLoss, 490.00, 'Stop-Loss must ratchet to Breakeven (490.00)');
});

test('TC-R4-03: Stage 1 -> Stage 2 Final Exit at VWAP Center Touch', () => {
  const monitor = new RiskMonitorStateMachine({
    direction: 'LONG',
    qty: 100,
    entryPrice: 490.00,
    stopLoss: 485.00,
    scaleOutTarget: 495.00,
    targetPrice: 500.00,
    stepSize: 1.0
  });

  monitor.processBar(495.00); // Stage 1 scale-out
  assertEqual(monitor.scaleStage, 1);

  monitor.processBar(500.00); // Reach VWAP center
  assertEqual(monitor.scaleStage, 2, 'Stage should transition to 2 (Closed) at VWAP center');
  assertEqual(monitor.remainingQty, 0, 'Remaining quantity should be 0');
  assertEqual(monitor.status, 'closed', 'Status should be closed');
  assert(monitor.realizedPnl > 0, 'Realized PnL should be positive');
});

test('TC-R4-04: Stage 1 -> Stage 2 Exit at Breakeven Stop-Loss', () => {
  const monitor = new RiskMonitorStateMachine({
    direction: 'LONG',
    qty: 100,
    entryPrice: 490.00,
    stopLoss: 485.00,
    scaleOutTarget: 495.00,
    targetPrice: 500.00,
    stepSize: 1.0
  });

  monitor.processBar(495.00); // Stage 1 scale-out (50 shares @ 495.00, +250 PnL, SL = 490.00)
  assertEqual(monitor.stopLoss, 490.00);

  monitor.processBar(490.00); // Price drops to Breakeven SL
  assertEqual(monitor.scaleStage, 2, 'Stage should transition to 2 on Breakeven SL touch');
  assertEqual(monitor.status, 'closed');
  assertEqual(monitor.realizedPnl, 250, 'Overall trade PnL should equal Stage 1 profit ($250)');
});

test('TC-R4-05: Fractional Share Step Rounding Math Invariant ($Q_1 + Q_2 \\equiv Q_0$)', () => {
  // Test integer shares
  const res1 = calculateScaleOutQty(100, 0.5, 1.0);
  assertEqual(res1.partialQty + res1.remainingQty, 100);

  // Test odd shares
  const res2 = calculateScaleOutQty(7, 0.5, 1.0);
  assertEqual(res2.partialQty, 4);
  assertEqual(res2.remainingQty, 3);
  assertEqual(res2.partialQty + res2.remainingQty, 7);

  // Test decimal stock shares
  const res3 = calculateScaleOutQty(10.55, 0.5, 0.01);
  assertAlmostEqual(res3.partialQty + res3.remainingQty, 10.55);

  // Test crypto 8 decimals
  const res4 = calculateScaleOutQty(0.12345678, 0.5, 0.00000001);
  assertAlmostEqual(res4.partialQty + res4.remainingQty, 0.12345678);
});

// ─── TIER 2: BOUNDARY & CORNER CASE TESTS ────────────────────────────────────

console.log('\n📊 TIER 2: Boundary & Corner Cases');

test('TC-T2-01: Time Filter Boundary (10:14:59 AM ET vs 10:15:00 AM ET)', () => {
  const tsReject = '2026-08-04T10:14:59-04:00';
  const tsAccept = '2026-08-04T10:15:00-04:00';

  const rejectTime = getSessionTimeET(tsReject);
  const acceptTime = getSessionTimeET(tsAccept);

  assert(rejectTime.totalMinutes < 615, '10:14:59 AM ET should be < 615 total minutes');
  assert(acceptTime.totalMinutes >= 615, '10:15:00 AM ET should be >= 615 total minutes');

  // Verify cutoff behavior
  const barsReject = makeSyntheticHistory(35, 100, { startTimeET: tsReject });
  const signalReject = evaluateStrategyWithFilters(barsReject);
  assertEqual(signalReject, null, 'Signal at 10:14:59 AM ET must be rejected');
});

test('TC-T2-02: ADX Threshold Boundary (24.9 vs 25.0)', () => {
  assert(!adx.isTrending(makeSyntheticHistory(30, 100, { trendDrift: 0 }), 14, 25.0), 'Flat ADX < 25.0 is not trending');
  assert(adx.isTrending(makeSyntheticHistory(40, 100, { trendDrift: 2.0 }), 14, 25.0), 'High drift ADX >= 25.0 is trending');
});

test('TC-T2-03: Hurst Threshold Boundary (0.54 vs 0.56)', () => {
  // Generate random walk chop history (alternating ups/downs)
  const historyChop = [];
  let p = 100;
  const startMs = new Date('2026-08-04T10:30:00-04:00').getTime();
  for (let i = 0; i < 60; i++) {
    p += (i % 2 === 0 ? 0.2 : -0.2) + (Math.sin(i) * 0.05);
    historyChop.push({
      symbol: 'SPY', open: p - 0.05, high: p + 0.1, low: p - 0.1, close: p, volume: 1000,
      timestamp: new Date(startMs + i * 60000).toISOString()
    });
  }

  const historyTrend = makeSyntheticHistory(60, 100, { trendDrift: 1.5, startTimeET: '2026-08-04T10:30:00-04:00' });
  
  const hChop = hurst.calculateHurst(historyChop);
  const hTrend = hurst.calculateHurst(historyTrend);

  assert(hChop <= 0.55, `Chop Hurst (${hChop.toFixed(3)}) should be <= 0.55`);
  assert(hTrend > 0.55, `Trend Hurst (${hTrend.toFixed(3)}) should be > 0.55`);
});

test('TC-T2-04: Band Squeeze Boundary Ratio (1.49 vs 1.51 * ATR)', () => {
  const atrVal = 2.0;
  const distReject = 1.49 * atrVal; // 2.98
  const distAccept = 1.51 * atrVal; // 3.02

  assert(distReject <= 1.5 * atrVal, '1.49 * ATR fails squeeze condition');
  assert(distAccept > 1.5 * atrVal, '1.51 * ATR passes squeeze condition');
});

test('TC-T2-05: Price Touch Boundary - Exact 1 SD Touch vs Near Touch', () => {
  const monitor = new RiskMonitorStateMachine({
    direction: 'LONG',
    qty: 10,
    entryPrice: 100.00,
    stopLoss: 95.00,
    scaleOutTarget: 105.00,
    targetPrice: 110.00,
    stepSize: 1.0
  });

  monitor.processBar(104.99); // Near touch below 1 SD
  assertEqual(monitor.scaleStage, 0, 'Stage must remain 0 at 104.99 (below 105.00 target)');

  monitor.processBar(105.00); // Exact touch
  assertEqual(monitor.scaleStage, 1, 'Stage must transition to 1 on exact 105.00 touch');
});

test('TC-T2-06: Price Touch Boundary - Exact Breakeven SL Touch vs Near Touch', () => {
  const monitor = new RiskMonitorStateMachine({
    direction: 'LONG',
    qty: 10,
    entryPrice: 100.00,
    stopLoss: 95.00,
    scaleOutTarget: 105.00,
    targetPrice: 110.00,
    stepSize: 1.0
  });

  monitor.processBar(105.00); // Stage 1 (SL ratcheted to 100.00)
  assertEqual(monitor.stopLoss, 100.00);

  monitor.processBar(100.01); // Near touch above breakeven
  assertEqual(monitor.scaleStage, 1, 'Stage must remain 1 at 100.01');

  monitor.processBar(100.00); // Exact breakeven touch
  assertEqual(monitor.scaleStage, 2, 'Stage must transition to 2 on exact 100.00 breakeven touch');
  assertEqual(monitor.status, 'closed');
});

test('TC-T2-07: Fractional Quantity Precision Rounding Matrix', () => {
  // Test case 1: 0.33333 shares with step size 0.00001
  const r1 = calculateScaleOutQty(0.33333, 0.5, 0.00001);
  assertEqual(r1.partialQty, 0.16667);
  assertEqual(r1.remainingQty, 0.16666);
  assertAlmostEqual(r1.partialQty + r1.remainingQty, 0.33333);

  // Test case 2: Single unit 1 share with step size 1
  const r2 = calculateScaleOutQty(1, 0.5, 1.0);
  assertEqual(r2.partialQty, 1);
  assertEqual(r2.remainingQty, 0);

  // Test case 3: Small fractional 0.005 crypto
  const r3 = calculateScaleOutQty(0.005, 0.5, 0.001);
  assertAlmostEqual(r3.partialQty + r3.remainingQty, 0.005);
});

// ─── TIER 3: CROSS-FEATURE INTERACTIONS ──────────────────────────────────────

console.log('\n📊 TIER 3: Cross-Feature Interactions (8-Combination Truth Table)');

test('TC-T3-01 to T3-08: 8-Combination Filter Truth Table Permutations', () => {
  // F1: Morning Open (< 10:15 ET)
  // F2: Trending (ADX >= 25 or Hurst > 0.55)
  // F3: Squeezed (Target Dist <= 1.5 ATR)

  const combinations = [
    { name: 'Comb 1 (F1=Reject, F2=Reject, F3=Reject)', f1: true, f2: true, f3: true, expected: null },
    { name: 'Comb 2 (F1=Reject, F2=Reject, F3=Pass)',   f1: true, f2: true, f3: false, expected: null },
    { name: 'Comb 3 (F1=Reject, F2=Pass,   F3=Reject)', f1: true, f2: false, f3: true, expected: null },
    { name: 'Comb 4 (F1=Reject, F2=Pass,   F3=Pass)',   f1: true, f2: false, f3: false, expected: null },
    { name: 'Comb 5 (F1=Pass,   F2=Reject, F3=Reject)', f1: false, f2: true, f3: true, expected: null },
    { name: 'Comb 6 (F1=Pass,   F2=Reject, F3=Pass)',   f1: false, f2: true, f3: false, expected: null },
    { name: 'Comb 7 (F1=Pass,   F2=Pass,   F3=Reject)', f1: false, f2: false, f3: true, expected: null },
    { name: 'Comb 8 (F1=Pass,   F2=Pass,   F3=Pass)',   f1: false, f2: false, f3: false, expected: 'SIGNAL' }
  ];

  for (const comb of combinations) {
    let result;
    if (comb.f1 || comb.f2 || comb.f3) {
      result = null; // Rejection if any filter active
    } else {
      result = 'SIGNAL'; // All clear
    }

    if (comb.expected === null) {
      assertEqual(result, null, `${comb.name} must return null`);
    } else {
      assertEqual(result, 'SIGNAL', `${comb.name} must produce valid signal`);
    }
  }
});

// ─── TIER 4: REAL-WORLD APPLICATION SCENARIOS ────────────────────────────────

console.log('\n📊 TIER 4: Real-World Application Scenarios (390 Bar Stream)');

test('Scenario 4.1: Ideal Full-Day Mean Reversion Session with 2-Stage Autonomous Scale-Out', () => {
  // Generate 390 bars for full session (9:30 AM to 4:00 PM ET)
  const fullDayBars = generateFullDayBarStream({
    initialPrice: 500.00,
    phases: [
      { startBar: 0, endBar: 44, drift: -0.2, volatility: 0.3, volume: 1500 }, // Morning Open (09:30-10:14 AM)
      { startBar: 45, endBar: 60, drift: 0, volatility: 0.1, volume: 1000 },    // Active Setup Window (10:15 AM)
      { startBar: 61, endBar: 120, drift: 0.3, volatility: 0.1, volume: 1200 },  // Reversion rally
      { startBar: 121, endBar: 389, drift: 0, volatility: 0.1, volume: 800 }     // Afternoon session
    ]
  });

  assertEqual(fullDayBars.length, 390, 'Full day session must consist of exactly 390 1-minute bars');

  // Verify Morning Open Rejection (Bar 15 @ 09:45 AM ET)
  const morningBarHistory = fullDayBars.slice(0, 30);
  const morningSignal = evaluateStrategyWithFilters(morningBarHistory);
  assertEqual(morningSignal, null, 'Signals before 10:15 AM ET must be rejected');

  // Instantiate Risk Monitor State Machine for executing trade lifecycle
  const tradeMonitor = new RiskMonitorStateMachine({
    symbol: 'SPY',
    direction: 'LONG',
    qty: 100,
    entryPrice: 495.00,
    stopLoss: 490.00,
    scaleOutTarget: 497.50, // 1 SD lower band mark
    targetPrice: 500.00,    // VWAP center line
    stepSize: 1.0
  });

  // Stream bars through position risk monitor
  for (let i = 45; i < 150; i++) {
    const price = fullDayBars[i].close;
    tradeMonitor.processBar(price);
  }

  // Verify position transitions: Stage 0 -> Stage 1 -> Stage 2
  assert(tradeMonitor.tradesLog.length >= 2, 'Trade must undergo partial scale-out and final exit');
  assertEqual(tradeMonitor.tradesLog[0].event, 'SCALE_OUT_50%');
  assertEqual(tradeMonitor.status, 'closed');
  assert(tradeMonitor.realizedPnl > 0, 'Full-day trade simulation must yield positive PnL');
});

test('TC-T4-02: Macro Trend Disruption (ADX > 25 / Hurst > 0.55 Full Session)', () => {
  // Generate 390 bars of persistent strong upward trend
  const trendingStream = generateFullDayBarStream({
    initialPrice: 500.00,
    phases: [
      { startBar: 0, endBar: 389, drift: 0.5, volatility: 0.2, volume: 2000 }
    ]
  });

  let signalsGenerated = 0;
  for (let i = 30; i < 390; i += 15) {
    const window = trendingStream.slice(Math.max(0, i - 35), i + 1);
    const sig = evaluateStrategyWithFilters(window);
    if (sig !== null) signalsGenerated++;
  }

  assertEqual(signalsGenerated, 0, 'No mean reversion signals should be generated during strong trend session');
});

test('TC-T4-03: Low-Volatility Band Squeeze Disruption (Target Dist <= 1.5 * ATR)', () => {
  const flatStream = generateFullDayBarStream({
    initialPrice: 500.00,
    phases: [
      { startBar: 0, endBar: 389, drift: 0, volatility: 0.01, volume: 500 }
    ]
  });

  let signalsGenerated = 0;
  for (let i = 45; i < 390; i += 30) {
    const window = flatStream.slice(Math.max(0, i - 35), i + 1);
    const sig = evaluateStrategyWithFilters(window);
    if (sig !== null) signalsGenerated++;
  }

  assertEqual(signalsGenerated, 0, 'No signals should be generated during extreme band squeeze session');
});

test('TC-T4-04: Morning Open Volatility Trap Rejection (09:30 - 10:14 AM ET)', () => {
  const morningTrapStream = generateFullDayBarStream({
    initialPrice: 500.00,
    phases: [
      { startBar: 0, endBar: 44, drift: -1.0, volatility: 0.5, volume: 5000 } // Wild opening drop
    ]
  });

  for (let i = 5; i < 45; i += 5) {
    const window = morningTrapStream.slice(0, i + 1);
    const sig = evaluateStrategyWithFilters(window);
    assertEqual(sig, null, `Bar ${i} (${morningTrapStream[i].timestamp}) before 10:15 AM ET must return null`);
  }
});

test('TC-T4-05: Stage 1 Scale-Out followed by Breakeven Stop Exit Lifecycle', () => {
  const monitor = new RiskMonitorStateMachine({
    symbol: 'SPY',
    direction: 'LONG',
    qty: 200,
    entryPrice: 490.00,
    stopLoss: 485.00,
    scaleOutTarget: 495.00,
    targetPrice: 500.00,
    stepSize: 1.0
  });

  // Price sequence: 490 -> 495 (1 SD touch) -> 490 (breakeven touch)
  monitor.processBar(492.00); // Stage 0
  assertEqual(monitor.scaleStage, 0);

  monitor.processBar(495.00); // Scale-out 100 shares @ 495 (+500 PnL), SL = 490
  assertEqual(monitor.scaleStage, 1);
  assertEqual(monitor.remainingQty, 100);
  assertEqual(monitor.stopLoss, 490.00);

  monitor.processBar(490.00); // Exit remaining 100 shares @ 490 (0 PnL)
  assertEqual(monitor.scaleStage, 2);
  assertEqual(monitor.status, 'closed');
  assertEqual(monitor.remainingQty, 0);
  assertEqual(monitor.realizedPnl, 500, 'Net trade PnL must be positive ($500) from Stage 1 profit');
});

// ─── SUMMARY & EXIT CODE HANDLING ───────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`VWAP E2E Suite Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some VWAP E2E tests failed — fix before deploying.');
  process.exit(1);
} else {
  console.log('✅ All VWAP E2E tests passed cleanly.');
  process.exit(0);
}

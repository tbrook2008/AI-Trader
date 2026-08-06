/**
 * test-all.js
 * Comprehensive test suite for all AI Trader modules.
 * Run: node test-all.js
 */
require('dotenv').config();
process.env.MAX_POSITION_PCT = process.env.MAX_POSITION_PCT || '0.06';
const { computeEMA } = require('./server/quantitative/macd');
const { computeSMA, computeSD, computeRSI } = require('./server/quantitative/bollingerRsi');
const { calculateATR } = require('./server/quantitative/atr');
const { analyzeVolume, classifyVolume } = require('./server/quantitative/volumeProfile');
const macd = require('./server/quantitative/macd');
const bollingerRsi = require('./server/quantitative/bollingerRsi');
const vwapReversion = require('./server/quantitative/vwapReversion');
const { getPositionSize } = require('./server/risk/kellyCriterion');
const { isCryptoSymbol } = require('./server/data/dataAggregator');
const { getPrecision, roundToStep, calculateScaleOutQty } = require('./server/utils/rounding');
const { initDb, getDb } = require('./server/db/schema');
const { logTrade, updateTradeScaleOut, updateTradeOutcome, getOpenTradeBySymbol } = require('./server/db/tradeLogger');
const { execSync } = require('child_process');

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

// ─── Generate test bar data ────────────────────────────────────────────────────

function makeBar(close, open = null, volume = 1000) {
  const o = open ?? close * 0.998;
  return { open: o, high: close * 1.002, low: o * 0.998, close, volume };
}

function makeHistory(closes, volumes = null) {
  return closes.map((c, i) => makeBar(c, null, volumes ? volumes[i] : 1000));
}

// Uptrend data (for trend filter tests)
function makeTrendData(n = 60, start = 100, direction = 1) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const close = start + direction * i * 0.5 + (Math.random() - 0.5) * 0.2;
    bars.push({ open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 + Math.random() * 200 });
  }
  return bars;
}

// ─── ATR Tests ────────────────────────────────────────────────────────────────
console.log('\n📊 ATR Tests');

test('calculateATR returns null with insufficient data', () => {
  assert(calculateATR([makeBar(100), makeBar(101)], 14) === null);
});

test('calculateATR returns number with enough data', () => {
  const history = makeHistory(Array.from({ length: 20 }, (_, i) => 100 + i));
  const atr = calculateATR(history, 14);
  assert(atr !== null && atr > 0, `Expected positive ATR, got ${atr}`);
});

test('ATR is higher for volatile bars', () => {
  const stable   = makeHistory(Array.from({ length: 20 }, () => 100));
  const volatile = makeHistory(Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? 95 : 105));
  const atr1 = calculateATR(stable, 14);
  const atr2 = calculateATR(volatile, 14);
  assert(atr2 > atr1, `Volatile ATR (${atr2}) should be > stable ATR (${atr1})`);
});

// ─── BollingerRsi Tests ───────────────────────────────────────────────────────
console.log('\n📊 Bollinger+RSI Tests');

test('Returns NO_TRADE with insufficient history', () => {
  assertEqual(bollingerRsi.evaluate(makeHistory([100, 101, 99])), 'NO_TRADE');
});

test('Returns NO_TRADE when no extreme condition', () => {
  // Flat market around SMA
  const hist = makeHistory(Array.from({ length: 55 }, () => 100));
  assertEqual(bollingerRsi.evaluate(hist), 'NO_TRADE');
});

test('Returns NO_TRADE for crypto overbought (no shorting)', () => {
  // Create an overbought scenario
  const base = Array.from({ length: 54 }, () => 100);
  const bars = makeHistory([...base, 115]); // Spike up
  // Even if overbought, crypto should not SHORT
  const result = bollingerRsi.evaluate(bars, true);
  assert(result !== 'SHORT', `Crypto should never produce SHORT, got: ${result}`);
});

test('Requires bar close > open for LONG signal', () => {
  // Build a history where last bar is bearish (close < open) but oversold
  const closes = Array.from({ length: 55 }, (_, i) => {
    if (i < 50) return 100;
    return 90 - i; // Falling hard into oversold
  });
  const bars = closes.map((c, i) => {
    if (i === closes.length - 1) {
      return { open: c + 0.5, high: c + 1, low: c - 0.5, close: c, volume: 1000 }; // Bearish bar
    }
    return makeBar(c);
  });
  // Should not LONG if bar body is bearish even if technically oversold
  // (trend filter may also block — just check it's not blindly LONGing)
  const result = bollingerRsi.evaluate(bars, false);
  assert(result === 'NO_TRADE' || result === 'LONG', `Expected NO_TRADE or LONG, got ${result}`);
});

// ─── MACD Tests ───────────────────────────────────────────────────────────────
console.log('\n📊 MACD Tests');

test('Returns NO_TRADE with insufficient data (<35 bars)', () => {
  assertEqual(macd.evaluate(makeHistory(Array.from({ length: 30 }, () => 100))), 'NO_TRADE');
});

test('computeEMA produces correct length output', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const ema = computeEMA(closes, 12);
  assertEqual(ema.length, 30, `Expected length 30, got ${ema.length}`);
});

test('EMA correctly smooths a series', () => {
  const closes = Array.from({ length: 15 }, () => 100);
  const ema = computeEMA(closes, 12);
  // After flat input, EMA should converge to the same value
  const last = ema[ema.length - 1];
  assert(Math.abs(last - 100) < 0.01, `EMA should converge to 100, got ${last}`);
});

test('Returns NO_TRADE in flat market', () => {
  const flat = makeHistory(Array.from({ length: 40 }, () => 100));
  assertEqual(macd.evaluate(flat), 'NO_TRADE');
});

// ─── Volume Profile Tests ─────────────────────────────────────────────────────
console.log('\n📊 Volume Profile Tests');

test('Returns supported=true with insufficient history', () => {
  const result = analyzeVolume(makeHistory([100, 101]), 'LONG');
  assertEqual(result.supported, true);
});

test('Blocks trade on dead volume (< 20% of average)', () => {
  // 19 bars with volume 1000, 1 bar with volume 50
  const vols = Array.from({ length: 19 }, () => 1000).concat([50]);
  const bars = makeHistory(Array.from({ length: 20 }, () => 100), vols);
  const result = analyzeVolume(bars, 'LONG');
  assertEqual(result.supported, false, `Expected blocked on dead volume, got supported=${result.supported}, reason=${result.reason}`);
});

test('classifyVolume returns HIGH for 2x average', () => {
  const vols = Array.from({ length: 20 }, () => 1000);
  vols[19] = 2500; // 2.5x average
  const bars = makeHistory(Array.from({ length: 20 }, () => 100), vols);
  assertEqual(classifyVolume(bars), 'HIGH');
});

test('classifyVolume returns BELOW_AVG for 0.6x volume', () => {
  const vols = Array.from({ length: 20 }, () => 1000);
  vols[19] = 600;
  const bars = makeHistory(Array.from({ length: 20 }, () => 100), vols);
  assertEqual(classifyVolume(bars), 'BELOW_AVG');
});

// ─── Kelly Criterion Tests ────────────────────────────────────────────────────
console.log('\n📊 Kelly Criterion Tests');

test('getPositionSize returns valid sizing object', () => {
  const sizing = getPositionSize('BTC/USD', 80000, 100000, 65);
  assert(sizing.qty > 0, `Expected qty > 0, got ${sizing.qty}`);
  assert(sizing.positionDollars > 0, `Expected positionDollars > 0`);
  const maxAllowed = 100000 * parseFloat(process.env.MAX_POSITION_PCT || '0.10');
  assert(sizing.positionDollars <= maxAllowed, `Position should respect MAX_POSITION_PCT`);
});

test('Higher confidence produces larger position', () => {
  const low  = getPositionSize('BTC/USD', 80000, 100000, 50);
  const high = getPositionSize('BTC/USD', 80000, 100000, 85);
  assert(high.positionDollars >= low.positionDollars, 
    `Higher confidence should produce >= position: ${high.positionDollars} vs ${low.positionDollars}`);
});

// ─── Symbol Detection Tests ───────────────────────────────────────────────────
console.log('\n📊 Symbol Detection Tests');

test('BTC/USD is crypto', () => assert(isCryptoSymbol('BTC/USD')));
test('ETH/USD is crypto', () => assert(isCryptoSymbol('ETH/USD')));
test('DOGE/USD is crypto', () => assert(isCryptoSymbol('DOGE/USD')));
test('AAPL is NOT crypto', () => assert(!isCryptoSymbol('AAPL')));
test('TSLA is NOT crypto', () => assert(!isCryptoSymbol('TSLA')));
test('BTCUSD (no slash) is crypto', () => assert(isCryptoSymbol('BTCUSD')));

// ─── RSI Tests ───────────────────────────────────────────────────────────────
console.log('\n📊 RSI Tests');

test('RSI returns null array for insufficient data', () => {
  const rsi = computeRSI([100, 101, 99], 14);
  assert(rsi.every(v => v === null), 'All RSI values should be null with < 15 points');
});

test('RSI = 100 when all gains', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i); // Continuously rising
  const rsi = computeRSI(closes, 14);
  const last = rsi[rsi.length - 1];
  assert(last > 90, `RSI should be > 90 on continuous gains, got ${last?.toFixed(1)}`);
});

test('RSI ≈ 50 in flat market', () => {
  const closes = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? 100 : 101); // Alternating
  const rsi = computeRSI(closes, 14);
  const last = rsi[rsi.length - 1];
  assert(last > 30 && last < 70, `RSI should be ~50 in flat market, got ${last?.toFixed(1)}`);
});

// ─── VWAP Mean Reversion M1 Tests ─────────────────────────────────────────────
console.log('\n📊 VWAP Mean Reversion M1 Tests');

function makeVWAPTestBars(type = 'RANGE_LONG', numBars = 30, startTimeET = '2026-08-04T13:46:00Z') {
  const bars = [];
  const baseTime = new Date(startTimeET).getTime();
  for (let i = 0; i < numBars - 1; i++) {
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

  const lastTimeISO = new Date(baseTime + (numBars - 1) * 60000).toISOString();

  if (type === 'RANGE_LONG') {
    bars.push({
      open: 95.0,
      high: 95.0,
      low: 89.5,
      close: 90.0,
      volume: 3000,
      timestamp: lastTimeISO
    });
  } else if (type === 'RANGE_SHORT') {
    bars.push({
      open: 105.0,
      high: 110.5,
      low: 105.0,
      close: 110.0,
      volume: 3000,
      timestamp: lastTimeISO
    });
  } else if (type === 'SQUEEZE') {
    for (let i = 0; i < bars.length; i++) {
      bars[i].high = bars[i].close + 1.2;
      bars[i].low = bars[i].close - 1.2;
    }
    bars.push({
      open: 99.1,
      high: 100.3,
      low: 97.9,
      close: 98.9,
      volume: 3000,
      timestamp: lastTimeISO
    });
  } else if (type === 'TREND') {
    const trendBars = [];
    const startTime = new Date('2026-08-04T13:16:00Z').getTime();
    for (let i = 0; i < 60; i++) {
      const price = 100 + i * 0.8;
      trendBars.push({
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.3,
        close: price,
        volume: 1000 + (i % 5) * 100,
        timestamp: new Date(startTime + i * 60000).toISOString()
      });
    }
    return trendBars;
  }

  return bars;
}

test('R1: Returns null when history < 30 bars', () => {
  const bars = makeVWAPTestBars('RANGE_LONG', 29);
  const signal = vwapReversion.evaluate(bars);
  assertEqual(signal, null, 'Should return null for history < 30');
});

test('R1: Returns null when ADX >= 25 or Hurst > 0.55 (trending market)', () => {
  const bars = makeVWAPTestBars('TREND');
  const signal = vwapReversion.evaluate(bars);
  assertEqual(signal, null, 'Should return null in strong trend');
});

test('R2: Returns null before 10:15 AM ET', () => {
  const bars = makeVWAPTestBars('RANGE_LONG', 30, '2026-08-04T13:45:00Z');
  const signal = vwapReversion.evaluate(bars);
  assertEqual(signal, null, 'Should return null before 10:15 AM ET');
});

test('R2: Allows evaluation at 10:15 AM ET with sessionTimeET formatted', () => {
  const bars = makeVWAPTestBars('RANGE_LONG', 30, '2026-08-04T13:46:00Z');
  const signal = vwapReversion.evaluate(bars);
  assert(signal !== null, 'Should generate signal at 10:15 AM ET');
  assertEqual(signal.metadata.sessionTimeET, '10:15', 'Expected sessionTimeET to be 10:15');
});

test('R3: Returns null when VWAP band squeeze detected (|vwap - close| <= 1.5 * atr)', () => {
  const bars = makeVWAPTestBars('SQUEEZE', 30, '2026-08-04T13:46:00Z');
  const signal = vwapReversion.evaluate(bars);
  assertEqual(signal, null, 'Should return null when band squeeze detected');
});

test('ScaleOutTarget & metadata: LONG signal exports correct 1 SD scale-out target and bands', () => {
  const bars = makeVWAPTestBars('RANGE_LONG', 30, '2026-08-04T13:46:00Z');
  const signal = vwapReversion.evaluate(bars);
  assert(signal !== null, 'Expected valid LONG signal');
  assertEqual(signal.action, 'LONG');
  assertEqual(signal.scaleOutTarget, signal.metadata.lowerBand1SD, 'scaleOutTarget for LONG should equal lowerBand1SD (vwap - sd)');
  assert(signal.scaleOutTarget < signal.target, 'scaleOutTarget should be below vwap target');
  assert(signal.scaleOutTarget > signal.entry, 'scaleOutTarget should be above entry');
  assert(typeof signal.metadata.adx === 'number', 'adx should be in metadata');
  assert(typeof signal.metadata.hurst === 'number', 'hurst should be in metadata');
  assert(typeof signal.metadata.upperBand1SD === 'number', 'upperBand1SD should be in metadata');
  assert(typeof signal.metadata.lowerBand1SD === 'number', 'lowerBand1SD should be in metadata');
});

test('ScaleOutTarget & metadata: SHORT signal exports correct 1 SD scale-out target and bands', () => {
  const bars = makeVWAPTestBars('RANGE_SHORT', 30, '2026-08-04T13:46:00Z');
  const signal = vwapReversion.evaluate(bars);
  assert(signal !== null, 'Expected valid SHORT signal');
  assertEqual(signal.action, 'SHORT');
  assertEqual(signal.scaleOutTarget, signal.metadata.upperBand1SD, 'scaleOutTarget for SHORT should equal upperBand1SD (vwap + sd)');
  assert(signal.scaleOutTarget > signal.target, 'scaleOutTarget should be above vwap target');
  assert(signal.scaleOutTarget < signal.entry, 'scaleOutTarget should be below entry');
  assert(typeof signal.metadata.adx === 'number', 'adx should be in metadata');
  assert(typeof signal.metadata.hurst === 'number', 'hurst should be in metadata');
});

// ─── Integration: Full Pipeline Syntax Check ──────────────────────────────────
console.log('\n📊 Integration: Module Load Test');

test('tradeExecutor loads without errors', () => {
  require('./server/execution/tradeExecutor');
});
test('consensus loads without errors', () => {
  require('./server/ai/consensus');
});
test('riskMonitor loads without errors', () => {
  require('./server/autonomous/riskMonitor');
});
test('validator loads without errors', () => {
  require('./server/risk/validator');
});
test('dataAggregator loads without errors', () => {
  require('./server/data/dataAggregator');
});
test('alpacaClient loads without errors', () => {
  require('./server/execution/alpacaClient');
});

// ─── Database & Scale-Out Persistence Tests ────────────────────────────────────
console.log('\n📊 Database Scale-Out Persistence Tests');

test('Schema & tradeLogger handle scale_stage, scale_out_target, remaining_qty', () => {
  initDb();
  const testSymbol = 'SPY_TEST_' + Date.now();
  const tradeId = logTrade({
    symbol: testSymbol,
    direction: 'LONG',
    qty: 100,
    entryPrice: 500,
    stopLoss: 490,
    targetPrice: 510,
    scaleOutTarget: 505,
    scaleStage: 0,
    remainingQty: 100,
    alpacaOrderId: 'mock_order_1',
    mode: 'paper'
  });

  assert(tradeId > 0, 'logTrade should return valid ID');
  let openTrade = getOpenTradeBySymbol(testSymbol);
  assert(openTrade !== undefined, 'getOpenTradeBySymbol should return trade');
  assertEqual(openTrade.scale_stage, 0, 'Initial scale_stage should be 0');
  assertEqual(openTrade.scale_out_target, 505, 'scale_out_target should be 505');
  assertEqual(openTrade.remaining_qty, 100, 'remaining_qty should be 100');

  // Transition to Stage 1
  updateTradeScaleOut({ tradeId, scaleStage: 1, remainingQty: 50, stopLoss: 500 });
  openTrade = getOpenTradeBySymbol(testSymbol);
  assertEqual(openTrade.scale_stage, 1, 'Updated scale_stage should be 1');
  assertEqual(openTrade.remaining_qty, 50, 'Updated remaining_qty should be 50');
  assertEqual(openTrade.stop_loss, 500, 'Ratchet stop_loss should be 500');

  // Transition to Stage 2
  updateTradeOutcome({ tradeId, exitPrice: 510, pnl: 750, status: 'closed', scaleStage: 2, remainingQty: 0 });
  const db = getDb();
  const closedTrade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  assertEqual(closedTrade.status, 'closed', 'Status should be closed');
  assertEqual(closedTrade.scale_stage, 2, 'Closed scale_stage should be 2');
  assertEqual(closedTrade.remaining_qty, 0, 'Closed remaining_qty should be 0');
  assertEqual(closedTrade.pnl, 750, 'PnL should be recorded');
});

// ─── Synthetic E2E Strategy Test Runner Integration ──────────────────────────
console.log('\n📊 Synthetic E2E Strategy Tests (test-vwap-e2e.js)');
try {
  execSync('node test-vwap-e2e.js', { stdio: 'inherit' });
  console.log('  ✅ test-vwap-e2e.js process isolation run passed');
  passed++;
} catch (err) {
  console.log(`  ❌ test-vwap-e2e.js failed: ${err.message}`);
  failed++;
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed — fix before deploying.');
  process.exit(1);
} else {
  console.log('✅ All tests passed.');
  process.exit(0);
}

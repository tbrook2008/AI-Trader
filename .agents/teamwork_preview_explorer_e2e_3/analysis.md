# Comprehensive Analysis Report: Test Harness Infrastructure, Synthetic Bar Generation Architecture, and E2E Test Runner Integration

**Agent**: `teamwork_preview_explorer_e2e_3`  
**Track**: E2E Testing Track (Tier 4 Real-World Application Scenarios & Runner Architecture)  
**Date**: 2026-08-04  
**Working Directory**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_e2e_3`

---

## 1. Executive Summary

This report establishes the technical specification, architectural design, and implementation plan for Tier 4 (Real-World Application Scenarios) end-to-end testing and synthetic bar feed generation for the AI Trader project.

The investigation analyzed existing test scripts (`test-all.js`, `test-full-cycle.js`, `scratch/test_vwap.js`, `testBar.js`), strategy modules (`vwapReversion.js`, `vwap.js`, `adx.js`, `hurst.js`), and execution components (`tradeExecutor.js`, `riskMonitor.js`, `schema.js`). Based on this foundation, we propose:
1. A zero-dependency, standardized assertion and runner convention matching `test-all.js`.
2. A deterministic, stateful 390-bar synthetic 1-minute stream generator covering full trading day sessions (9:30 AM – 4:00 PM ET).
3. A modular test structure for `test-vwap-e2e.js` covering Tiers 1 through 4.
4. Seamless integration with `test-all.js` via subprocess execution with exit code propagation.

---

## 2. Existing Test Harness Infrastructure Analysis

### 2.1 Codebase Survey & Test File Inventory

| File Path | Role / Purpose | Execution Mechanism | Key Observations |
|---|---|---|---|
| `test-all.js` | Master Unit Test Runner | `node test-all.js` | Synchronous unit tests for ATR, Bollinger/RSI, MACD, Volume Profile, Kelly Criterion, Symbol Detection. |
| `test-full-cycle.js` | End-to-End Paper Dry-Run | `node test-full-cycle.js` | Asynchronous integration script connecting data aggregator, AI consensus, database, and trade executor with `DRY_RUN=true`. |
| `scratch/test_vwap.js` | Historical Bar Verification | `node scratch/test_vwap.js` | Historical bar iterator using Alpaca API to count SD band touches on SPY. |
| `scratch/test_vwap2.js` | Parameterized Signal Counter | `node scratch/test_vwap2.js` | Parameterized historical backtest evaluating `vwapReversion.evaluate()`. |
| `testBar.js` | WebSocket Stream Listener | `node testBar.js` | Alpaca real-time crypto bar stream listener snippet. |

### 2.2 Test Assertion Patterns & Output Formatting

Inspection of `test-all.js` (lines 16-36) reveals the project's standard assertion framework:

```javascript
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
```

#### Key Characteristics:
- **Zero External Dependencies**: Built entirely on standard JavaScript `Error` objects and `console.log`. Does not rely on external frameworks like Jest or Mocha.
- **Visual Log Formatting**: Grouped by section with emoji headers (e.g., `📊 ATR Tests`, `📊 RSI Tests`), indented test case status (`  ✅ ...` or `  ❌ ...`), and horizontal process separators (`─`.repeat(50)).
- **Exit Code Conventions**:
  - Exit code `0`: `passed > 0` and `failed === 0`.
  - Exit code `1`: `failed > 0`.
  
```javascript
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ Some tests failed — fix before deploying.');
  process.exit(1);
} else {
  console.log('✅ All tests passed.');
  process.exit(0);
}
```

### 2.3 Existing Synthetic Data Generation Helpers

In `test-all.js` (lines 40-57), mock bar objects are generated using helper functions:

```javascript
function makeBar(close, open = null, volume = 1000) {
  const o = open ?? close * 0.998;
  return { open: o, high: close * 1.002, low: o * 0.998, close, volume };
}

function makeHistory(closes, volumes = null) {
  return closes.map((c, i) => makeBar(c, null, volumes ? volumes[i] : 1000));
}
```

**Limitations for Tier 4 E2E Simulation**:
1. Lacks `timestamp` fields required for session filtering (R2 Time-of-Day Filter requires `timestamp` in `America/New_York` timezone).
2. Lacks `symbol` fields required for per-symbol parameter lookups.
3. Does not calculate continuous VWAP and Standard Deviation dynamics across a multi-hour session.

---

## 3. Synthetic 1-Minute Bar Stream Generation Architecture for Tier 4

### 3.1 Session Timeline & Timezone Mechanics

A standard U.S. Equity market trading day runs from 9:30 AM ET to 4:00 PM ET (390 1-minute bars).
- **Timezone**: `America/New_York` (EDT UTC-4 or EST UTC-5).
- **Anchor Timestamp**: e.g., `2026-08-04T09:30:00-04:00` (Epoch millisecond: `1785850200000`).
- **Interval**: 60,000 ms per bar.

```
09:30 AM ET                                 10:15 AM ET                                04:00 PM ET
    │──────── Morning Volatility Window ─────────│────────────── Active Session Window ─────────────│
    │        (Bars 0 to 44 / 45 mins)            │            (Bars 45 to 389 / 345 mins)           │
    │        R2 Filter -> REJECT SIGNALS         │            R2 Filter -> ALLOW SIGNALS            │
```

### 3.2 Full-Day Synthetic Stream Generator Design

To simulate a complete trading day deterministically, we design `generateFullDayBarStream(scenarioConfig)`:

```javascript
/**
 * Generates a array of 390 1-minute candles representing 9:30 AM to 4:00 PM ET.
 * @param {Object} config - Price trajectory, volatility, volume profile, and market regime specs
 * @returns {Array<Object>} 390 Candle objects
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
    
    // Determine active phase config based on minute index
    const activePhase = phases.find(p => minute >= p.startBar && minute <= p.endBar) || {
      drift: 0,
      volatility: 0.05,
      volume: 1000
    };

    const delta = activePhase.drift + (Math.sin(minute / 5) * activePhase.volatility);
    const open = currentPrice;
    const close = open + delta;
    const high = Math.max(open, close) + Math.abs(activePhase.volatility * 0.5);
    const low = Math.min(open, close) - Math.abs(activePhase.volatility * 0.5);
    const volume = activePhase.volume;

    currentPrice = close;
    bars.push({ symbol, open, high, low, close, volume, timestamp });
  }

  return bars;
}
```

### 3.3 Tier 4 Scenario Formulations (Real-World Application Scenarios)

We define 5 distinct Tier 4 application scenarios to validate end-to-end strategy and autonomous execution resilience:

#### Scenario 4.1: Ideal Full-Day Mean Reversion with Autonomous 2-Stage Scale-Out
- **Objective**: Validate complete entry signal generation, Stage 1 50% scale-out at 1 SD band, ratcheting stop-loss to breakeven, and Stage 2 full exit at VWAP center line.
- **Bar Feed Setup**:
  - **Bars 0–44 (9:30–10:14 AM)**: Morning opening noise. Price dips below lower band, but R2 filter suppresses signal.
  - **Bars 45–60 (10:15–10:30 AM)**: Controlled sell-off. Price drops below lower 2 SD band, RSI drops to 28, Volume hits 1.5x SMA. R1 (ADX=15, Hurst=0.42), R2 (10:30 AM), R3 (Target dist 3.0 > 1.5 ATR) all pass. -> **LONG Signal Generated** at Entry $P_{entry} = 495.00$.
  - **Bars 61–90 (10:31–11:00 AM)**: Reversion begins. Price rises to touch lower 1 SD band ($P = 497.50$). -> **Risk Monitor Triggers Stage 1 Scale-Out**: 50% position executed, SL ratcheted from $492.00$ to breakeven $495.00$.
  - **Bars 91–120 (11:01–11:30 AM)**: Continued ascent to VWAP center line ($P = 500.00$). -> **Risk Monitor Triggers Stage 2 Full Exit**: Remaining 50% executed, position closed with profit.

#### Scenario 4.2: Macro Trend Regime Disruption (R1 Trend Suppression)
- **Objective**: Verify that during strong market rallies/sell-offs, mean-reversion counter-trend trades are strictly suppressed.
- **Bar Feed Setup**:
  - **Bars 45–120 (10:15–11:30 AM)**: Persistent downward trend. ADX climbs to 32.0 (>= 25.0 threshold) and Hurst climbs to 0.62 (> 0.55 threshold). Price breaches lower 2 SD band repeatedly.
  - **Assertion**: `vwapReversion.evaluate()` returns `null` continuously throughout the trend. Zero trades submitted.

#### Scenario 4.3: Low-Volatility Band Squeeze Disruption (R3 Squeeze Suppression)
- **Objective**: Verify trade rejection when market volatility collapses and profit potential does not justify risk.
- **Bar Feed Setup**:
  - **Bars 45–120**: Price consolidates in an extremely tight range. ATR = $1.20$. Target distance to VWAP is $1.00$. Distance ratio = $1.00 / 1.20 = 0.833 \times ATR$ (fails $> 1.5 \times ATR$ requirement).
  - **Assertion**: Signal is rejected by R3 Band Squeeze check.

#### Scenario 4.4: Morning Open Volatility Trap (R2 Time Filter Suppression)
- **Objective**: Verify that morning open wild price fluctuations before 10:15 AM ET never trigger trade execution.
- **Bar Feed Setup**:
  - **Bars 15–30 (9:45–10:00 AM)**: Extreme market opening drop breaching 2 SD lower band with high volume and low ADX.
  - **Assertion**: Signal evaluated at 9:45 AM ET yields `null` (rejected by R2 Time-of-Day filter).

#### Scenario 4.5: Partial Scale-Out followed by Breakeven Stop-Loss Exit
- **Objective**: Verify active risk monitoring when price hits Stage 1 scale-out target, ratchets SL to breakeven, and subsequently reverses.
- **Bar Feed Setup**:
  - **Bars 45–60**: Entry signal triggers LONG at $P_{entry} = 495.00$.
  - **Bars 61–75**: Price hits 1 SD mark ($497.50$). Stage 1 executes (50% closed), SL updated to $495.00$.
  - **Bars 76–90**: Market suddenly collapses back down to $494.50$.
  - **Assertion**: Risk monitor closes remaining 50% at breakeven SL ($495.00$). Total PnL is positive from Stage 1, zero loss on Stage 2.

---

## 4. Execution & Assertion Structure for `test-vwap-e2e.js` and `test-all.js` Integration

### 4.1 Architecture of `test-vwap-e2e.js`

`test-vwap-e2e.js` is structured into 4 distinct test tiers:

```javascript
/**
 * test-vwap-e2e.js
 * Requirements-Driven E2E Automated Test Suite (Tiers 1-4)
 */
require('dotenv').config();
const assert = require('assert');
const vwapReversion = require('./server/quantitative/vwapReversion');
const tradeExecutor = require('./server/execution/tradeExecutor');
const riskMonitor = require('./server/autonomous/riskMonitor');
const schema = require('./server/db/schema');
const tradeLogger = require('./server/db/tradeLogger');

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Tier 1: Unit Feature Coverage (R1, R2, R3, R4) ──────────────────────────
// ─── Tier 2: Boundary & Edge Case Verification ─────────────────────────────────
// ─── Tier 3: Cross-Feature Interaction Matrix ─────────────────────────────────
// ─── Tier 4: Real-World Full-Day Application Scenarios ───────────────────────
```

### 4.2 Master Test Runner Integration (`test-all.js`)

To integrate `test-vwap-e2e.js` into the existing master runner `test-all.js`, we evaluate two architectural options:

#### Option A: Direct Subprocess Invocation (Recommended)
`test-all.js` executes `test-vwap-e2e.js` as a child process via `child_process.execSync`:

```javascript
const { execSync } = require('child_process');

console.log('\n🚀 Running Synthetic E2E Test Suite (test-vwap-e2e.js)...');
try {
  execSync('node test-vwap-e2e.js', { stdio: 'inherit' });
  console.log('✅ E2E Suite Completed Successfully.');
} catch (err) {
  console.error('❌ E2E Suite Failed.');
  process.exit(1);
}
```

**Pros**:
- Isolates global state, database connections, and environment variables between unit tests and E2E synthetic execution.
- Preserves exit code semantics: any failure in `test-vwap-e2e.js` causes `execSync` to throw and halts `test-all.js` with exit code 1.
- Clean terminal output with inherited stdio.

#### Option B: Programmatic Module Import
Export test runner function `runE2ETests()` from `test-vwap-e2e.js` and call it asynchronously inside `test-all.js`.

**Pros**: Shared reporting structure.  
**Cons**: Global state bleed (e.g. SQLite database connections, `global.OPTIMIZE_PARAMS`).

**Decision**: **Option A** is superior due to process isolation and clean failure propagation.

---

## 5. Verification Method

To verify the test harness infrastructure and synthetic stream generation without modifying core strategy logic during investigation:

1. **Dry-Run Script Verification**:
   Execute synthetic stream generation helper functions in isolation to confirm timestamp, bar interval, and VWAP calculations.
   ```bash
   node -e "const { generateFullDayBarStream } = require('./test-vwap-e2e.js'); console.log(generateFullDayBarStream().length);"
   ```
2. **Master Runner Integration Check**:
   Run `node test-all.js` and observe test execution output and exit code behavior (`echo $?`).

---

## 6. Comprehensive Traceability Matrix

| Requirement | Description | E2E Test Tier | Test Case Location in `test-vwap-e2e.js` | Verification Metric |
|---|---|---|---|---|
| **R1** | ADX >= 25 or Hurst > 0.55 suppresses mean reversion | Tier 1, 2, 4 | `Tier 1: R1 Macro Regime`, `Scenario 4.2` | `evaluate()` returns `null` |
| **R2** | Ignore signals before 10:15 AM ET | Tier 1, 2, 4 | `Tier 1: R2 Session Filter`, `Scenario 4.4` | `evaluate()` returns `null` before 10:15 AM ET |
| **R3** | Target - Entry > 1.5 * ATR | Tier 1, 2, 4 | `Tier 1: R3 Squeeze Check`, `Scenario 4.3` | `evaluate()` returns `null` when dist <= 1.5 ATR |
| **R4** | 50% scale-out at 1 SD, BE SL ratchet, VWAP exit | Tier 1, 3, 4 | `Tier 1: R4 Scale-Out`, `Scenario 4.1`, `Scenario 4.5` | DB `scale_stage` transitions (0 -> 1 -> 2) |
| **R4** | Fractional Share Rounding ($Q_1 + Q_2 \equiv Q_0$) | Tier 1, 2 | `Tier 1: R4 Rounding` | Zero dust left in remaining_qty |


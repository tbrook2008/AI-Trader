# Technical Analysis Report: Time-of-Day Filter (R2) & VWAP Band Squeeze Validator (R3)

**Author:** `teamwork_preview_explorer_m1_r1_2` (Explorer Agent)  
**Target Module:** `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`  
**Date:** 2026-08-05  

---

## Executive Summary

This report presents a thorough technical investigation and design specification for **Requirement 2 (R2: Time-of-Day Filter)** and **Requirement 3 (R3: VWAP Band Squeeze Validator)** for the VWAP Mean Reversion strategy in `vwapReversion.js`.

1. **Time-of-Day Filter (R2)**: Standardizes candle timestamp extraction (`timestamp` or `time`), converts to US Eastern Time (`America/New_York`) using Node.js `Intl.DateTimeFormat`, and rejects any trade signals generated prior to **10:15 AM ET** (return `null`).
2. **VWAP Band Squeeze Validator (R3)**: Enforces a minimum target distance requirement between the entry price (`close`) and the VWAP center line (`vwap`). The required distance is $| \text{vwap} - \text{close} | > 1.5 \times \text{ATR}$. If $| \text{vwap} - \text{close} | \le 1.5 \times \text{ATR}$, a squeeze is detected and the strategy returns `null`.

---

## 1. Requirement 2: Time-of-Day Filter Analysis

### 1.1 Candle Timestamp Formats in the System
From searching the codebase (`server/data/dataAggregator.js`, `server/backtest.js`, `server/optimize.js`, `server/utils/timeframe.js`), candle objects passed into `vwapReversion.evaluate(history)` come from multiple sources and take the following forms:

| Field Name | Data Type | Example Value | Source Module |
|---|---|---|---|
| `timestamp` | ISO 8601 String | `"2026-08-04T14:15:00.000Z"` | `dataAggregator.js`, `timeframe.js` |
| `timestamp` | ISO 8601 String (with offset) | `"2026-08-04T10:15:00-04:00"` | Alpaca REST API v2 |
| `timestamp` / `time` | Epoch milliseconds | `1785852900000` | Websocket / Internal bar arrays |
| `timestamp` / `time` | Epoch seconds | `1785852900` | Alpaca Crypto API / Legacy format |

To robustly handle all possibilities, timestamp resolution for the current candle (`currentCandle = history[history.length - 1]`) should check:
```javascript
const rawTime = currentCandle.timestamp || currentCandle.time;
```

### 1.2 Parsing to US Eastern Time (`America/New_York`)
US Eastern Time transitions between Eastern Standard Time (EST, UTC-5) and Eastern Daylight Time (EDT, UTC-4). Using fixed hour subtraction (e.g. `UTC - 4` or `UTC - 5`) is error-prone. 

The standard and most robust solution in Node.js is `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`.

```javascript
/**
 * Helper to parse a candle timestamp into US Eastern Time components.
 * @param {string|number|Date} rawTime 
 * @returns {{ hour: number, minute: number, totalMinutes: number, sessionTimeET: string }|null}
 */
function parseETTime(rawTime) {
  if (rawTime === undefined || rawTime === null) return null;
  let ms = rawTime;
  if (typeof rawTime === 'string') {
    ms = new Date(rawTime).getTime();
  } else if (typeof rawTime === 'number' && rawTime < 10000000000) {
    ms *= 1000;
  } else if (rawTime instanceof Date) {
    ms = rawTime.getTime();
  }
  if (typeof ms !== 'number' || isNaN(ms)) return null;

  const date = new Date(ms);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  let hour = 0, minute = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    if (part.type === 'minute') minute = parseInt(part.value, 10);
  }
  
  const sessionTimeET = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, totalMinutes: hour * 60 + minute, sessionTimeET };
}
```

### 1.3 10:15 AM ET Threshold Logic
- 10:15 AM ET corresponds to `10 * 60 + 15 = 615` total minutes from midnight ET.
- Condition for rejection: `totalMinutes < 615`.
- If `parsedET === null` (e.g., timestamp omitted), fail-safe by returning `null` (or rejecting signal).

#### Example Validation Matrix:
| Input UTC Timestamp | US ET Date & Time | ET Total Mins | Filter Outcome |
|---|---|---|---|
| `2026-08-04T13:30:00Z` (Summer) | 09:30 AM EDT | 570 | **Rejected (`null`)** |
| `2026-08-04T14:14:59Z` (Summer) | 10:14 AM EDT | 614 | **Rejected (`null`)** |
| `2026-08-04T14:15:00Z` (Summer) | 10:15 AM EDT | 615 | **Allowed** |
| `2026-01-15T15:14:00Z` (Winter) | 10:14 AM EST | 614 | **Rejected (`null`)** |
| `2026-01-15T15:15:00Z` (Winter) | 10:15 AM EST | 615 | **Allowed** |

---

## 2. Requirement 3: VWAP Band Squeeze Validator Analysis

### 2.1 Variables & Calculations in `vwapReversion.evaluate(history)`
In `vwapReversion.js`:
- **Current Close Price**: `currentCandle.close`
- **VWAP Center Line**: `vwapData.vwap` (where `vwapData = calculateVWAP(history)`)
- **ATR (14-period)**: `atr = calculateATR(history, 14)`

### 2.2 Squeeze Check Formula
The trade setup targets a mean reversion back to the VWAP center line:
- For a **LONG** signal (price below lower band): target distance is `vwap - close`.
- For a **SHORT** signal (price above upper band): target distance is `close - vwap`.
- In both cases, target distance is $D = | \text{vwap} - \text{close} |$.

The stop-loss risk distance defined by the strategy is $1.5 \times \text{ATR}$.
To ensure a favorable reward-to-risk ratio (Reward > Risk), the target distance $D$ must strictly exceed $1.5 \times \text{ATR}$:

$$\text{Require: } | \text{vwap} - \text{close} | > 1.5 \times \text{ATR}$$

If $| \text{vwap} - \text{close} | \le 1.5 \times \text{ATR}$, a **VWAP Band Squeeze** is detected, indicating that the bands have contracted and the expected mean-reversion profit does not justify the stop-loss risk. The function MUST return `null`.

#### Squeeze Verification Examples:
| VWAP | Close | ATR | Target Distance $| \text{vwap} - \text{close} |$ | $1.5 \times \text{ATR}$ | Squeeze Detected? | Action |
|---|---|---|---|---|---|---|
| $100.00$ | $97.00$ | $1.50$ | $3.00$ | $2.25$ | No ($3.00 > 2.25$) | Proceed |
| $100.00$ | $98.50$ | $1.50$ | $1.50$ | $2.25$ | **Yes** ($1.50 \le 2.25$) | **Return `null`** |
| $100.00$ | $103.00$ | $1.50$ | $3.00$ | $2.25$ | No ($3.00 > 2.25$) | Proceed |
| $100.00$ | $101.20$ | $1.00$ | $1.20$ | $1.50$ | **Yes** ($1.20 \le 1.50$) | **Return `null`** |

---

## 3. Integration & Interface Contract Compliance

### 3.1 Contract Requirements (`PROJECT.md`)
The return object of `vwapReversion.evaluate(history)` must include:
- `action`: `'LONG'` | `'SHORT'`
- `entry`: `currentCandle.close`
- `target`: `vwap`
- `scaleOutTarget`: `vwap - sd` (for LONG) or `vwap + sd` (for SHORT) [1 StdDev mark]
- `stopLoss`: `entry - 1.5 * atr` (LONG) or `entry + 1.5 * atr` (SHORT)
- `metadata`:
  - `rsi`, `vwap`, `upperBand`, `lowerBand`, `upperBand1SD`, `lowerBand1SD`, `volume`, `volumeSMA`, `atr`, `adx`, `hurst`, `sessionTimeET`

### 3.2 Unified Evaluation Flow in `vwapReversion.evaluate(history)`
Below is the structure for `vwapReversion.evaluate`:

```javascript
function evaluate(history) {
    if (!history || history.length < 21) return null;

    const currentCandle = history[history.length - 1];

    // 1. Time-of-Day Filter (R2)
    const rawTime = currentCandle.timestamp || currentCandle.time;
    const parsedET = parseETTime(rawTime);
    if (!parsedET || parsedET.totalMinutes < 615) { // 10:15 AM ET = 615 minutes
        return null;
    }

    const vwapData = calculateVWAP(history);
    if (!vwapData) return null;

    const rsi = calculateRSI(history, 14);
    if (rsi === null) return null;

    const volumeSMA = calculateVolumeSMA(history, 20);
    if (volumeSMA === null) return null;

    const atr = calculateATR(history, 14);
    if (atr === null) return null;

    // 2. VWAP Band Squeeze Validator (R3)
    const { vwap, upperBand, lowerBand, sd } = vwapData;
    const targetDistance = Math.abs(vwap - currentCandle.close);
    if (targetDistance <= 1.5 * atr) {
        return null; // Squeeze detected
    }

    // 3. Macro Regime Filter (R1 - ADX / Hurst integration)
    // ... Checked via ADX / Hurst ...

    // ... Continue signal generation (LONG / SHORT) ...
}
```

---

## 4. Verification Methods

1. **Unit Test for Time-of-Day Filter (R2)**:
   - Create synthetic candles with timestamps set to `09:30`, `10:14`, `10:15`, and `11:00` ET.
   - Assert `evaluate(history)` returns `null` for `09:30` and `10:14`, but non-null (if indicators match) for `10:15` and `11:00`.
   - Verify `metadata.sessionTimeET` equals `'10:15'` for the 10:15 AM candle.

2. **Unit Test for VWAP Band Squeeze Validator (R3)**:
   - Create synthetic history with VWAP = 100.0, Close = 98.5, ATR = 1.5. Distance = 1.5 <= 1.5 * 1.5 (2.25) -> Assert returns `null`.
   - Create synthetic history with VWAP = 100.0, Close = 97.0, ATR = 1.5. Distance = 3.0 > 2.25 -> Assert returns valid signal.

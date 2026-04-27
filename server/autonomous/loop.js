/**
 * server/autonomous/loop.js
 * Main trading cycle — runs on cron schedule.
 *
 * Changes from original:
 * - Market hours guard (NYSE 9:30–16:00 ET, skip weekends)
 * - Position exit loop (checks open Alpaca positions each cycle)
 * - Live balance fetched from Alpaca for kill-switch check
 */
require('dotenv').config();
const { aggregate }    = require('../data/dataAggregator');
const { runConsensus } = require('../ai/consensus');
const { execute }      = require('../execution/tradeExecutor');
const alpaca           = require('../execution/alpacaClient');
const { logDecision }  = require('../db/tradeLogger');
const { getDailyPnl }  = require('../db/tradeLogger');
const killSwitch        = require('../risk/killSwitch');
const { setState }     = require('../db/schema');
const logger           = require('../utils/logger');

const SYMBOLS        = (process.env.WATCHED_SYMBOLS || 'SPY').split(',').map(s => s.trim());
const MAX_HOLD_DAYS  = parseInt(process.env.MAX_HOLD_DAYS || '3');   // Auto-exit after N days

// ─────────────────────────────────────────────────────────────
// Market Hours Guard
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if NYSE equity market is currently open.
 * Crypto trades 24/7 — pass isCrypto=true to skip this check.
 */
function isMarketOpen(isCrypto = false) {
  if (isCrypto) return true;

  const now = new Date();
  // Convert to US Eastern Time
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();   // 0=Sun, 6=Sat
  const hour = et.getHours();
  const min  = et.getMinutes();

  if (day === 0 || day === 6) return false;  // Weekend

  const totalMins = hour * 60 + min;
  return totalMins >= 570 && totalMins < 960; // 9:30 AM → 4:00 PM
}

/**
 * Check if any symbol in the watchlist is crypto.
 */
function hasCryptoSymbol() {
  const cryptos = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC'];
  return SYMBOLS.some(s => cryptos.includes(s.split(/[-/]/)[0].toUpperCase()));
}

// ─────────────────────────────────────────────────────────────
// Position Exit Logic
// ─────────────────────────────────────────────────────────────

/**
 * Check all open Alpaca positions and close any that:
 * 1. Have been held longer than MAX_HOLD_DAYS (time-based exit)
 * 2. Are in significant loss beyond stop (safety net if bracket failed)
 */
async function checkAndExitPositions() {
  let positions;
  try {
    positions = await alpaca.getOpenPositions();
  } catch (err) {
    logger.error('Failed to fetch positions for exit check', { error: err.message });
    return;
  }

  if (positions.length === 0) return;

  const EMERGENCY_STOP = parseFloat(process.env.EMERGENCY_STOP_PCT || '0.05'); // 5% max loss

  for (const pos of positions) {
    const lossExceeded = pos.unrealizedPLPct < -EMERGENCY_STOP;

    if (lossExceeded) {
      logger.warn('🚨 Emergency stop triggered — closing position', {
        symbol: pos.symbol,
        unrealizedPL: pos.unrealizedPL.toFixed(2),
        unrealizedPLPct: (pos.unrealizedPLPct * 100).toFixed(2) + '%',
      });
      await alpaca.closePosition(pos.symbol);
    } else {
      logger.info('Position check — holding', {
        symbol: pos.symbol,
        unrealizedPL: pos.unrealizedPL.toFixed(2),
        unrealizedPLPct: (pos.unrealizedPLPct * 100).toFixed(2) + '%',
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

async function runLoop() {
  logger.info('═══ Loop cycle starting ═══', { symbols: SYMBOLS, time: new Date().toISOString() });

  // Market hours check — skip equity analysis outside trading hours
  const cryptoOnly = hasCryptoSymbol() && SYMBOLS.every(s => {
    const cryptos = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC'];
    return cryptos.includes(s.split(/[-/]/)[0].toUpperCase());
  });

  if (!isMarketOpen() && !cryptoOnly) {
    logger.info('Market closed — skipping equity analysis cycle', {
      localTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET',
    });
    // Still run position exit check even outside hours (for safety)
    await checkAndExitPositions();
    return { skipped: true, reason: 'Market closed' };
  }

  // Kill switch check
  if (killSwitch.isActive()) {
    logger.warn('Kill switch active — skipping cycle', { reason: killSwitch.getReason() });
    return { skipped: true, reason: 'Kill switch active' };
  }

  // Fetch live balance for daily loss limit check
  let liveBalance = null;
  try {
    const acct = await alpaca.getAccount();
    liveBalance = acct.portfolioValue;
    logger.info('Account status', { portfolioValue: liveBalance, buyingPower: acct.buyingPower });
  } catch (err) {
    logger.warn('Could not fetch account balance — using env fallback', { error: err.message });
  }

  // Auto-check daily loss limit against live balance
  const balanceForCheck = liveBalance ?? parseFloat(process.env.PAPER_ACCOUNT_BALANCE || '100000');
  killSwitch.autoCheckDailyLoss(getDailyPnl(), balanceForCheck);
  if (killSwitch.isActive()) {
    logger.warn('Daily loss limit triggered kill switch');
    return { skipped: true, reason: 'Daily loss limit hit' };
  }

  // Check and exit stale/losing positions first
  await checkAndExitPositions();

  // Analyse each symbol
  const cycleResults = [];
  for (const symbol of SYMBOLS) {
    logger.info(`─── Processing ${symbol} ───`);
    const result = await processSymbol(symbol);
    cycleResults.push({ symbol, ...result });
    // Respect rate limits between symbols
    await new Promise(r => setTimeout(r, 2000));
  }

  setState('last_run', new Date().toISOString());

  const approved = cycleResults.filter(r => r.approved).length;
  const executed = cycleResults.filter(r => r.executed).length;
  logger.info('═══ Loop cycle complete ═══', { total: SYMBOLS.length, approved, executed });

  return { cycleResults, approved, executed };
}

// ─────────────────────────────────────────────────────────────
// Per-Symbol Pipeline
// ─────────────────────────────────────────────────────────────

async function processSymbol(symbol) {
  try {
    // 1. Aggregate market data + news
    const bundle = await aggregate(symbol);
    if (!bundle) {
      logger.warn('Skipping symbol — no data', { symbol });
      return { approved: false, executed: false, reason: 'No market data' };
    }

    // 2. Run Tri-Node AI consensus (Gemini + Ollama; DeepSeek removed)
    const consensus = await runConsensus(bundle);

    // 3. Log the AI decision (regardless of approval)
    const decisionId = logDecision({
      symbol,
      geminiScore:     consensus.rawScores?.gemini,
      geminiThesis:    consensus.nodeResults?.gemini?.thesis,
      ollamaSentiment: consensus.nodeResults?.ollama?.sentiment,
      deepseekScore:   null,   // DeepSeek removed
      compositeScore:  consensus.compositeScore,
      approved:        consensus.approved,
      direction:       consensus.direction,
      reason:          consensus.reason,
      nodesUsed:       consensus.nodesUsed,
    });

    // 4. Execute if approved
    if (consensus.approved && consensus.direction !== 'NO_TRADE') {
      const tradeResult = await execute({ bundle, consensus, decisionId });
      return {
        approved:       true,
        executed:       tradeResult.executed,
        decisionId,
        compositeScore: consensus.compositeScore,
        direction:      consensus.direction,
        tradeResult,
      };
    }

    logger.info('Trade not approved', {
      symbol,
      score:  consensus.compositeScore,
      reason: consensus.reason,
    });
    return {
      approved:       false,
      executed:       false,
      decisionId,
      compositeScore: consensus.compositeScore,
      reason:         consensus.reason,
    };

  } catch (err) {
    logger.error('Unhandled error in processSymbol', {
      symbol,
      error: err.message,
      stack: err.stack,
    });
    return { approved: false, executed: false, reason: `Error: ${err.message}` };
  }
}

module.exports = { runLoop, processSymbol };

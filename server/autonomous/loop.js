require('dotenv').config();
const { aggregate }   = require('../data/dataAggregator');
const { runConsensus } = require('../ai/consensus');
const { execute }     = require('../execution/tradeExecutor');
const { logDecision } = require('../db/tradeLogger');
const { getDailyPnl } = require('../db/tradeLogger');
const killSwitch      = require('../risk/killSwitch');
const { setState }    = require('../db/schema');
const logger          = require('../utils/logger');

const SYMBOLS = (process.env.WATCHED_SYMBOLS || 'AAPL,SPY').split(',').map(s => s.trim());

/**
 * Run one complete analysis + execution cycle for all watched symbols.
 */
async function runLoop() {
  logger.info('═══ Loop cycle starting ═══', { symbols: SYMBOLS, time: new Date().toISOString() });

  // Check kill switch before anything
  if (killSwitch.isActive()) {
    logger.warn('Kill switch active — skipping cycle', { reason: killSwitch.getReason() });
    return { skipped: true, reason: 'Kill switch active' };
  }

  // Auto-check daily loss limit
  const isLive  = (process.env.TRADING_MODE || 'paper') === 'live';
  const balance = isLive
    ? parseFloat(process.env.LIVE_ACCOUNT_BALANCE  || '5000')
    : parseFloat(process.env.PAPER_ACCOUNT_BALANCE || '100000');

  killSwitch.autoCheckDailyLoss(getDailyPnl(), balance);
  if (killSwitch.isActive()) {
    logger.warn('Daily loss limit triggered kill switch');
    return { skipped: true, reason: 'Daily loss limit hit' };
  }

  const cycleResults = [];

  for (const symbol of SYMBOLS) {
    logger.info(`─── Processing ${symbol} ───`);
    const result = await processSymbol(symbol);
    cycleResults.push({ symbol, ...result });

    // Small delay between symbols to respect rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  setState('last_run', new Date().toISOString());

  const approved = cycleResults.filter(r => r.approved).length;
  const executed = cycleResults.filter(r => r.executed).length;
  logger.info('═══ Loop cycle complete ═══', { total: SYMBOLS.length, approved, executed });

  return { cycleResults, approved, executed };
}

/**
 * Process one symbol through the full pipeline.
 */
async function processSymbol(symbol) {
  try {
    // 1. Aggregate market data + news
    const bundle = await aggregate(symbol);
    if (!bundle) {
      logger.warn('Skipping symbol — no data', { symbol });
      return { approved: false, executed: false, reason: 'No market data' };
    }

    // 2. Run Tri-Node AI consensus
    const consensus = await runConsensus(bundle);

    // 3. Log the AI decision (regardless of approval)
    const decisionId = logDecision({
      symbol,
      geminiScore:     consensus.rawScores?.gemini,
      geminiThesis:    consensus.nodeResults?.gemini?.thesis,
      ollamaSentiment: consensus.nodeResults?.ollama?.sentiment,
      deepseekScore:   consensus.rawScores?.deepseek,
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
        approved:        true,
        executed:        tradeResult.executed,
        decisionId,
        compositeScore:  consensus.compositeScore,
        direction:       consensus.direction,
        tradeResult,
      };
    }

    logger.info('Trade not approved', { symbol, score: consensus.compositeScore, reason: consensus.reason });
    return {
      approved:       false,
      executed:       false,
      decisionId,
      compositeScore: consensus.compositeScore,
      reason:         consensus.reason,
    };

  } catch (err) {
    logger.error('Unhandled error in processSymbol', { symbol, error: err.message, stack: err.stack });
    return { approved: false, executed: false, reason: `Error: ${err.message}` };
  }
}

module.exports = { runLoop, processSymbol };

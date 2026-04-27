require('dotenv').config();
const killSwitch = require('./killSwitch');
const { getState } = require('../db/schema');
const { getDailyPnl } = require('../db/tradeLogger');
const { isCryptoSymbol } = require('../data/dataAggregator');
const logger = require('../utils/logger');

const MIN_CONFIDENCE   = parseFloat(process.env.MIN_AI_CONFIDENCE       || '55');
const MAX_CONSEC_LOSS  = parseInt(process.env.MAX_CONSECUTIVE_LOSSES     || '3');
const MAX_EXPOSURE_PCT = 0.5;   // 50% max total portfolio exposure
const MAX_POSITION_PCT = parseFloat(process.env.MAX_POSITION_PCT         || '0.10');
const COOLDOWN_MIN     = parseInt(process.env.COOLDOWN_MINUTES            || '30');
const MAX_DAILY_LOSS   = parseFloat(process.env.MAX_DAILY_LOSS_PCT        || '0.05');

/**
 * Run all 10 pre-trade safety checks.
 * Returns { passed: boolean, failed: string[], checks: object[] }
 */
async function runChecks({ consensus, symbol, positionDollars, alpacaAccount, openPositions, liveBalance = null }) {
  const isLive      = (process.env.TRADING_MODE || 'paper') === 'live';
  // Use live balance from Alpaca API if provided; fall back to env for test scripts
  const balance     = liveBalance ?? (isLive
    ? parseFloat(process.env.LIVE_ACCOUNT_BALANCE  || '5000')
    : parseFloat(process.env.PAPER_ACCOUNT_BALANCE || '100000'));
  const dailyPnl    = getDailyPnl();
  const consecLoss  = parseInt(getState('consecutive_losses') || '0');
  const lastRunStr  = getState('last_run') || '';
  const lastRunMs   = lastRunStr ? new Date(lastRunStr).getTime() : 0;
  const minsAgo     = (Date.now() - lastRunMs) / 60000;

  // Total open exposure
  const openExposure = openPositions
    ? openPositions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value || 0)), 0)
    : 0;

  const checks = [
    {
      name: 'Kill Switch OFF',
      passed: !killSwitch.isActive(),
      detail: killSwitch.isActive() ? killSwitch.getReason() : 'OK',
    },
    {
      name: 'Consensus Approved',
      passed: consensus.approved === true,
      detail: consensus.reason,
    },
    {
      name: `AI Confidence ≥ ${MIN_CONFIDENCE}`,
      passed: Math.abs(consensus.compositeScore) >= MIN_CONFIDENCE,
      detail: `Score: ${Math.abs(consensus.compositeScore).toFixed(1)}`,
    },
    {
      name: '≥ 2 AI Nodes Responded',
      passed: (consensus.nodesUsed?.length ?? 0) >= 2,
      detail: `Nodes: ${consensus.nodesUsed?.join(', ') ?? 'none'}`,
    },
    {
      name: `Consecutive Losses < ${MAX_CONSEC_LOSS}`,
      passed: consecLoss < MAX_CONSEC_LOSS,
      detail: `Current streak: ${consecLoss}`,
    },
    {
      name: `Daily Loss < ${MAX_DAILY_LOSS * 100}% of balance`,
      passed: dailyPnl > -(balance * MAX_DAILY_LOSS),
      detail: `Daily PnL: $${dailyPnl.toFixed(2)} / limit: -$${(balance * MAX_DAILY_LOSS).toFixed(2)}`,
    },
    {
      name: 'Total Exposure < 50%',
      passed: openExposure < balance * MAX_EXPOSURE_PCT,
      detail: `Open exposure: $${openExposure.toFixed(0)} / limit: $${(balance * MAX_EXPOSURE_PCT).toFixed(0)}`,
    },
    {
      name: `Position Size ≤ ${MAX_POSITION_PCT * 100}% of balance`,
      passed: positionDollars <= balance * MAX_POSITION_PCT,
      detail: `Position: $${positionDollars.toFixed(0)} / max: $${(balance * MAX_POSITION_PCT).toFixed(0)}`,
    },
    {
      name: `Cooldown ≥ ${COOLDOWN_MIN} min since last trade`,
      passed: lastRunMs === 0 || minsAgo >= COOLDOWN_MIN,
      detail: lastRunMs === 0 ? 'First trade' : `${minsAgo.toFixed(0)} min ago`,
    },
    {
      name: 'No existing open position',
      passed: !openPositions?.some(p => {
        // Normalize both sides: Alpaca may return BTC/USD or BTCUSD for crypto
        const normalize = (s) => (s || '').replace(/[/-]/, '').toUpperCase();
        return normalize(p.symbol) === normalize(symbol);
      }),
      detail: `Checking ${symbol} in ${openPositions?.length ?? 0} open positions`,
    },
  ];

  // ── PDT Rule Warning (stocks under $25k) ──────────────────────────────────
  // Pattern Day Trader: >3 round-trip day trades in 5 days on accounts < $25k
  // This does NOT block the trade (paper trading is fine) but warns loudly.
  if (!isCryptoSymbol(symbol) && balance < 25000) {
    const mode = process.env.TRADING_MODE || 'paper';
    if (mode === 'live') {
      logger.warn('⚠️  PDT RULE RISK — stock account under $25,000', {
        symbol,
        balance,
        warning: 'More than 3 day-trades in 5 days will flag your Alpaca account.',
        action:  'Consider switching to WATCHED_SYMBOLS=BTC/USD,ETH/USD for crypto (no PDT rule).',
      });
    }
  }

  const failed = checks.filter(c => !c.passed).map(c => c.name);
  const passed = failed.length === 0;

  if (!passed) {
    logger.warn('Pre-trade checks FAILED', { symbol, failed });
  } else {
    logger.info('Pre-trade checks PASSED', { symbol, checksRun: checks.length });
  }

  return { passed, failed, checks };
}

module.exports = { runChecks };

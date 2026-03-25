const { getState, setState } = require('../db/schema');
const logger = require('../utils/logger');

function isActive() {
  return getState('kill_switch') === 'true';
}

function activate(reason = 'Manual activation') {
  setState('kill_switch', 'true');
  setState('kill_switch_reason', reason);
  logger.warn('🚨 KILL SWITCH ACTIVATED', { reason });
}

function deactivate() {
  setState('kill_switch', 'false');
  setState('kill_switch_reason', '');
  logger.info('✅ Kill switch deactivated — trading resumed');
}

function getReason() {
  return getState('kill_switch_reason') || '';
}

/**
 * Auto-checks daily PnL against MAX_DAILY_LOSS_PCT.
 * Call this at the start of each loop cycle.
 */
function autoCheckDailyLoss(dailyPnl, accountBalance) {
  const maxLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PCT || '0.05');
  const maxLoss = accountBalance * maxLossPct;

  if (dailyPnl <= -maxLoss && !isActive()) {
    activate(`Auto: Daily loss limit hit (${dailyPnl.toFixed(2)} / -${maxLoss.toFixed(2)})`);
    return true;
  }
  return false;
}

module.exports = { isActive, activate, deactivate, getReason, autoCheckDailyLoss };

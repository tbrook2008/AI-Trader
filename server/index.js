require('dotenv').config();
const express       = require('express');
const path          = require('path');
const { initDb, getState, setState } = require('./db/schema');
const { getRecentDecisions, getRecentTrades, getDailyPnl } = require('./db/tradeLogger');
const killSwitch    = require('./risk/killSwitch');
const { runLoop }   = require('./autonomous/loop');
const logger        = require('./utils/logger');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize DB
initDb();

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

/** System health & status */
app.get('/api/status', (req, res) => {
  const mode       = process.env.TRADING_MODE || 'paper';
  const balance    = mode === 'live'
    ? parseFloat(process.env.LIVE_ACCOUNT_BALANCE  || '5000')
    : parseFloat(process.env.PAPER_ACCOUNT_BALANCE || '100000');

  res.json({
    ok:              true,
    mode:            mode.toUpperCase(),
    balance,
    killSwitch:      killSwitch.isActive(),
    killReason:      killSwitch.getReason(),
    lastRun:         getState('last_run') || null,
    dailyPnl:        getDailyPnl(),
    consecutiveLoss: parseInt(getState('consecutive_losses') || '0'),
    totalTrades:     parseInt(getState('total_trades') || '0'),
    totalWins:       parseInt(getState('total_wins') || '0'),
    watchedSymbols:  (process.env.WATCHED_SYMBOLS || '').split(',').map(s => s.trim()),
    schedule:        process.env.CRON_SCHEDULE || '*/15 * * * *',
    uptime:          Math.floor(process.uptime()),
  });
});

/** Recent AI decisions */
app.get('/api/decisions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20'), 100);
  res.json(getRecentDecisions(limit));
});

/** Recent trades */
app.get('/api/trades', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20'), 100);
  res.json(getRecentTrades(limit));
});

/** Kill switch status */
app.get('/api/killswitch', (req, res) => {
  res.json({ active: killSwitch.isActive(), reason: killSwitch.getReason() });
});

/** Toggle kill switch */
app.post('/api/killswitch', (req, res) => {
  const { action, reason } = req.body;
  if (action === 'activate') {
    killSwitch.activate(reason || 'Manual activation via UI');
    logger.warn('Kill switch activated via API');
    res.json({ ok: true, active: true });
  } else if (action === 'deactivate') {
    killSwitch.deactivate();
    logger.info('Kill switch deactivated via API');
    res.json({ ok: true, active: false });
  } else {
    res.status(400).json({ error: 'action must be "activate" or "deactivate"' });
  }
});

/** Switch trading mode */
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (!['paper', 'live'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be paper or live' });
  }
  process.env.TRADING_MODE = mode;
  setState('trading_mode', mode);
  logger.info('Trading mode switched', { mode });
  res.json({ ok: true, mode });
});

/** Manually trigger one analysis cycle */
app.post('/api/run-now', async (req, res) => {
  logger.info('Manual cycle triggered via API');
  // Run async, return immediately
  runLoop()
    .then(r => logger.info('Manual cycle complete', r))
    .catch(e => logger.error('Manual cycle error', { error: e.message }));
  res.json({ ok: true, message: 'Cycle started — check /api/decisions for results' });
});

/** Serve control panel for any unmatched route */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`🌐 Control panel: http://localhost:${PORT}`);
  logger.info(`📊 Mode: ${(process.env.TRADING_MODE || 'paper').toUpperCase()}`);
});

module.exports = app;

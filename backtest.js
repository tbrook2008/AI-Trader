const macd = require('./server/quantitative/macd');
const bollingerRsi = require('./server/quantitative/bollingerRsi');
const atr = require('./server/quantitative/atr');
const adx = require('./server/quantitative/adx');
const vwap = require('./server/quantitative/vwap');

const ATR_MULTIPLIER = 3.5;
const ATR_TARGET_MULTIPLIER = 2.0;

// Generate realistic 1-minute crypto data (random walk with volatility)
function generateSyntheticData(numBars, startPrice) {
  const data = [];
  let currentPrice = startPrice;
  const volatility = 0.001; // 0.1% volatility per minute

  for (let i = 0; i < numBars; i++) {
    const move = currentPrice * volatility * (Math.random() - 0.5) * 2;
    const open = currentPrice;
    const close = currentPrice + move;
    const high = Math.max(open, close) + (currentPrice * volatility * Math.random());
    const low = Math.min(open, close) - (currentPrice * volatility * Math.random());
    
    data.push({
      time: Date.now() + (i * 60000),
      open, high, low, close,
      volume: Math.random() * 100 + 10 // Random volume
    });
    
    currentPrice = close;
  }
  return data;
}

async function runBacktest() {
  console.log("Generating 10,000 minutes of synthetic market data (~7 days)...");
  const data = generateSyntheticData(10000, 60000); // Start BTC at $60k
  
  let position = null;
  const trades = [];
  
  let wins = 0;
  let losses = 0;
  let totalProfit = 0; 
  
  for (let i = 60; i < data.length; i++) {
    const currentBar = data[i];
    
    if (position) {
      let closed = false;
      let pnlPct = 0;
      
      if (position.type === 'LONG') {
        // Trailing Stop Logic for LONG
        const trailingStop = currentBar.high - (position.atrAtEntry * ATR_MULTIPLIER);
        if (trailingStop > position.stopLoss) {
          position.stopLoss = trailingStop; // Ratchet stop up
        }

        if (currentBar.low <= position.stopLoss) {
          pnlPct = (position.stopLoss - position.entryPrice) / position.entryPrice;
          closed = true;
        } else if (currentBar.high >= position.takeProfit) {
          pnlPct = (position.takeProfit - position.entryPrice) / position.entryPrice;
          closed = true;
        }
      } else if (position.type === 'SHORT') {
        // Trailing Stop Logic for SHORT
        const trailingStop = currentBar.low + (position.atrAtEntry * ATR_MULTIPLIER);
        if (trailingStop < position.stopLoss) {
          position.stopLoss = trailingStop; // Ratchet stop down
        }

        if (currentBar.high >= position.stopLoss) {
          pnlPct = (position.entryPrice - position.stopLoss) / position.entryPrice;
          closed = true;
        } else if (currentBar.low <= position.takeProfit) {
          pnlPct = (position.entryPrice - position.takeProfit) / position.entryPrice;
          closed = true;
        }
      }
      
      if (closed) {
        if (pnlPct > 0) wins++;
        else losses++;
        totalProfit += pnlPct;
        
        trades.push({
          type: position.type,
          entry: position.entryPrice,
          exit: pnlPct > 0 ? position.takeProfit : position.stopLoss,
          pnlPct: pnlPct * 100,
          strategy: position.strategy,
          barsHeld: i - position.entryIndex
        });
        
        position = null;
      }
      continue;
    }
    
    const history = data.slice(Math.max(0, i - 1500), i); // VWAP needs 1440 bars
    
    let macdSignal = macd.evaluate(history.slice(-60), true);
    const bollingerSignal = bollingerRsi.evaluate(history.slice(-60), true);
    let vwapSignal = vwap.evaluate(history);
    
    // Apply ADX Filter to MACD and VWAP
    const isTrending = adx.isTrending(history.slice(-60), 14, 25);
    
    if (macdSignal !== 'NO_TRADE' && !isTrending) {
      macdSignal = 'NO_TRADE'; // Filter out chopped MACD
    }
    
    if (vwapSignal !== 'NO_TRADE' && !isTrending) {
      vwapSignal = 'NO_TRADE'; // Filter out false VWAP breakouts
    }
    
    let signal = 'NO_TRADE';
    let strategy = '';
    
    if (macdSignal !== 'NO_TRADE') {
      signal = macdSignal;
      strategy = 'MACD (Trend Filtered)';
    } else if (bollingerSignal !== 'NO_TRADE') {
      signal = bollingerSignal;
      strategy = 'Bollinger+RSI';
    } else if (vwapSignal !== 'NO_TRADE') {
      signal = vwapSignal;
      strategy = 'VWAP Breakout';
    }
    
    if (signal !== 'NO_TRADE') {
      const currentAtr = atr.calculateATR(history, 14);
      if (!currentAtr) continue;
      
      const entryPrice = currentBar.close;
      const stopDistance = currentAtr * ATR_MULTIPLIER;
      const targetDistance = stopDistance * ATR_TARGET_MULTIPLIER;
      
      position = {
        type: signal,
        entryPrice: entryPrice,
        entryIndex: i,
        strategy: strategy,
        atrAtEntry: currentAtr,
        stopLoss: signal === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance,
        takeProfit: signal === 'LONG' ? entryPrice + targetDistance : entryPrice - targetDistance
      };
    }
  }
  
  console.log('\n--- SYNTHETIC BACKTEST RESULTS ---');
  console.log(`Total Trades: ${trades.length}`);
  if (trades.length > 0) {
    console.log(`Wins: ${wins} | Losses: ${losses}`);
    console.log(`Win Rate: ${((wins / trades.length) * 100).toFixed(2)}%`);
    console.log(`Total Net Profit: ${(totalProfit * 100).toFixed(2)}% (Unleveraged cumulative)`);
    
    const macdTrades = trades.filter(t => t.strategy === 'MACD (Trend Filtered)');
    const bBandsTrades = trades.filter(t => t.strategy === 'Bollinger+RSI');
    const vwapTrades = trades.filter(t => t.strategy === 'VWAP Breakout');
    
    if (macdTrades.length > 0) {
      const mWins = macdTrades.filter(t => t.pnlPct > 0).length;
      console.log(`MACD Trades: ${macdTrades.length} (Win Rate: ${((mWins/macdTrades.length)*100).toFixed(2)}%)`);
    }
    if (bBandsTrades.length > 0) {
      const bWins = bBandsTrades.filter(t => t.pnlPct > 0).length;
      console.log(`BollingerTrades: ${bBandsTrades.length} (Win Rate: ${((bWins/bBandsTrades.length)*100).toFixed(2)}%)`);
    }
    if (vwapTrades.length > 0) {
      const vWins = vwapTrades.filter(t => t.pnlPct > 0).length;
      console.log(`VWAP Trades: ${vwapTrades.length} (Win Rate: ${((vWins/vwapTrades.length)*100).toFixed(2)}%)`);
    }
  } else {
    console.log("No trades executed.");
  }
}

runBacktest();

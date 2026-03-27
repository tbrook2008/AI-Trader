require('dotenv').config();
const { scanForOptimalSymbols } = require('../data/scanner');
const { aggregate }   = require('../data/dataAggregator');
const ollamaNode      = require('../ai/ollamaNode');
const geminiNode      = require('../ai/geminiNode');
const { execute }     = require('../execution/tradeExecutor');
const { logDecision } = require('../db/tradeLogger');
const { getDailyPnl } = require('../db/tradeLogger');
const killSwitch      = require('../risk/killSwitch');
const { setState }    = require('../db/schema');
const logger          = require('../utils/logger');

/**
 * Run the advanced staged pipeline.
 */
async function runLoop() {
  logger.info('═══ Staged Loop cycle starting ═══', { time: new Date().toISOString() });

  if (killSwitch.isActive()) {
    logger.warn('Kill switch active — skipping cycle', { reason: killSwitch.getReason() });
    return { skipped: true };
  }

  try {
    // 1. SCANNING PHASE
    const symbols = await scanForOptimalSymbols();
    
    // 2. AGGREGATION PHASE
    const bundles = [];
    for (const symbol of symbols) {
      const bundle = await aggregate(symbol);
      if (bundle) bundles.push(bundle);
      await new Promise(r => setTimeout(r, 1000)); // Gentle spacing
    }

    if (bundles.length === 0) return { skipped: true, reason: 'No data bundles created' };

    // 3. OLLAMA ANALYSIS PHASE (Sequential to save GPU RAM)
    const candidates = [];
    for (const bundle of bundles) {
      logger.info(`Ollama analyzing ${bundle.symbol}...`);
      const ollamaResult = await ollamaNode.analyze(bundle);
      if (ollamaResult) {
        candidates.push({ symbol: bundle.symbol, bundle, ollamaResult });
      }
    }

    if (candidates.length === 0) return { skipped: true, reason: 'No Ollama candidates' };

    // 4. BATCH GEMINI VERIFICATION PHASE (The "Ultimate Judge")
    logger.info(`Sending batch of ${candidates.length} to Gemini for verification...`);
    const verificationResults = await geminiNode.verifyBatch(candidates);

    // 5. REFINEMENT & EXECUTION PHASE
    const finalResults = [];
    for (const verify of verificationResults) {
      const candidate = candidates.find(c => c.symbol === verify.symbol);
      if (!candidate) continue;

      let finalDecision = verify;

      // REFINEMENT: If Gemini rejected but provided feedback, let Ollama try one more time
      if (!verify.approved && verify.refinement_feedback) {
        logger.info(`Triggering refinement for ${verify.symbol} based on Gemini feedback...`);
        const refinedResult = await ollamaNode.analyze(candidate.bundle, verify.refinement_feedback);
        
        // If refinement significantly changed Ollama's sentiment, we could re-verify, 
        // but for now, we follow the "Judge's" original rejection unless it was a soft 'verify again'
        // In this implementation, we simply log the refinement for future learning.
      }

      // 6. EXECUTION
      let executed = false;
      let tradeResult = null;

      if (finalDecision.approved && finalDecision.direction !== 'NO_TRADE') {
        tradeResult = await execute({ 
          bundle: candidate.bundle, 
          consensus: { 
            approved: true, 
            direction: finalDecision.direction, 
            compositeScore: finalDecision.score 
          } 
        });
        executed = tradeResult.executed;
      }

      // Log decision
      logDecision({
        symbol: candidate.symbol,
        geminiScore: finalDecision.score,
        geminiThesis: finalDecision.reason,
        ollamaSentiment: candidate.ollamaResult.sentiment,
        compositeScore: finalDecision.score,
        approved: finalDecision.approved,
        direction: finalDecision.direction,
        reason: finalDecision.reason,
        nodesUsed: 2
      });

      finalResults.push({ symbol: candidate.symbol, approved: finalDecision.approved, executed });
    }

    setState('last_run', new Date().toISOString());
    logger.info('═══ Staged Loop cycle complete ═══', { 
      total: symbols.length, 
      approved: finalResults.filter(r => r.approved).length,
      executed: finalResults.filter(r => r.executed).length 
    });

    return { finalResults };

  } catch (err) {
    logger.error('Unhandled error in runLoop pipeline', { error: err.message, stack: err.stack });
    return { error: err.message };
  }
}

module.exports = { runLoop };

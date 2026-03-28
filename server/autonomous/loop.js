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

    // 4. BATCH GEMINI VERIFICATION PHASE 1 (Initial Judge)
    logger.info(`Sending batch of ${candidates.length} to Gemini for verification (Pass 1)...`);
    let initialDecisions = await geminiNode.verifyBatch(candidates);

    // 5. REFINEMENT PHASE (Ollama + Gemini Pass 2)
    const refinedCandidates = [];
    for (const decision of initialDecisions) {
      if (!decision.approved && decision.refinement_feedback) {
        const candidate = candidates.find(c => c.symbol === decision.symbol);
        if (candidate) {
          logger.info(`Triggering refinement for ${decision.symbol} based on Gemini feedback...`);
          const refinedResult = await ollamaNode.analyze(candidate.bundle, decision.refinement_feedback);
          if (refinedResult) {
            refinedCandidates.push({ 
              symbol: candidate.symbol, 
              bundle: candidate.bundle, 
              ollamaResult: refinedResult,
              previousFeedback: decision.refinement_feedback 
            });
          }
        }
      }
    }

    let finalDecisions = [...initialDecisions];

    if (refinedCandidates.length > 0) {
      logger.info(`Sending ${refinedCandidates.length} refined candidates to Gemini for final agreement (Pass 2)...`);
      const secondaryDecisions = await geminiNode.verifyBatch(refinedCandidates);
      
      // Merge results: replace initial rejections with secondary decisions if they exist
      for (const sec of secondaryDecisions) {
        const idx = finalDecisions.findIndex(d => d.symbol === sec.symbol);
        if (idx !== -1) {
          logger.info(`Updating decision for ${sec.symbol} after refinement. Approved: ${sec.approved}`);
          finalDecisions[idx] = sec;
        }
      }
    }

    // 6. EXECUTION PHASE
    const finalResults = [];
    for (const decision of finalDecisions) {
      const candidate = candidates.find(c => c.symbol === decision.symbol);
      if (!candidate) continue;

      let executed = false;
      let tradeResult = null;

      if (decision.approved && decision.direction !== 'NO_TRADE') {
        tradeResult = await execute({ 
          bundle: candidate.bundle, 
          consensus: { 
            approved: true, 
            direction: decision.direction, 
            compositeScore: decision.score ?? 0 
          } 
        });
        executed = tradeResult.executed;
      }

      // Log decision
      logDecision({
        symbol: candidate.symbol,
        geminiScore: decision.score,
        geminiThesis: decision.reason,
        ollamaSentiment: candidate.ollamaResult.sentiment,
        compositeScore: decision.score ?? 0,
        approved: decision.approved,
        direction: decision.direction,
        reason: decision.reason,
        nodesUsed: refinedCandidates.some(rc => rc.symbol === decision.symbol) ? 3 : 2
      });

      finalResults.push({ symbol: candidate.symbol, approved: decision.approved, executed });
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

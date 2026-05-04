require('dotenv').config();
const geminiNode   = require('./geminiNode');
const ollamaNode   = require('./ollamaNode');
// DeepSeek node removed — running 2-node consensus (Gemini + Ollama)
const logger       = require('../utils/logger');

const WEIGHTS = {
  gemini: parseFloat(process.env.WEIGHT_GEMINI || '0.65'),
  ollama: parseFloat(process.env.WEIGHT_OLLAMA || '0.35'),
};

const APPROVAL_THRESHOLD = parseFloat(process.env.APPROVAL_THRESHOLD || '55'); // e.g. 55% confidence minimum

function redistributeWeights(results) {
  const available = Object.entries(results).filter(([, v]) => v !== null);
  if (available.length < 1) return null; // Need at least 1 node

  const totalWeight = available.reduce((sum, [k]) => sum + WEIGHTS[k], 0);
  const adjustedWeights = {};
  for (const [k] of available) {
    adjustedWeights[k] = WEIGHTS[k] / totalWeight;
  }
  return { adjustedWeights, availableNodes: available.map(([k]) => k) };
}

function resolveRegime(nodeResults, adjustedWeights) {
  let momentumScore = 0;
  let meanRevertingScore = 0;

  if (nodeResults.gemini) {
    const w = adjustedWeights.gemini;
    if (nodeResults.gemini.regime === 'momentum') momentumScore += nodeResults.gemini.confidence * w;
    else meanRevertingScore += nodeResults.gemini.confidence * w;
  }

  if (nodeResults.ollama) {
    const w = adjustedWeights.ollama;
    if (nodeResults.ollama.regime === 'momentum') momentumScore += nodeResults.ollama.confidence * w;
    else meanRevertingScore += nodeResults.ollama.confidence * w;
  }

  if (momentumScore > meanRevertingScore) {
    return { regime: 'momentum', compositeConfidence: parseFloat(momentumScore.toFixed(2)) };
  } else {
    return { regime: 'mean-reverting', compositeConfidence: parseFloat(meanRevertingScore.toFixed(2)) };
  }
}

async function runConsensus(bundle) {
  logger.info('Starting regime consensus pipeline', { symbol: bundle.symbol });

  let ollamaResult = await ollamaNode.analyze(bundle);
  let geminiResult = null;

  // Always run Gemini for the institutional system since regime is critical
  geminiResult = await geminiNode.analyze(bundle);

  if (geminiResult && ollamaResult) {
    if (geminiResult.regime !== ollamaResult.regime && Math.max(geminiResult.confidence, ollamaResult.confidence) > 70) {
      logger.info('Significant AI disagreement on regime detected — triggering debate/refinement');
      ollamaResult = await ollamaNode.refine(bundle, ollamaResult, geminiResult);
    }
  }

  const rawResults = {
    gemini: geminiResult,
    ollama: ollamaResult,
  };

  const info = redistributeWeights(rawResults);
  if (!info) {
    logger.warn('Consensus aborted — insufficient node responses', { symbol: bundle.symbol });
    return {
      approved: false,
      reason: 'Insufficient node responses',
      compositeScore: 0,
      regime: 'UNKNOWN',
      nodeResults: rawResults,
    };
  }

  const { adjustedWeights, availableNodes } = info;
  const { regime, compositeConfidence } = resolveRegime(rawResults, adjustedWeights);

  const approved = compositeConfidence >= APPROVAL_THRESHOLD;

  const result = {
    approved,
    compositeScore: compositeConfidence, // map to compositeScore so downstream risk manager works cleanly
    regime,
    threshold:    APPROVAL_THRESHOLD,
    nodesUsed:    availableNodes,
    adjustedWeights,
    rawScores: {
      gemini: geminiResult?.confidence ?? null,
      ollama: ollamaResult?.confidence ?? null,
    },
    nodeResults: rawResults,
    reason: approved
      ? `Confidence ${compositeConfidence} ≥ threshold ${APPROVAL_THRESHOLD} → ${regime} regime`
      : `Confidence ${compositeConfidence.toFixed(1)} below threshold ${APPROVAL_THRESHOLD}`,
  };

  logger.info('Consensus complete', {
    symbol:         bundle.symbol,
    compositeConfidence,
    approved,
    regime,
    nodesUsed:      availableNodes.join(', '),
  });

  return result;
}

module.exports = { runConsensus };

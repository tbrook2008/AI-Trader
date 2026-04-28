require('dotenv').config();
const geminiNode   = require('./geminiNode');
const ollamaNode   = require('./ollamaNode');
// DeepSeek node removed — running 2-node consensus (Gemini + Ollama)
const logger       = require('../utils/logger');

const WEIGHTS = {
  gemini: parseFloat(process.env.WEIGHT_GEMINI || '0.65'),
  ollama: parseFloat(process.env.WEIGHT_OLLAMA || '0.35'),
};

const APPROVAL_THRESHOLD = parseFloat(process.env.APPROVAL_THRESHOLD || '55');

/**
 * Normalize Ollama sentiment (-1..1) to score (-100..100).
 */
function normalizeOllama(sentiment) {
  if (sentiment === null || sentiment === undefined) return null;
  return Math.round(sentiment * 100);
}

/**
 * Redistribute weights when some nodes fail.
 * @param {{ gemini: number|null, ollama: number|null, deepseek: number|null }} scores
 * @returns {{ adjustedWeights, availableNodes }}
 */
function redistributeWeights(scores) {
  const available = Object.entries(scores).filter(([, v]) => v !== null);
  if (available.length < 2) return null; // Need at least 2 nodes

  const totalWeight = available.reduce((sum, [k]) => sum + WEIGHTS[k], 0);
  const adjustedWeights = {};
  for (const [k] of available) {
    adjustedWeights[k] = WEIGHTS[k] / totalWeight;
  }
  return { adjustedWeights, availableNodes: available.map(([k]) => k) };
}

/**
 * Determine final trade direction from node results.
 * Uses simple majority weighted by composite score direction.
 */
function resolveDirection(nodeResults) {
  const votes = [
    nodeResults.gemini?.direction,
    nodeResults.ollama ? (nodeResults.ollama.sentiment > 0.1 ? 'LONG' : nodeResults.ollama.sentiment < -0.1 ? 'SHORT' : 'NO_TRADE') : null,
    nodeResults.deepseek?.direction,
  ].filter(Boolean);

  const counts = votes.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NO_TRADE';
}

/**
 * Run the full Tri-Node consensus pipeline for a symbol bundle.
 */
async function runConsensus(bundle) {
  logger.info('Starting consensus pipeline', { symbol: bundle.symbol });

  // Node 1: Gemini — technical analysis
  const geminiResult = await geminiNode.analyze(bundle);

  // Node 2: Ollama — news sentiment (excluded gracefully if offline)
  let ollamaResult = await ollamaNode.analyze(bundle);

  // --- AI DEBATE REFINEMENT LOOP ---
  if (geminiResult && ollamaResult) {
    const geminiScore = geminiResult.score;
    const ollamaScore = normalizeOllama(ollamaResult.sentiment);
    
    // If scores diverge by 50 or more points (e.g., Gemini +30, Ollama -20)
    if (Math.abs(geminiScore - ollamaScore) >= 50) {
      logger.info('Significant AI disagreement detected — triggering debate/refinement', { geminiScore, ollamaScore });
      ollamaResult = await ollamaNode.refine(bundle, ollamaResult, geminiResult);
    }
  }

  const rawScores = {
    gemini: geminiResult?.score ?? null,
    ollama: normalizeOllama(ollamaResult?.sentiment),
  };

  const info = redistributeWeights(rawScores);
  if (!info) {
    logger.warn('Consensus aborted — fewer than 2 nodes responded', { symbol: bundle.symbol });
    return {
      approved: false,
      reason: 'Insufficient node responses (< 2)',
      compositeScore: 0,
      direction: 'NO_TRADE',
      nodeResults: { gemini: geminiResult, ollama: ollamaResult },
    };
  }

  const { adjustedWeights, availableNodes } = info;

  // Weighted composite score
  let compositeScore = 0;
  for (const node of availableNodes) {
    compositeScore += rawScores[node] * adjustedWeights[node];
  }
  compositeScore = parseFloat(compositeScore.toFixed(2));

  const absScore  = Math.abs(compositeScore);
  const approved  = absScore >= APPROVAL_THRESHOLD;
  const direction = approved ? resolveDirection({ gemini: geminiResult, ollama: ollamaResult }) : 'NO_TRADE';

  const result = {
    approved,
    compositeScore,
    direction,
    threshold:    APPROVAL_THRESHOLD,
    nodesUsed:    availableNodes,
    adjustedWeights,
    rawScores,
    nodeResults: {
      gemini: geminiResult,
      ollama: ollamaResult,
    },
    reason: approved
      ? `Score ${compositeScore} ≥ threshold ${APPROVAL_THRESHOLD} → ${direction}`
      : `Score ${absScore.toFixed(1)} below threshold ${APPROVAL_THRESHOLD}`,
  };

  logger.info('Consensus complete', {
    symbol:         bundle.symbol,
    compositeScore,
    approved,
    direction,
    nodesUsed:      availableNodes.join(', '),
  });

  return result;
}

module.exports = { runConsensus };

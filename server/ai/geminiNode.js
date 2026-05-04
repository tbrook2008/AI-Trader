require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

let _genAI = null;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

const SYSTEM_PROMPT = `You are a quantitative trading analyst. Analyze market data and return ONLY valid JSON.
Your role: market regime classification. Determine if the current market is "momentum" or "mean-reverting".
Be decisive. Uncertainty is acceptable — express it via lower confidence.`;

/**
 * Analyze a research bundle and return a structured regime classification thesis.
 * @returns {{ regime: string, confidence: number, thesis: string, keyRisk: string }}
 */
async function analyze(bundle) {
  const model = getGenAI().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const isCrypto = bundle.isCrypto ?? false;
  const assetType = isCrypto
    ? 'CRYPTOCURRENCY (24/7 market, high volatility)'
    : 'EQUITY (NYSE/NASDAQ, Mon–Fri 9:30–16:00 ET)';

  const prompt = `
Analyze this market data for ${bundle.symbol} and return a JSON regime classification.

ASSET TYPE: ${assetType}

MARKET DATA:
- Current Price:   ${bundle.price}
- Day High/Low:    ${bundle.high} / ${bundle.low}
- Volume:          ${bundle.volume}

RECENT HEADLINES (${bundle.headlines.length}):
${bundle.headlines.slice(0, 6).map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')}

${isCrypto ? 'NOTE: This is a crypto asset. Consider broader crypto market conditions.\n' : ''}
Return ONLY this JSON (no markdown, no explanation):
{
  "regime": <"momentum" | "mean-reverting">,
  "confidence": <integer 0-100>,
  "thesis": <2-3 sentence reasoning>,
  "key_risk": <one sentence on biggest risk>
}`;


  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const parsed = JSON.parse(text);

    // Validate required fields
    if (!parsed.regime || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid response structure from Gemini');
    }

    logger.info('Gemini node complete', {
      symbol: bundle.symbol,
      regime: parsed.regime,
      confidence: parsed.confidence,
    });

    return {
      regime:     parsed.regime,
      confidence: Math.max(0, Math.min(100, parsed.confidence)),
      thesis:     parsed.thesis ?? '',
      keyRisk:    parsed.key_risk ?? '',
    };
  } catch (err) {
    logger.error('Gemini node failed', { symbol: bundle.symbol, error: err.message });
    return null;
  }
}

module.exports = { analyze };

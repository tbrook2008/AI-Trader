require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

let _genAI = null;
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

const SYSTEM_PROMPT = `You are a quantitative trading analyst. Analyze market data and return ONLY valid JSON.
Your role: technical analysis and trade thesis formulation.
Be decisive. Uncertainty is acceptable — express it via lower confidence.`;

/**
 * Analyze a research bundle and return a structured technical thesis.
 * @returns {{ score: number, direction: string, confidence: number, thesis: string, entry: number|null, target: number|null, stop: number|null }}
 */
async function analyze(bundle) {
  const model = getGenAI().getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `
Analyze this market data for ${bundle.symbol} and return a JSON trade thesis.

MARKET DATA:
- Current Price:   ${bundle.price} ${bundle.changePct >= 0 ? '+' : ''}${bundle.changePct?.toFixed(2)}%
- EMA 9:           ${bundle.ema9 ?? 'N/A'}
- EMA 21:          ${bundle.ema21 ?? 'N/A'}
- RSI 14:          ${bundle.rsi14 ?? 'N/A'}
- Trend:           ${bundle.trend}
- Regime:          ${bundle.regime}
- Volume Trend:    ${bundle.volumeTrend}
- Day High/Low:    ${bundle.high} / ${bundle.low}

RECENT HEADLINES (${bundle.headlines.length}):
${bundle.headlines.slice(0, 6).map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')}

Return ONLY this JSON (no markdown, no explanation):
{
  "score": <integer -100 to 100, negative=bearish, positive=bullish>,
  "direction": <"LONG" | "SHORT" | "NO_TRADE">,
  "confidence": <integer 0-100>,
  "thesis": <2-3 sentence reasoning>,
  "entry": <suggested entry price or null>,
  "target": <price target or null>,
  "stop": <stop loss price or null>,
  "key_risk": <one sentence on biggest risk>
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const parsed = JSON.parse(text);

    // Validate required fields
    if (typeof parsed.score !== 'number' || !parsed.direction) {
      throw new Error('Invalid response structure from Gemini');
    }

    logger.info('Gemini node complete', {
      symbol: bundle.symbol,
      score: parsed.score,
      direction: parsed.direction,
      confidence: parsed.confidence,
    });

    return {
      score:      Math.max(-100, Math.min(100, parsed.score)),
      direction:  parsed.direction,
      confidence: parsed.confidence ?? 50,
      thesis:     parsed.thesis ?? '',
      entry:      parsed.entry ?? null,
      target:     parsed.target ?? null,
      stop:       parsed.stop ?? null,
      keyRisk:    parsed.key_risk ?? '',
    };
  } catch (err) {
    logger.error('Gemini node failed', { symbol: bundle.symbol, error: err.message });
    return null;
  }
}

module.exports = { analyze };

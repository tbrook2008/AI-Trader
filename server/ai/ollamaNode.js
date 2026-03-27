require('dotenv').config();
const axios = require('axios');
const logger = require('../utils/logger');

const OLLAMA_BASE = () =>
  `http://${process.env.OLLAMA_DESKTOP_IP || 'localhost'}:${process.env.OLLAMA_PORT || 11434}`;

const TIMEOUT_MS = 30000; // Ollama can be slow on first run

const SENTIMENT_PROMPT = (symbol, headlines, feedback = null) => `
You are a financial sentiment analyst. Rate the OVERALL market sentiment for ${symbol} based on these recent news headlines.

${feedback ? `CRITICAL FEEDBACK FROM SENIOR ANALYST: "${feedback}"
Please re-evaluate your thesis considering this feedback. Deep-dive into the data.` : ''}

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond with ONLY a JSON object in this exact format:
{"sentiment": <float from -1.0 to 1.0>, "summary": "<one sentence>"}

Where:
- -1.0 = extremely bearish
- 0.0 = neutral
- +1.0 = extremely bullish

ONLY output valid JSON. No explanation.`;

async function analyze(bundle, feedback = null) {
  const headlines = bundle.headlines.map(h => h.title).filter(Boolean);

  if (headlines.length === 0) {
    logger.warn('Ollama node: no headlines — returning neutral', { symbol: bundle.symbol });
    return { sentiment: 0.0, summary: 'No news available, defaulting to neutral' };
  }

  try {
    const response = await axios.post(
      `${OLLAMA_BASE()}/api/generate`,
      {
        model: process.env.OLLAMA_MODEL || 'llama3',
        prompt: SENTIMENT_PROMPT(bundle.symbol, headlines.slice(0, 8), feedback),
        stream: false,
        options: { temperature: 0.1, num_predict: 150 },
      },
      { timeout: TIMEOUT_MS }
    );

    const raw = response.data?.response?.trim();
    if (!raw) throw new Error('Empty response from Ollama');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Non-JSON Ollama response: ${raw.slice(0, 100)}`);

    const parsed = JSON.parse(jsonMatch[0]);
    const sentiment = Math.max(-1, Math.min(1, parseFloat(parsed.sentiment)));

    logger.info(feedback ? 'Ollama refinement complete' : 'Ollama node complete', { 
      symbol: bundle.symbol, 
      sentiment, 
      summary: parsed.summary 
    });
    
    return { sentiment, summary: parsed.summary ?? '' };
  } catch (err) {
    logger.error('Ollama node error', { symbol: bundle.symbol, error: err.message });
    return null;
  }
}

/**
 * Test Ollama connectivity — used by npm run test:ollama
 */
async function test() {
  const resp = await axios.get(`${OLLAMA_BASE()}/api/tags`, { timeout: 5000 });
  return { ok: true, models: resp.data?.models?.map(m => m.name) };
}

module.exports = { analyze, test };

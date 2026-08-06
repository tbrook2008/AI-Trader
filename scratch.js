const API_KEY = 'PK6SYGJP6XF2OQ2A7RHDD5A7TO';
const SECRET_KEY = '8cq1arS8vGYAALUT7vdmwDhbKHBJTLy8ebCXQ8iEkZBL';
const BASE_URL = 'https://paper-api.alpaca.markets/v2';

const headers = {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': SECRET_KEY
};

async function run() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const activitiesRes = await fetch(`${BASE_URL}/account/activities/FILL?after=${yesterday.toISOString()}`, { headers });
  const fills = await activitiesRes.json();
  
  const symbols = {};
  fills.forEach(f => {
    symbols[f.symbol] = (symbols[f.symbol] || 0) + 1;
  });

  console.log('Symbols traded in last 24h:');
  console.log(symbols);
}

run().catch(console.error);

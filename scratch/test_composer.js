const { calculateTargetPortfolio } = require('../server/quantitative/composerStrategy');
const { rebalancePortfolio } = require('../server/execution/portfolioRebalancer');

async function run() {
  console.log('Testing calculateTargetPortfolio()...');
  try {
    const targets = await calculateTargetPortfolio();
    console.log('Targets:', targets);
  } catch (err) {
    console.error(err);
  }
}

run();

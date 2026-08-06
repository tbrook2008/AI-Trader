/**
 * server/utils/rounding.js
 * Precision helper module for order quantity step size rounding and fractional scale-out.
 */

/**
 * Determine decimal precision (number of decimal places) of a stepSize.
 * @param {number} stepSize - e.g. 1, 0.01, 0.0001
 * @returns {number} Decimal places count
 */
function getPrecision(stepSize = 1) {
  if (!stepSize || Number.isInteger(stepSize) || stepSize >= 1) return 0;
  const str = stepSize.toString();
  if (str.includes('e-')) {
    return parseInt(str.split('e-')[1], 10);
  }
  const parts = str.split('.');
  return parts.length > 1 ? parts[1].length : 0;
}

/**
 * Round a quantity to the nearest stepSize multiple.
 * @param {number} qty - Quantity to round
 * @param {number} stepSize - Minimum order step size (default 1)
 * @returns {number} Step-rounded quantity
 */
function roundToStep(qty, stepSize = 1) {
  if (!stepSize || stepSize <= 0) return Math.round(qty);
  const precision = getPrecision(stepSize);
  const steps = Math.round(Number((qty / stepSize).toFixed(8)));
  const rounded = steps * stepSize;
  return Number(rounded.toFixed(precision));
}

/**
 * Compute partial scale-out and remaining quantity guaranteeing:
 * Q_partial = roundToStep(Q_initial * scalePct, stepSize)
 * Q_remaining = Q_initial - Q_partial
 * Q_partial + Q_remaining == Q_initial (zero residual dust)
 *
 * Supports signatures:
 * - calculateScaleOutQty(initialQty, stepSize)
 * - calculateScaleOutQty(initialQty, scalePct, stepSize)
 *
 * @param {number} initialQty - Total initial trade quantity
 * @param {number} [arg2=1] - stepSize or scalePct
 * @param {number} [arg3] - stepSize if arg2 is scalePct
 * @returns {{ partialQty: number, remainingQty: number, Q_partial: number, Q_remaining: number }}
 */
function calculateScaleOutQty(initialQty, arg2 = 1, arg3) {
  let scalePct = 0.5;
  let stepSize = 1;

  if (arg3 !== undefined) {
    scalePct = arg2;
    stepSize = arg3;
  } else if (typeof arg2 === 'number') {
    stepSize = arg2;
  }

  if (initialQty <= 0) {
    return { partialQty: 0, remainingQty: 0, Q_partial: 0, Q_remaining: 0 };
  }

  const precision = getPrecision(stepSize);
  let partialQty = roundToStep(initialQty * scalePct, stepSize);

  if (partialQty > initialQty) {
    partialQty = initialQty;
  } else if (partialQty <= 0 && initialQty >= stepSize) {
    partialQty = stepSize;
  }

  const rawRemaining = initialQty - partialQty;
  const remainingQty = Number(rawRemaining.toFixed(precision));

  return {
    partialQty,
    remainingQty,
    Q_partial: partialQty,
    Q_remaining: remainingQty
  };
}

module.exports = {
  getPrecision,
  roundToStep,
  calculateScaleOutQty
};


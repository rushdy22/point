// Renderer-side companion to electron/lib/decimal.js. Keep the same scale
// and use this for totals, quantity validation and display formatting.
export const QUANTITY_SCALE = 1000;
export function toScaled(value, label = 'value') {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`INVALID_${String(label).toUpperCase()}`);
  return Math.round((n + Number.EPSILON) * QUANTITY_SCALE);
}
export function fromScaled(value) { return Number(value) / QUANTITY_SCALE; }
export function addScaled(...values) { return values.reduce((sum, value) => sum + toScaled(value), 0); }
export function multiply(a, b) { return Math.round((toScaled(a) * toScaled(b)) / QUANTITY_SCALE); }
export function formatQuantity(value) {
  return fromScaled(toScaled(value, 'quantity')).toFixed(3).replace(/\.?0+$/, '');
}
export function formatMoney(value) { return (fromScaled(toScaled(value, 'money'))).toFixed(2); }

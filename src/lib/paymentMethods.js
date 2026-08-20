import { t } from '../i18n/index.js';

// One canonical list for every POS payment form and record.
export const PAYMENT_METHODS = ['cash', 'instapay', 'wallet', 'visa'];

export function normalizePaymentMethod(method) {
  return PAYMENT_METHODS.includes(method) ? method : 'cash';
}

export function paymentMethodOptions(selected = 'cash') {
  const selectedMethod = normalizePaymentMethod(selected);
  return PAYMENT_METHODS
    .map((method) => `<option value="${method}" ${method === selectedMethod ? 'selected' : ''}>${t(method)}</option>`)
    .join('');
}

export function paymentMethodLabel(method) {
  return t(normalizePaymentMethod(method));
}

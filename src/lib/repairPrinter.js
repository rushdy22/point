import { t } from '../i18n/index.js';
import { getSettings } from './settings.js';
import { buildBrandedRepairA4HTML } from './documentBranding.js';
import { fillWhatsAppTemplate, normalizeWhatsAppMessage } from './whatsapp.js';

export function buildRepairReceivingReceiptHTML(repair, branchId) {
  const settings = getSettings(branchId) || {};
  return buildBrandedRepairA4HTML(repair, settings, 'receiving');
}

export function buildRepairDeliveryInvoiceHTML(repair, parts, payments, branchId) {
  const settings = getSettings(branchId) || {};
  return buildBrandedRepairA4HTML(repair, settings, 'delivery', parts, payments);
}



function buildWhatsAppUrl(phone, message = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function buildRepairWhatsAppReceiptText(repair, branchId, mode = 'receiving', parts = [], payments = []) {
  const settings = getSettings(branchId) || {};
  const wa = settings.whatsapp || {};
  const customer = repair.customer_name || repair.customers?.name || '—';
  const phone = repair.customer_phone || repair.customers?.phone || '';
  const type = [repair.device_type, repair.device_model].filter(Boolean).join(' - ') || '—';
  const serial = repair.serial_number || '—';
  const partsLines = (parts || []).map((p) => `• ${p.product_name || '—'} × ${p.quantity} = ${Number(p.total || 0).toFixed(2)} ج.م`).join('\n');
  const total = Number(repair.total || 0).toFixed(2);
  const paid = Number(repair.paid_amount || 0).toFixed(2);
  const remaining = Number(repair.remaining_amount || 0).toFixed(2);
  const fallbackReceiving = 'مرحبًا {customer}، تم استلام سيارتك في POINT ✅\nرقم الصيانة: {repair}\nرقم الهاتف: {phone}\nالسيارة: {type}\nرقم العربية: {serial}\nالحالة عند الاستلام: {condition}';
  const fallbackDelivery = 'مرحبًا {customer}، تم تجهيز فاتورة صيانة سيارتك رقم {repair} ✅\nرقم الهاتف: {phone}\nالسيارة: {type}\nرقم العربية: {serial}\nالإجمالي: {total} ج.م\nالمدفوع: {paid} ج.م\nالمتبقي: {remaining} ج.م';
  const storedTemplate = mode === 'receiving' ? wa.repairReceivingReceiptTemplate : wa.repairDeliveryReceiptTemplate;
  const oldDefault = storedTemplate && (storedTemplate.includes('جهازك') || storedTemplate.includes('الرقم/السيريال'));
  const template = oldDefault ? (mode === 'receiving' ? fallbackReceiving : fallbackDelivery) : (storedTemplate || (mode === 'receiving' ? fallbackReceiving : fallbackDelivery));
  const values = {
    customer, phone, repair: repair.repair_number || '—', type, serial, condition: repair.device_condition || '—', issue: repair.reported_issue || '—',
    diagnosis: repair.diagnosis || '—', solution: repair.solution || repair.notes || '—', parts: partsLines, total, paid, remaining, warranty: repair.warranty_expiry_date || '—'
  };
  let message = fillWhatsAppTemplate(template, values);
  if (!template.includes('{phone}')) {
    message += `\nرقم الهاتف: ${phone || '—'}`;
  }
  return normalizeWhatsAppMessage(message, wa.footer);
}

export function openRepairDocumentPreview(title, html, { whatsappPhone = '', whatsappMessage = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-lg receipt-preview-modal a4-invoice-preview-modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="btn btn-icon" data-close>✕</button>
      </div>
      <div class="modal-body receipt-preview-body a4-preview-body">
        <iframe title="${title}" class="receipt-preview-frame a4-invoice-frame"></iframe>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>${t('close')}</button>
        ${whatsappPhone ? `<a class="btn btn-ghost" href="${buildWhatsAppUrl(whatsappPhone, whatsappMessage)}" target="_blank">💬 إرسال واتساب</a>` : ''}
        <button class="btn btn-primary" data-print>🖨️ طباعة A4</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const frame = overlay.querySelector('.receipt-preview-frame');
  frame.srcdoc = html;
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-print]').addEventListener('click', () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* ignore */ }
  });
}

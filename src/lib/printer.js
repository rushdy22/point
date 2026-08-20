import { t } from '../i18n/index.js';
import { toast } from './toast.js';
import { paymentMethodLabel } from './paymentMethods.js';
import { fillWhatsAppTemplate, normalizeWhatsAppMessage } from './whatsapp.js';
import { buildBrandedA4InvoiceHTML } from './documentBranding.js';

function buildWhatsAppUrl(phone, message = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Used for the on-screen receipt preview (openReceiptPreview) and the
// browser/dev-preview fallback only — never for the actual silent thermal
// print job anymore (see printReceipt below, which uses buildReceiptPayload
// + the native ESC/POS path instead).
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  return Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Premium A4 customer invoice. This is intentionally separate from the
// thermal ESC/POS receipt so the cashier can keep a compact kitchen/counter
// receipt while the customer-facing document is a full A4 invoice.
export function buildA4InvoiceHTML(sale, items, settings) {
  return buildBrandedA4InvoiceHTML(sale, items, settings || {});
}

export function buildReceiptHTML(sale, items, settings) {
  settings = settings || {};
  const rows = items
    .map(
      (it, idx) => `
      <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
        <td class="col-item">${it.product_name}</td>
        <td class="col-qty">${it.quantity}</td>
        <td class="col-price">${Number(it.unit_price).toFixed(2)}</td>
        <td class="col-total">${Number(it.total).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  return `
  <html dir="rtl" lang="ar">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; font-family: 'Tajawal', Arial, sans-serif; }
      body { width: 80mm; margin: 0; padding: 10px 10px 16px; font-size: 12px; color: #111; }
      .center { text-align: center; }
      .logo { max-width: 60px; max-height: 60px; margin: 0 auto 6px; display: block; object-fit: contain; }
      .store-name { margin: 2px 0 0; font-size: 18px; font-weight: 800; letter-spacing: .3px; }
      .store-meta { margin: 1px 0; font-size: 10.5px; color: #444; }
      .divider { border: none; border-top: 1.5px dashed #333; margin: 8px 0; }
      .divider.solid { border-top: 2px solid #111; }
      .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
      .meta-row b { font-weight: 700; }
      .badge-invoice {
        display: inline-block; border: 1.5px solid #111; border-radius: 4px;
        padding: 3px 10px; font-weight: 800; font-size: 12.5px; letter-spacing: .5px; margin: 4px 0 2px;
      }
      table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
      thead th {
        border-bottom: 1.5px solid #111; padding: 4px 2px; text-align: center;
        font-size: 10.5px; font-weight: 800; background: #f2f2f2;
      }
      thead th.col-item { text-align: right; }
      tbody td { padding: 5px 2px; vertical-align: top; text-align: center; }
      tbody td.col-item { text-align: right; font-weight: 600; }
      tbody td.col-total { font-weight: 700; }
      tbody tr.alt-row { background: #fafafa; }
      tbody tr:not(:last-child) { border-bottom: 1px dotted #ccc; }
      .totals { margin-top: 6px; }
      .totals div { display: flex; justify-content: space-between; margin: 3px 0; font-size: 11.5px; }
      .totals .grand {
        font-weight: 800; font-size: 16px; border-top: 2px solid #111; border-bottom: 2px solid #111;
        padding: 6px 0; margin: 6px 0;
      }
      .footer { text-align: center; margin-top: 14px; }
      .footer .thanks { font-size: 13px; font-weight: 800; margin-bottom: 3px; }
      .footer .tagline { font-size: 10px; color: #666; }
      .cut-line { text-align: center; font-size: 9px; color: #999; margin-top: 10px; letter-spacing: 2px; }
    </style>
  </head>
  <body>
    <div class="center">
      ${settings.storeLogo ? `<img class="logo" src="${settings.storeLogo}" />` : ''}
      <div class="store-name">${settings.storeName}</div>
      ${settings.storeAddress ? `<div class="store-meta">${settings.storeAddress}</div>` : ''}
      ${settings.storePhone ? `<div class="store-meta">${settings.storePhone}</div>` : ''}
    </div>

    <hr class="divider solid" />

    <div class="center">
      <span class="badge-invoice">${t('invoice_title')}</span>
    </div>
    <div class="meta-row"><span>${t('invoice_number')}</span><b>${sale.invoice_number}</b></div>
    <div class="meta-row"><span>${t('invoice_date')}</span><span>${formatDate(sale.created_at)}</span></div>
    ${sale.customer_name ? `<div class="meta-row"><span>${t('customer_name')}</span><span>${sale.customer_name}</span></div>` : ''}
    ${sale.customer_phone ? `<div class="meta-row"><span>${t('customer_phone')}</span><span dir="ltr">${sale.customer_phone}</span></div>` : ''}
    ${sale.customer_vehicle_type ? `<div class="meta-row"><span>السيارة</span><span>${sale.customer_vehicle_type}</span></div>` : ''}
    ${sale.customer_vehicle_number ? `<div class="meta-row"><span>رقم العربية</span><span>${sale.customer_vehicle_number}</span></div>` : ''}

    <hr class="divider" />

    <table>
      <thead>
        <tr>
          <th class="col-item">${t('item')}</th>
          <th class="col-qty">${t('quantity')}</th>
          <th class="col-price">${t('unit_price')}</th>
          <th class="col-total">${t('line_total')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <hr class="divider" />

    <div class="totals">
      <div><span>${t('subtotal')}</span><span>${Number(sale.subtotal).toFixed(2)}</span></div>
      ${Number(sale.discount) > 0 ? `<div><span>${t('discount')}</span><span>-${Number(sale.discount).toFixed(2)}</span></div>` : ''}
      ${Number(sale.tax) > 0 ? `<div><span>${t('tax')}</span><span>${Number(sale.tax).toFixed(2)}</span></div>` : ''}
      <div class="grand"><span>${t('total')}</span><span>${Number(sale.total).toFixed(2)}</span></div>
      <div><span>${t('payment_method')}</span><span>${paymentMethodLabel(sale.payment_method)}</span></div>
      <div><span>${t('paid_amount')}</span><span>${Number(sale.paid_amount).toFixed(2)}</span></div>
      <div><span>${t('change_amount')}</span><span>${Number(sale.change_amount).toFixed(2)}</span></div>
    </div>

    <div class="footer">
      <div class="thanks">${t('thanks_message')}</div>
      <div class="tagline">${settings.storeName}</div>
    </div>
    <div class="cut-line">✂ - - - - - - - - - - - - - - - - - -</div>
  </body>
  </html>`;
}

// Same field set/order as buildReceiptHTML() above, but as a plain data
// object (numbers pre-formatted as strings, labels already translated) for
// the ESC/POS renderer in electron/printing/templates.js — that module is
// a pure layout engine and deliberately knows nothing about i18n/currency
// formatting, so all of that happens here, same as it always has.
function buildReceiptPayload(sale, items, settings) {
  settings = settings || {};
  const meta = [
    { label: t('invoice_number'), value: sale.invoice_number },
    { label: t('invoice_date'), value: formatDate(sale.created_at) }
  ];
  if (sale.customer_name) meta.push({ label: t('customer_name'), value: sale.customer_name });
  if (sale.customer_phone) meta.push({ label: t('customer_phone'), value: sale.customer_phone });
  if (sale.customer_vehicle_type) meta.push({ label: 'السيارة', value: sale.customer_vehicle_type });
  if (sale.customer_vehicle_number) meta.push({ label: 'رقم العربية', value: sale.customer_vehicle_number });

  const totals = [{ label: t('subtotal'), value: Number(sale.subtotal).toFixed(2) }];
  if (Number(sale.discount) > 0) totals.push({ label: t('discount'), value: `-${Number(sale.discount).toFixed(2)}` });
  if (Number(sale.tax) > 0) totals.push({ label: t('tax'), value: Number(sale.tax).toFixed(2) });

  return {
    header: { storeName: settings.storeName, storeAddress: settings.storeAddress, storePhone: settings.storePhone, storeLogo: settings.storeLogo },
    badge: t('invoice_title'),
    meta,
    columns: { item: t('item'), qty: t('quantity'), price: t('unit_price'), total: t('line_total') },
    items: items.map((it) => ({ name: it.product_name, qty: it.quantity, price: Number(it.unit_price).toFixed(2), total: Number(it.total).toFixed(2) })),
    totals,
    grandTotal: { label: t('total'), value: Number(sale.total).toFixed(2) },
    // Own slot (not folded into `totals`) — prints right after the grand
    // total, matching buildReceiptHTML's field order above.
    payment: { label: t('payment_method'), value: paymentMethodLabel(sale.payment_method) },
    paid: { label: t('paid_amount'), value: Number(sale.paid_amount).toFixed(2) },
    change: { label: t('change_amount'), value: Number(sale.change_amount).toFixed(2) },
    footer: { thanks: [t('thanks_message')], tagline: settings.storeName }
  };
}

// A failed print used to resolve normally with { success: false, reason }
// instead of throwing — a caller that only wraps the call in try/catch
// would never see that failure, so a real problem (wrong/offline printer,
// spooler error, etc.) would look exactly like nothing happened at all,
// with no toast and no log. Throwing here makes every failure actually
// visible to whoever's awaiting the call.
function assertPrintSucceeded(result) {
  if (result && result.success === false) {
    const err = new Error(result.reason || 'print-failed');
    err.printerNotFound = !!result.printerNotFound;
    throw err;
  }
  return result;
}

// Prints the cashier receipt as native ESC/POS commands (see
// electron/printing/) over whichever connection (Windows/USB/Network/
// Serial) is configured in Settings for this branch's receipt printer —
// this is a dedicated thermal-printer implementation, not the Electron/
// Chromium print dialog. buildReceiptHTML() above is still used, but only
// for the on-screen preview iframe (openReceiptPreview) — never for the
// actual print job.
export async function printReceipt(sale, items, settings) {
  settings = settings || {};
  if (window.electronAPI?.isElectron) {
    const payload = buildReceiptPayload(sale, items, settings);
    const result = await window.electronAPI.printer.printReceipt(payload, settings.printer);
    return assertPrintSucceeded(result);
  }

  // Fallback for browser/dev preview (no real thermal printer to talk to
  // outside Electron): just show the HTML preview instead of printing.
  const html = buildReceiptHTML(sale, items, settings);
  const win = window.open('', '_blank', 'width=350,height=600');
  win.document.write(html);
  win.document.close();
  win.focus();
  return { success: true, reason: 'browser-fallback' };
}

export function buildWhatsAppInvoiceText(sale, items, settings) {
  settings = settings || {};
  const money = (value) => Number(value || 0).toFixed(2);
  const date = new Date(sale.created_at).toLocaleString('ar-EG');
  const itemLines = (items || []).map((item) => `• ${item.product_name} × ${item.quantity} = ${money(item.total)} ج.م`).join('\n');
  const template = settings.whatsapp?.invoiceTemplate || '*{store}*\n\nفاتورة مبيعات رقم {invoice}\nالعميل: {customer}\nرقم الهاتف: {phone}\nالسيارة: {vehicle}\nرقم العربية: {vehicle_number}\nالإجمالي: {total} ج.م\nطريقة الدفع: {payment}';
  const values = {
    store: settings.storeName || 'المتجر', invoice: sale.invoice_number || '', date, customer: sale.customer_name || '—',
    phone: sale.customer_phone || '—', vehicle: sale.customer_vehicle_type || '—', vehicle_number: sale.customer_vehicle_number || '—',
    total: money(sale.total), paid: money(sale.paid_amount), change: money(sale.change_amount), payment: paymentMethodLabel(sale.payment_method), items: itemLines
  };
  let message = fillWhatsAppTemplate(template, values);
  // Item details are mandatory for sales invoices. Keep existing custom templates
  // intact, but append the items automatically when {items} is not present.
  if (!template.includes('{items}')) {
    message += `\n\nالأصناف:\n${values.items || '—'}`;
  }
  if (!template.includes('{phone}') || !template.includes('{vehicle}') || !template.includes('{vehicle_number}')) {
    message += `\n\nبيانات العميل\nرقم الهاتف: ${values.phone}\nالسيارة: ${values.vehicle}\nرقم العربية: ${values.vehicle_number}`;
  }
  return normalizeWhatsAppMessage(message, settings.whatsapp?.footer);
}

// The preview is used before every real print, allowing the cashier to
// verify the invoice and then choose to print it from the preview window.
export function openReceiptPreview(sale, items, onPrinted, settings) {
  settings = settings || {};
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-lg receipt-preview-modal a4-invoice-preview-modal">
      <div class="modal-header">
        <h3>${t('invoice_title')} - ${sale.invoice_number}</h3>
        <button class="btn btn-icon" data-close>✕</button>
      </div>
      <div class="modal-body receipt-preview-body a4-preview-body">
        <iframe title="${t('invoice_title')}" class="receipt-preview-frame a4-invoice-frame"></iframe>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>${t('close')}</button>
        ${sale.customer_phone && settings.whatsapp?.enabled !== false ? `<a class="btn btn-ghost" data-whatsapp href="${buildWhatsAppUrl(sale.customer_phone, buildWhatsAppInvoiceText(sale, items, settings))}" target="_blank">💬 إرسال واتساب</a>` : ''}
        <button class="btn btn-primary" data-print>🖨️ طباعة الفاتورة A4</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const frame = overlay.querySelector('.receipt-preview-frame');
  frame.srcdoc = buildA4InvoiceHTML(sale, items, settings);
  overlay.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => overlay.remove()));
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-print]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const html = buildA4InvoiceHTML(sale, items, settings);
      let result;
      if (window.electronAPI?.isElectron) {
        result = await window.electronAPI.printInvoice({
          html,
          printerName: settings.reportPrinterName || '',
          silent: Boolean(settings.reportPrinterName)
        });
      } else {
        const win = window.open('', '_blank');
        if (!win) throw new Error('POPUP_BLOCKED');
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 250);
        result = { success: true };
      }
      if (result?.success === false) throw new Error(result.reason || 'Print failed');
      await onPrinted?.();
      toast('تمت طباعة الفاتورة بنجاح', 'success');
      overlay.remove();
    } catch (err) {
      console.error('[A4 invoice] print failed:', err);
      toast('تعذر طباعة الفاتورة A4. تأكد من اختيار طابعة التقارير في الإعدادات.', 'error', 6000);
    } finally {
      button.disabled = false;
    }
  });
}

// A4/report printer names — used only to populate the report-printer
// dropdown in Settings (settings.reportPrinterName).
export async function listReportPrinters() {
  if (window.electronAPI?.isElectron) return window.electronAPI.listPrinters();
  return [];
}

// Windows/USB/Serial device discovery for the thermal receipt-printer
// picker in Settings. Network printers have no discovery here —
// the cashier/manager enters host/port directly (usually from the
// printer's self-test page).
export async function listThermalPrinterDevices() {
  if (window.electronAPI?.isElectron) return window.electronAPI.printer.listDevices();
  return { usb: [], serial: [], windows: [] };
}

// Sends a real ESC/POS test page to the receipt-printer connection
// descriptor passed in — it may be a not-yet-saved connection
// straight from the Settings form, so the cashier/manager can verify a
// printer before committing to it.
export async function testPrintThermal(printerConfig) {
  if (!window.electronAPI?.isElectron) return { success: false, reason: 'not-electron' };
  return window.electronAPI.printer.testPrint(printerConfig);
}

import { t } from '../i18n/index.js';
import { toast, confirmDialog } from '../lib/toast.js';
import { loadBranchSettings, saveSettings } from '../lib/settings.js';
import { listReportPrinters, listThermalPrinterDevices, testPrintThermal, openReceiptPreview } from '../lib/printer.js';
import { PAPER_SIZES } from '../lib/paperSizes.js';
import { supabase } from '../lib/supabase.js';
import { normalizePrintBranding } from '../lib/documentBranding.js';


function printBrandingFieldsHTML(branding) {
  const b = normalizePrintBranding({ printBranding: branding });
  const ck = (name, label) => `<label style="display:flex;align-items:center;gap:8px;padding:7px 0;"><input type="checkbox" name="pb_${name}" ${b[name] ? 'checked' : ''}> ${label}</label>`;
  return `
    <div class="card card-pad" style="margin:18px 0; border-color:var(--color-primary);">
      <h3 style="margin-bottom:6px;">🧾 تخصيص فواتير وريسيتات العميل</h3>
      <p class="text-muted" style="font-size:12px;line-height:1.7;margin-bottom:12px;">تحكم كامل في شكل الفاتورة A4 وإيصال الصيانة والاستلام. نفس التصميم يُستخدم في المستندات الثلاثة.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field"><label>اللون الأساسي</label><input class="input" type="color" name="pb_primaryColor" value="${b.primaryColor}"></div>
        <div class="field"><label>لون الهيدر</label><input class="input" type="color" name="pb_darkColor" value="${b.darkColor}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field"><label>عنوان فاتورة البيع</label><input class="input" name="pb_invoiceTitle" value="${b.invoiceTitle}"></div>
        <div class="field"><label>عنوان الصيانة</label><input class="input" name="pb_repairTitle" value="${b.repairTitle}"></div>
      </div>
      <div class="field"><label>عنوان إيصال الاستلام</label><input class="input" name="pb_receivingTitle" value="${b.receivingTitle}"></div>
      <div class="field"><label>Tagline</label><input class="input" name="pb_tagline" value="${b.tagline}"></div>
      <div class="field"><label>رسالة الشكر</label><input class="input" name="pb_footerThanks" value="${b.footerThanks}"></div>
      <div class="field"><label>النص الإضافي أسفل الفاتورة</label><textarea class="input" name="pb_footerText" rows="2">${b.footerText || ''}</textarea></div>
      <div class="field"><label>رقم الهاتف الأول</label><input class="input" name="pb_phone1" value="${b.contactPhone1}"></div>
      <div class="field"><label>رقم الهاتف الثاني</label><input class="input" name="pb_phone2" value="${b.contactPhone2}"></div>
      <div class="field"><label>العنوان على الفاتورة</label><textarea class="input" name="pb_address" rows="2">${b.address}</textarea></div>
      <div class="field"><label>رابط فيسبوك</label><input class="input" name="pb_facebookUrl" value="${b.facebookUrl}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${ck('showLogo','إظهار اللوجو')}${ck('showStoreName','إظهار اسم الشركة')}
        ${ck('showInvoiceNumber','إظهار الرقم')}${ck('showDate','إظهار التاريخ')}
        ${ck('showCustomer','إظهار اسم العميل')}${ck('showCustomerPhone','إظهار الهاتف')}
        ${ck('showVehicleOrDevice','إظهار السيارة / الجهاز')}${ck('showItems','إظهار جدول الأصناف')}
        ${ck('showPayment','إظهار ملخص الدفع')}${ck('showNotes','إظهار الملاحظات')}
        ${ck('showContacts','إظهار أرقام التواصل')}${ck('showAddress','إظهار العنوان')}
        ${ck('showFacebook','إظهار فيسبوك')}${ck('showFacebookQr','إظهار QR فيسبوك')}
      </div>
    </div>`;
}

function readPrintBrandingFromForm(fd) {
  const bool = (name) => fd.get(`pb_${name}`) === 'on';
  return {
    primaryColor: fd.get('pb_primaryColor') || '#F2B214', darkColor: fd.get('pb_darkColor') || '#111315',
    invoiceTitle: fd.get('pb_invoiceTitle') || 'فاتورة', repairTitle: fd.get('pb_repairTitle') || 'فاتورة صيانة', receivingTitle: fd.get('pb_receivingTitle') || 'إيصال استلام',
    tagline: fd.get('pb_tagline') || 'Precision. Performance. Point.', footerThanks: fd.get('pb_footerThanks') || 'شكرًا لثقتكم في POINT', footerText: fd.get('pb_footerText') || '',
    contactPhone1: fd.get('pb_phone1') || '', contactPhone2: fd.get('pb_phone2') || '', address: fd.get('pb_address') || '', facebookUrl: fd.get('pb_facebookUrl') || '',
    showLogo: bool('showLogo'), showStoreName: bool('showStoreName'), showInvoiceNumber: bool('showInvoiceNumber'), showDate: bool('showDate'), showCustomer: bool('showCustomer'), showCustomerPhone: bool('showCustomerPhone'), showVehicleOrDevice: bool('showVehicleOrDevice'), showItems: bool('showItems'), showPayment: bool('showPayment'), showNotes: bool('showNotes'), showContacts: bool('showContacts'), showAddress: bool('showAddress'), showFacebook: bool('showFacebook'), showFacebookQr: bool('showFacebookQr')
  };
}

// Renders the connection-type picker + relevant fields for the receipt
// thermal (ESC/POS) printer. Ported from POS System's settingsPage.js.
function printerConfigFieldsHTML(prefix, config, devices) {
  const cfg = config || {};
  const type = cfg.type || '';
  return `
    <div class="field">
      <label>${t('printer_connection_type')}</label>
      <select class="input" name="${prefix}_type" data-printer-type-select="${prefix}">
        <option value="" ${type === '' ? 'selected' : ''}>—</option>
        <option value="windows" ${type === 'windows' ? 'selected' : ''}>${t('printer_type_windows')}</option>
        <option value="usb" ${type === 'usb' ? 'selected' : ''}>${t('printer_type_usb')}</option>
        <option value="network" ${type === 'network' ? 'selected' : ''}>${t('printer_type_network')}</option>
        <option value="serial" ${type === 'serial' ? 'selected' : ''}>${t('printer_type_serial')}</option>
      </select>
    </div>
    <div data-printer-fields="${prefix}" data-show-for="windows" style="${type === 'windows' ? '' : 'display:none;'}">
      <div class="field">
        <label>${t('printer_windows_device')}</label>
        <select class="input" name="${prefix}_printerName">
          <option value="">—</option>
          ${(devices?.windows || []).map((d) => `<option value="${d.name}" ${cfg.printerName === d.name ? 'selected' : ''}>${d.label}</option>`).join('')}
        </select>
        <div class="text-muted" style="font-size:12px; margin-top:4px;">${t('printer_windows_hint')}</div>
        ${(devices?.windows || []).length === 0 ? `<div class="text-muted" style="font-size:12px; margin-top:4px;">${t('printer_no_windows_found')}</div>` : ''}
      </div>
    </div>
    <div data-printer-fields="${prefix}" data-show-for="usb" style="${type === 'usb' ? '' : 'display:none;'}">
      <div class="field">
        <label>${t('printer_usb_device')}</label>
        <select class="input" name="${prefix}_usbDevice">
          <option value="">${t('printer_usb_auto')}</option>
          ${(devices?.usb || []).map((d) => {
            const value = `${d.vendorId}:${d.productId}`;
            const selected = String(cfg.vendorId) === String(d.vendorId) && String(cfg.productId) === String(d.productId);
            return `<option value="${value}" ${selected ? 'selected' : ''}>${d.label}</option>`;
          }).join('')}
        </select>
        ${(devices?.usb || []).length === 0 ? `<div class="text-muted" style="font-size:12px; margin-top:4px;">${t('printer_no_usb_found')}</div>` : ''}
        <div class="text-muted" style="font-size:12px; margin-top:4px;">${t('printer_usb_hint')}</div>
      </div>
    </div>
    <div data-printer-fields="${prefix}" data-show-for="network" style="${type === 'network' ? '' : 'display:none;'}">
      <div class="field">
        <label>${t('printer_ip_address')}</label>
        <input class="input" name="${prefix}_host" value="${cfg.host || ''}" placeholder="192.168.1.50" />
      </div>
      <div class="field">
        <label>${t('printer_port')}</label>
        <input class="input" type="number" name="${prefix}_port" value="${cfg.port || 9100}" />
      </div>
    </div>
    <div data-printer-fields="${prefix}" data-show-for="serial" style="${type === 'serial' ? '' : 'display:none;'}">
      <div class="field">
        <label>${t('printer_serial_port')}</label>
        <select class="input" name="${prefix}_path">
          <option value="">—</option>
          ${(devices?.serial || []).map((p) => `<option value="${p.path}" ${cfg.path === p.path ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>${t('printer_baud_rate')}</label>
        <input class="input" type="number" name="${prefix}_baudRate" value="${cfg.baudRate || 9600}" />
      </div>
    </div>
    <div class="field">
      <label>${t('paper_size')}</label>
      <select class="input" name="${prefix}_paperSize">
        ${Object.keys(PAPER_SIZES).map((size) => `<option value="${size}" ${(cfg.paperSize || '80mm') === size ? 'selected' : ''}>${PAPER_SIZES[size].label}</option>`).join('')}
      </select>
      <div class="text-muted" style="font-size:12px; margin-top:4px;">${t('paper_size_hint')}</div>
    </div>
    <div class="flex gap-8" style="margin: 4px 0 18px;">
      <button type="button" class="btn btn-ghost btn-sm" data-test-thermal="${prefix}">🖨️ ${t('test_print')}</button>
    </div>`;
}

function readPrinterConfigFromForm(fd, prefix) {
  const type = fd.get(`${prefix}_type`) || '';
  const [vendorId, productId] = String(fd.get(`${prefix}_usbDevice`) || '').split(':');
  return {
    type,
    printerName: fd.get(`${prefix}_printerName`) || '',
    vendorId: vendorId || '',
    productId: productId || '',
    host: fd.get(`${prefix}_host`) || '',
    port: Number(fd.get(`${prefix}_port`) || 9100),
    path: fd.get(`${prefix}_path`) || '',
    baudRate: Number(fd.get(`${prefix}_baudRate`) || 9600),
    paperSize: fd.get(`${prefix}_paperSize`) || '80mm'
  };
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function renderSettings(container, profile, branchId) {
  if (!branchId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏬</div>
        <div style="font-weight:700; font-size:15px;">${t('select_branch')}</div>
        <div class="text-muted" style="margin-top:6px;">اختر فرعًا محددًا من أعلى الصفحة لعرض/تعديل إعداداته</div>
      </div>`;
    return;
  }

  let settings = await loadBranchSettings(branchId);
  const reportPrinters = await listReportPrinters(); // A4 Windows/CUPS printers, for reports only
  const thermalDevices = await listThermalPrinterDevices(); // { usb, serial, windows } — for the receipt printer

  function draw() {
    container.innerHTML = `
      <div class="card card-pad" style="max-width:560px;">
        <h3 style="margin-bottom:18px;">${t('settings_title')}</h3>
        <form id="settings-form">
          <div class="field">
            <label>${t('store_logo')}</label>
            <div class="flex items-center gap-16">
              <div style="width:64px;height:64px;border-radius:12px;border:1px dashed var(--color-border-strong);display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--color-surface-2);">
                ${settings.storeLogo ? `<img src="${settings.storeLogo}" style="width:100%;height:100%;object-fit:contain;" />` : `<span style="font-size:22px;">🏪</span>`}
              </div>
              <div class="flex gap-8">
                <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
                  ${t('upload_logo')}
                  <input type="file" accept="image/*" id="logo-input" style="display:none;" />
                </label>
                ${settings.storeLogo ? `<button type="button" class="btn btn-ghost btn-sm" id="remove-logo-btn">${t('remove_logo')}</button>` : ''}
              </div>
            </div>
          </div>
          <div class="field">
            <label>${t('store_name')}</label>
            <input class="input" name="storeName" value="${settings.storeName}" />
          </div>
          <div class="field">
            <label>${t('store_phone')}</label>
            <input class="input" name="storePhone" value="${settings.storePhone}" />
          </div>
          <div class="field">
            <label>${t('store_address')}</label>
            <input class="input" name="storeAddress" value="${settings.storeAddress}" />
          </div>
          <div class="field">
            <label>${t('tax_rate')}</label>
            <input class="input" type="number" step="0.01" name="taxRate" value="${settings.taxRate}" />
          </div>
          ${printBrandingFieldsHTML(settings.printBranding)}
          <div class="card card-pad" style="margin:18px 0; border-color:var(--color-primary);">
            <h3 style="margin-bottom:6px;">💬 إعدادات واتساب</h3>
            <p class="text-muted" style="font-size:12px;line-height:1.7;margin-bottom:14px;">تحكم كامل في رسائل العملاء. استخدم المتغيرات الموضحة أسفل كل رسالة.</p>
            <div class="field"><label><input type="checkbox" name="wa_enabled" ${settings.whatsapp?.enabled !== false ? 'checked' : ''}> تفعيل رسائل واتساب</label></div>
            <div class="field"><label>كود الدولة</label><input class="input" name="wa_country" value="${settings.whatsapp?.countryCode || '20'}"></div>
            <div class="field"><label>رسالة فاتورة المبيعات</label><textarea class="input" name="wa_invoice" rows="4">${settings.whatsapp?.invoiceTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{store} {invoice} {customer} {total} {paid} {change} {payment} {items} {date}</div></div>
            <div class="field"><label>رسالة استلام طلب الصيانة</label><textarea class="input" name="wa_received" rows="4">${settings.whatsapp?.repairReceivedTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{customer} {repair} {type} {issue}</div></div>
            <div class="field"><label>رسالة عرض السعر / طلب الموافقة</label><textarea class="input" name="wa_quote" rows="5">${settings.whatsapp?.repairQuoteTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{customer} {repair} {type} {issue} {diagnosis} {solution} {parts} {labor} {discount} {total}</div></div>
            <div class="field"><label>رسالة بعد الموافقة</label><textarea class="input" name="wa_approved" rows="3">${settings.whatsapp?.repairApprovedTemplate || ''}</textarea></div>
            <div class="field"><label>رسالة جاهز للاستلام</label><textarea class="input" name="wa_ready" rows="3">${settings.whatsapp?.repairReadyTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{repair} {remaining}</div></div>
            <div class="field"><label>تذكير الاستلام</label><textarea class="input" name="wa_pickup" rows="3">${settings.whatsapp?.repairPickupTemplate || ''}</textarea></div>
            <div class="field"><label>تذكير الضمان</label><textarea class="input" name="wa_warranty" rows="3">${settings.whatsapp?.repairWarrantyTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{repair} {warranty}</div></div>
            <div class="field"><label>رسالة واتساب لإيصال الاستلام</label><textarea class="input" name="wa_receiving_receipt" rows="4">${settings.whatsapp?.repairReceivingReceiptTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{customer} {repair} {type} {serial} {condition}</div></div>
            <div class="field"><label>رسالة واتساب لفاتورة/ريسيت الصيانة</label><textarea class="input" name="wa_delivery_receipt" rows="4">${settings.whatsapp?.repairDeliveryReceiptTemplate || ''}</textarea><div class="text-muted" style="font-size:11px;">{customer} {repair} {type} {serial} {total} {paid} {remaining}</div></div>
            <div class="field"><label>تذييل كل رسائل واتساب</label><textarea class="input" name="wa_footer" rows="3">${settings.whatsapp?.footer || ''}</textarea></div>
          </div>
          <div class="field">
            <label>${t('select_printer')}</label>
            <div class="text-muted" style="font-size:12px; margin-bottom:6px;">${t('thermal_printer_hint')}</div>
            ${printerConfigFieldsHTML('receipt', settings.printer, thermalDevices)}
          </div>
          <div class="field">
            <label>${t('select_report_printer')}</label>
            <select class="input" name="reportPrinterName">
              <option value="">—</option>
              ${reportPrinters.map((p) => `<option value="${p.name}" ${settings.reportPrinterName === p.name ? 'selected' : ''}>${p.name}${p.isDefault ? ' (افتراضي)' : ''}</option>`).join('')}
            </select>
            <div class="text-muted" style="font-size:12px; margin-top:4px;">${t('report_printer_hint')}</div>
            ${reportPrinters.length === 0 ? `<div class="text-muted" style="font-size:12px; margin-top:4px;">لا توجد طابعات متاحة (فعّالة فقط داخل تطبيق Electron)</div>` : ''}
          </div>
          <div class="flex gap-12">
            <button type="submit" class="btn btn-primary">${t('save')}</button>
            <button type="button" class="btn btn-ghost" id="test-print-btn">🖨️ ${t('test_print')}</button>
          </div>
        </form>
      </div>
      ${profile?.role === 'admin' ? `
        <div class="card card-pad" style="max-width:560px; margin-top:18px; border-color:var(--color-danger);">
          <h3 style="color:var(--color-danger); margin-bottom:8px;">⚠️ تصفير النظام بالكامل</h3>
          <p class="text-muted" style="font-size:13px; line-height:1.75; margin-bottom:14px;">
            يحذف جميع بيانات التشغيل محليًا ومن قاعدة البيانات أونلاين: المنتجات والأقسام والعملاء والموردين والفواتير والمشتريات والصيانة والدفعات والمخزون والحسابات ودرج الكاشير والموظفين. يتم الإبقاء فقط على المستخدمين والفروع حتى تتمكن من تسجيل الدخول والبدء من جديد.
          </p>
          <button type="button" class="btn btn-danger" id="reset-accounts-btn">⚠️ حذف كل بيانات النظام والبدء من جديد</button>
        </div>` : ''}
    `;

    const logoInput = container.querySelector('#logo-input');
    logoInput.addEventListener('change', async () => {
      const file = logoInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataURL(file);
        settings = await saveSettings(branchId, { storeLogo: dataUrl });
        toast(t('success'), 'success');
        draw();
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });

    const removeBtn = container.querySelector('#remove-logo-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          settings = await saveSettings(branchId, { storeLogo: '' });
          toast(t('success'), 'success');
          draw();
        } catch {
          toast(t('error_occurred'), 'error');
        }
      });
    }

    // Show only the connection fields relevant to the selected type
    // (Windows / USB / Network / Serial) for the receipt printer.
    container.querySelectorAll('[data-printer-type-select]').forEach((select) => {
      select.addEventListener('change', () => {
        const prefix = select.dataset.printerTypeSelect;
        const value = select.value;
        container.querySelectorAll(`[data-printer-fields="${prefix}"]`).forEach((block) => {
          block.style.display = block.dataset.showFor === value ? '' : 'none';
        });
      });
    });

    // Sends a real ESC/POS test page to the receipt-printer connection
    // currently filled in on the form, even before it is saved.
    container.querySelectorAll('[data-test-thermal]').forEach((button) => {
      button.addEventListener('click', async () => {
        const prefix = button.dataset.testThermal;
        const fd = new FormData(container.querySelector('#settings-form'));
        const target = readPrinterConfigFromForm(fd, prefix);
        if (!target.type) {
          toast(t('printer_not_configured'), 'error');
          return;
        }
        button.disabled = true;
        try {
          const result = await testPrintThermal(target);
          toast(result?.success ? t('success') : t('error_occurred'), result?.success ? 'success' : 'error');
        } catch {
          toast(t('error_occurred'), 'error');
        } finally {
          button.disabled = false;
        }
      });
    });

    container.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        settings = await saveSettings(branchId, {
          storeName: fd.get('storeName'),
          storePhone: fd.get('storePhone'),
          storeAddress: fd.get('storeAddress'),
          taxRate: Number(fd.get('taxRate') || 0),
          printBranding: readPrintBrandingFromForm(fd),
          printer: readPrinterConfigFromForm(fd, 'receipt'),
          reportPrinterName: fd.get('reportPrinterName'),
          whatsapp: {
            enabled: fd.get('wa_enabled') === 'on', countryCode: fd.get('wa_country') || '20',
            invoiceTemplate: fd.get('wa_invoice') || '', repairReceivedTemplate: fd.get('wa_received') || '',
            repairQuoteTemplate: fd.get('wa_quote') || '', repairApprovedTemplate: fd.get('wa_approved') || '',
            repairReadyTemplate: fd.get('wa_ready') || '', repairPickupTemplate: fd.get('wa_pickup') || '',
            repairWarrantyTemplate: fd.get('wa_warranty') || '', repairReceivingReceiptTemplate: fd.get('wa_receiving_receipt') || '', repairDeliveryReceiptTemplate: fd.get('wa_delivery_receipt') || '', footer: fd.get('wa_footer') || ''
          }
        });
        toast(t('success'), 'success');
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });

    container.querySelector('#test-print-btn').addEventListener('click', async () => {
      const demoSale = {
        invoice_number: 'TEST-0001',
        created_at: new Date().toISOString(),
        subtotal: 10, discount: 0, tax: 0, total: 10, paid_amount: 10, change_amount: 0,
        payment_method: 'cash', customer_name: ''
      };
      const demoItems = [{ product_name: 'منتج تجريبي', quantity: 1, unit_price: 10, total: 10 }];
      try {
        openReceiptPreview(demoSale, demoItems, () => toast(t('success'), 'success'), settings);
      } catch {
        toast(t('error_occurred'), 'error');
      }
    });

    const resetAccountsBtn = container.querySelector('#reset-accounts-btn');
    if (resetAccountsBtn) {
      resetAccountsBtn.addEventListener('click', async () => {
        const confirmed = await confirmDialog('⚠️ سيتم حذف كل بيانات التشغيل نهائيًا من الأونلاين والجهاز المحلي، بما فيها الفواتير والمنتجات والعملاء والموردين والمخزون والصيانة والحسابات ودرج الكاشير. سيبقى المستخدمون والفروع فقط. هل أنت متأكد؟');
        if (!confirmed) return;
        const second = await confirmDialog('تأكيد نهائي: لا يمكن التراجع عن الحذف بعد التنفيذ. هل تريد بدء النظام من الصفر؟');
        if (!second) return;
        resetAccountsBtn.disabled = true;
        try {
          const { error: onlineError } = await supabase.rpc('owner_admin_hard_delete_all');
          if (onlineError) throw onlineError;
          const result = await window.electronAPI?.business?.execute('system:hard-delete-all');
          if (result?.error) throw new Error(result.error.message);
          await window.electronAPI?.sync?.forceSync?.();
          toast('تم حذف بيانات النظام أونلاين ومحليًا. النظام جاهز للبدء من جديد.', 'success', 7000);
        } catch (error) {
          toast(error.message || t('error_occurred'), 'error', 7000);
          resetAccountsBtn.disabled = false;
        }
      });
    }

  }

  draw();
}

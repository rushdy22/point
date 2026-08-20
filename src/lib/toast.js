export function toast(message, type = 'info', duration = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="width:380px">
        <div class="modal-body" style="text-align:center; padding-top:28px;">
          <div style="font-size:34px; margin-bottom:10px;">⚠️</div>
          <p style="font-size:15px; font-weight:600;">${message}</p>
        </div>
        <div class="modal-footer" style="justify-content:center;">
          <button class="btn btn-ghost" data-action="cancel">إلغاء</button>
          <button class="btn btn-danger" data-action="confirm">تأكيد</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
      const action = e.target.dataset?.action;
      if (action === 'confirm') { overlay.remove(); resolve(true); }
      if (action === 'cancel') { overlay.remove(); resolve(false); }
    });
  });
}

import { login } from '../lib/auth.js';
import { t } from '../i18n/index.js';

const brandLogoUrl = new URL('../../assets/rashed-systems-logo.png', import.meta.url).href;

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-screen">
      <div class="login-orb login-orb-one"></div>
      <div class="login-orb login-orb-two"></div>
      <div class="login-card" dir="rtl">
        <div class="login-brand-panel">
          <div class="login-brand-glow"></div>
          <div class="login-logo-wrap"><img class="login-logo-image" src="${brandLogoUrl}" alt="الراشد للأنظمة" /></div>
          <div class="login-brand-copy">الراشد للأنظمة</div>
          <div class="login-brand-tagline">حلول أنظمة احترافية لإدارة أعمالك</div>
          <div class="login-brand-points"><span>⚡ سرعة</span><span>◈ دقة</span><span>✓ اعتمادية</span></div>
        </div>
        <div class="login-body">
          <div class="login-welcome">مرحبًا بعودتك</div>
          <h1 class="login-title">${t('login_title')}</h1>
          <p class="login-subtitle">${t('login_subtitle')}</p>
          <div id="login-error"></div>
          <form id="login-form">
            <div class="field">
              <label>${t('username')}</label>
              <input class="input" type="text" name="username" required autocomplete="username" />
            </div>
            <div class="field">
              <label>${t('password')}</label>
              <input class="input" type="password" name="password" required autocomplete="current-password" />
            </div>
            <button class="btn btn-primary btn-block btn-lg" type="submit" id="login-submit">
              ${t('login_btn')}
            </button>
          </form>
        </div>
        <footer class="login-agency-footer" dir="rtl">
          <img src="${brandLogoUrl}" alt="الراشد للأنظمة" />
          <div><strong>الراشد للأنظمة</strong><span>نظام إدارة متكامل لإدارة المبيعات والمخزون والحسابات</span></div>
          <div class="login-agency-meta"><span>© ${new Date().getFullYear()} جميع الحقوق محفوظة</span></div>
        </footer>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorBox = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.innerHTML = '';
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      errorBox.innerHTML = `<div class="login-error">${t('fill_all_fields')}</div>`;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = t('logging_in');
    try {
      await login(username, password);
      onSuccess();
    } catch (err) {
      errorBox.innerHTML = `<div class="login-error">${t('invalid_credentials')}</div>`;
      submitBtn.disabled = false;
      submitBtn.textContent = t('login_btn');
    }
  });
}

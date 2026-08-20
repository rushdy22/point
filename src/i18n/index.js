import ar from './ar.js';

const dictionaries = { ar };
const rtlLocales = new Set(['ar']);

let currentLocale = 'ar';

export function setLocale(locale) {
  if (!dictionaries[locale]) return;
  currentLocale = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

export function getLocale() {
  return currentLocale;
}

export function isRTL() {
  return rtlLocales.has(currentLocale);
}

export function t(key) {
  const dict = dictionaries[currentLocale] || dictionaries.ar;
  return dict[key] ?? key;
}

// initialize default direction immediately on import
setLocale(currentLocale);

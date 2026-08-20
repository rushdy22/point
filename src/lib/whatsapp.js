export function fillWhatsAppTemplate(template, values = {}) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] == null ? '' : String(values[key]));
}

export function normalizeWhatsAppMessage(message, footer = '') {
  const body = String(message || '').trim();
  const end = String(footer || '').trim();
  return end ? `${body}\n\n${end}` : body;
}

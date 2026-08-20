// Paper-size → characters-per-line mapping for thermal (ESC/POS) printers.
// Mirrors electron/printing/paperSize.js exactly — kept as a small, separate
// renderer-side copy (rather than requiring the electron/ file directly)
// since the renderer bundle can't `require()` a CommonJS main-process module,
// and this table is tiny enough that duplicating it is simpler than adding
// an IPC round-trip just to read it.
export const PAPER_SIZES = {
  '58mm': { charsPerLine: 32, label: '58mm' },
  '80mm': { charsPerLine: 42, label: '80mm' }
};

export const DEFAULT_PAPER_SIZE = '80mm';

export function charsPerLineFor(paperSize) {
  return (PAPER_SIZES[paperSize] || PAPER_SIZES[DEFAULT_PAPER_SIZE]).charsPerLine;
}

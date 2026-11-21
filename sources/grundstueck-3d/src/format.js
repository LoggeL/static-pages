// Gemeinsame Farben und Zahlformate (de-DE) für 2D, 3D, Liste und Overlay.

export const COLORS = { dist: '#ffd23f', area: '#3ddc97', height: '#ff7ab6', calib: '#7cc4ff' };

const nf = (min, max = min) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max });
export const NF0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
export const NF1 = nf(1);
export const NF2 = nf(2);
export const INT = new Intl.NumberFormat('de-DE');

// Bytes → „5,2“ (MB, eine Nachkommastelle)
export const MB = (bytes) => NF1.format(bytes / 1e6);

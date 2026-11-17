import qrcode from './qrcode-core.mjs';
import { stringToBytes as utf8StringToBytes } from './qrcode_UTF8.mjs';

qrcode.stringToBytes = utf8StringToBytes;

/**
 * Render a UTF-8 string into an accessible, crisp high-contrast SVG QR code.
 * Uses a single merged SVG path with a 4-module quiet zone for sharp projector display.
 */
export function renderQrSvg(text, cellSize = 6) {
  const value = String(text || '').trim();
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const margin = 4;
  const totalModules = count + margin * 2;
  const pixelSize = totalModules * cellSize;
  const pathParts = [];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        const x = col + margin;
        const y = row + margin;
        pathParts.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" ` +
    `width="${pixelSize}" height="${pixelSize}" role="img" aria-label="QR-Code" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${totalModules}" height="${totalModules}" fill="#ffffff"/>` +
    `<path d="${pathParts.join('')}" fill="#09090b"/>` +
    `</svg>`
  );
}

export default qrcode;

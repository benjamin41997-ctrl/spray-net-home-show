import encoder from './vendor/qrcode.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const QUIET_ZONE = 4;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Validate without fetching or reporting the supplied URL in an error. */
function qrUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Choose a valid page link for this QR code.');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Choose an absolute page link for this QR code.'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))))
    throw new TypeError('QR codes require HTTPS. Loopback HTTP is available only for local development.');
  return url.href;
}

/** Pure encoding helper; the returned modules contain the complete link, including
 * its access fragment. Callers must keep private access matrices/links private.
 * No network service, logging, browser storage, or image-export request is used.
 */
export function createQrMatrix(value) {
  const result = encoder.create([{ data: qrUrl(value), mode: 'byte' }], { errorCorrectionLevel: 'M' });
  return { size: result.modules.size, version: result.version, modules: new Uint8Array(result.modules.data) };
}

/** Render a local SVG QR code with a four-module quiet zone. The label describes
 * its purpose, not its URL or token. Anyone scanning a private access QR receives
 * the same bearer access as the private link; clear it between kiosk visitors.
 */
export function renderQr(container, value, { label = 'Scan this QR code with your phone camera' } = {}) {
  if (!container || typeof container.replaceChildren !== 'function' || !container.ownerDocument?.createElementNS)
    throw new TypeError('Choose a page container for this QR code.');
  const { size, modules } = createQrMatrix(value);
  const document = container.ownerDocument;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const dimension = size + QUIET_ZONE * 2;
  svg.setAttribute('viewBox', `0 0 ${dimension} ${dimension}`);
  svg.setAttribute('width', '320'); svg.setAttribute('height', '320');
  svg.setAttribute('role', 'img'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-label', typeof label === 'string' && label.trim() ? label.trim().slice(0, 180) : 'Scan this QR code');
  svg.setAttribute('class', 'local-qr'); svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(dimension)); background.setAttribute('height', String(dimension));
  background.setAttribute('fill', '#ffffff');
  const dark = document.createElementNS(SVG_NS, 'path');
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size;) {
      if (!modules[y * size + x]) { x++; continue; }
      const start = x;
      while (x < size && modules[y * size + x]) x++;
      const length = x - start;
      path += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${length}v1h-${length}z`;
    }
  }
  dark.setAttribute('d', path); dark.setAttribute('fill', '#000000');
  svg.append(background, dark); container.replaceChildren(svg);
  return svg;
}

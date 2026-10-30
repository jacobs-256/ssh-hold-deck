import os from 'node:os';

export function validOrigin(req, requireOrigin = false) {
  try {
    const host = req.headers.host;
    if (!host || /[\s/@\\?#]/.test(host)) return false;
    const url = new URL(`http://${host}`);
    const allowed = new Set(['localhost', '127.0.0.1', '::1', os.hostname().toLowerCase()]);
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const entry of addresses || []) allowed.add(entry.address.toLowerCase());
    }
    if (!allowed.has(url.hostname.replace(/^\[|\]$/g, '').toLowerCase())) return false;
    if (req.socket?.localPort && Number(url.port || 80) !== req.socket.localPort) return false;
    const origin = req.headers.origin;
    return origin ? origin === url.origin : !requireOrigin;
  } catch { return false; }
}

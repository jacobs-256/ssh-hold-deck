import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { validOrigin } from '../../src/request-origin.js';

test('accept local interfaces with matching origin; reject foreign hosts, origins and ports', () => {
  const addresses = ['127.0.0.1', 'localhost', '[::1]', os.hostname(), ...Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(entry => entry.family === 'IPv4').map(entry => entry.address)];
  for (const address of addresses) {
    const host = `${address}:8787`;
    const req = { headers: { host, origin: `http://${host}` }, socket: { localPort: 8787 } };
    assert.equal(validOrigin(req, true), true, address);
    assert.equal(validOrigin({ ...req, headers: { host, origin: 'http://attacker.example' } }), false);
    assert.equal(validOrigin({ ...req, headers: { host } }, true), false);
    assert.equal(validOrigin({ ...req, headers: { host } }), true);
    assert.equal(validOrigin({ ...req, socket: { localPort: 9999 } }), false);
  }
  for (const host of ['attacker.example:8787', '127.0.0.1.attacker.example:8787', 'attacker@127.0.0.1:8787', '127.0.0.1:8787/path']) assert.equal(validOrigin({ headers: { host } }), false);
});

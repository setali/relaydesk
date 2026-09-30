import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { managedDomain, inspectCertificate, certificateStatus } from '../src/https-status.js';

test('managed HTTPS accepts only a DNS origin on standard HTTPS port', () => {
  assert.equal(managedDomain('https://relay.example.com'), 'relay.example.com');
  for (const value of [
    'http://relay.example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://local',
    'https://x.local',
    'https://x.test',
    'https://x.ts.net',
    'https://a.example.com:8443',
    'https://a.example.com/path',
    'https://user@a.example.com',
    'https://a.example.com?q=1',
    'https://a..example.com',
    'https://-a.example.com',
    'https://a.example.com/#x',
  ]) {
    assert.throws(() => managedDomain(value), undefined, value);
  }
});
test('certificate probe enforces TLS trust and exposes only public certificate metadata', async () => {
  let options,
    destroyed = false;
  const result = await inspectCertificate('https://relay.example.com', (input) => {
    options = input;
    const socket = new EventEmitter();
    socket.authorized = true;
    socket.destroy = () => {
      destroyed = true;
    };
    socket.getPeerCertificate = () => ({
      valid_to: 'Jan 1 2030 00:00:00 GMT',
      issuer: { O: 'Test issuer' },
      raw: 'not returned',
    });
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket;
  });
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.servername, 'relay.example.com');
  assert.equal(result.status, 'valid');
  assert.equal(result.issuer, 'Test issuer');
  assert.equal(result.raw, undefined);
  assert.equal(destroyed, true);
});
test('certificate probe fails closed and demo/cache avoid repeated connections', async () => {
  const failed = await inspectCertificate('https://relay.example.com', () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    queueMicrotask(() => socket.emit('error', new Error('sensitive internal detail')));
    return socket;
  });
  assert.equal(failed.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /sensitive/);
  let calls = 0;
  const inspect = async () => {
    calls++;
    return { status: 'valid' };
  };
  const status = certificateStatus('https://relay.example.com', false, inspect);
  await Promise.all([status(), status(), status()]);
  await status();
  assert.equal(calls, 1);
  assert.equal((await certificateStatus('http://127.0.0.1', true, inspect)()).status, 'demo');
  assert.equal(calls, 1);
});

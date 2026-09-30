import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPublicIPv4 } from '../src/public-ip.js';
import { runSetup } from '../src/setup.js';

test('public IP discovery validates bounded HTTPS responses and fails safely', async () => {
  let options;
  assert.equal(
    await detectPublicIPv4(async (url, config) => {
      assert.equal(url, 'https://api.ipify.org');
      options = config;
      return new Response('8.8.8.8\n');
    }),
    '8.8.8.8',
  );
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal);
  for (const body of [
    '10.0.0.1',
    '127.0.0.1',
    '::1',
    '203.0.113.1',
    '<html>error</html>',
    'x'.repeat(65),
  ])
    assert.equal(await detectPublicIPv4(async () => new Response(body)), '');
  assert.equal(await detectPublicIPv4(async () => new Response('8.8.8.8', { status: 503 })), '');
  assert.equal(
    await detectPublicIPv4(async () => {
      throw new Error('timeout');
    }),
    '',
  );
});

test('Enter selects detected IPv4; manual address overrides; detection failure requires input', async (t) => {
  for (const [detected, input, expected] of [
    ['8.8.8.8', [''], 'https://8.8.8.8'],
    ['8.8.8.8', ['relay.example.com'], 'https://relay.example.com'],
    ['', ['', 'relay.example.com'], 'https://relay.example.com'],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'relaydesk-default-ip-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const prompts = [],
      answers = [...input, 'operator', '', '', 'n'];
    const file = join(dir, 'runtime.json');
    await runSetup({
      runtimeFile: file,
      detectAddress: async () => detected,
      print: () => {},
      ask: async (question) => {
        prompts.push(question);
        return answers.shift();
      },
    });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).origin, expected);
    assert.equal(prompts[0].includes('[8.8.8.8]'), !!detected);
  }
});

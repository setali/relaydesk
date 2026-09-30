import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function run(t, mode, extra = '') {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-https-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync('https.sh', join(directory, 'https.sh'));
  writeFileSync(join(directory, '.install.env'), 'RELAYDESK_HTTP_PORT=3210\n');
  const script = `
source "$FIXTURE/https.sh"
https_terminal() { :; }
ss() { if [[ "$MODE" == host-busy ]]; then echo LISTEN; fi; }
getent() { if [[ "$MODE" == dns-failed || "$MODE" == ip ]]; then return 1; fi; echo '203.0.113.1 relay.example.com'; }
docker() {
  printf '%s\\n' "$*" >> "$FIXTURE/calls"
  case "$*" in
    'ps --format'*) if [[ "$MODE" == docker-busy ]]; then echo '0.0.0.0:443->443/tcp'; fi ;;
    'ps -aq'*) if [[ "$MODE" == project-exists ]]; then echo old; fi ;;
    'volume ls'*) if [[ "$MODE" == volume-exists ]]; then echo old; fi ;;
    *'https-cli.js domain') if [[ "$MODE" == ip ]]; then echo 8.8.8.8; else echo relay.example.com; fi ;;
  esac
}
${extra}
https_main enable
`;
  const result = spawnSync('bash', ['-c', script], {
    input: mode === 'decline' ? 'n\n' : 'y\n',
    encoding: 'utf8',
    env: { ...process.env, FIXTURE: directory, MODE: mode },
    timeout: 5000,
  });
  return {
    directory,
    result,
    calls: existsSync(join(directory, 'calls'))
      ? readFileSync(join(directory, 'calls'), 'utf8')
      : '',
  };
}
test('HTTPS setup refuses host/Docker port conflicts, existing gateway and missing DNS', (t) => {
  for (const mode of [
    'host-busy',
    'docker-busy',
    'project-exists',
    'volume-exists',
    'dns-failed',
  ]) {
    const { directory, result, calls } = run(t, mode);
    assert.notEqual(result.status, 0, mode);
    assert.equal(existsSync(join(directory, '.https.env')), false);
    assert.doesNotMatch(calls, / up -d| stop| restart| down/);
  }
});
test('HTTPS setup requires consent, then validates before starting dedicated gateway', (t) => {
  const decline = run(t, 'decline');
  assert.equal(decline.result.status, 0);
  assert.equal(existsSync(join(decline.directory, '.https.env')), false);
  const success = run(t, 'ok');
  assert.equal(success.result.status, 0, success.result.stderr);
  assert.equal(
    readFileSync(join(success.directory, '.https.env'), 'utf8'),
    'RELAYDESK_DOMAIN=relay.example.com\nRELAYDESK_CADDYFILE=Caddyfile\n',
  );
  assert.ok(success.calls.indexOf('caddy validate') < success.calls.indexOf(' up -d'));
  assert.doesNotMatch(success.calls, / stop| restart| down/);
  assert.match(success.result.stdout, /issuance may still be pending/);
});
test('public IPv4 selects short-lived ACME configuration without DNS', (t) => {
  const output = run(t, 'ip');
  assert.equal(output.result.status, 0, output.result.stderr);
  assert.match(
    readFileSync(join(output.directory, '.https.env'), 'utf8'),
    /RELAYDESK_CADDYFILE=Caddyfile.ip/,
  );
});

test('HTTPS setup preserves an existing configuration', (t) => {
  const output = run(
    t,
    'ok',
    'printf "RELAYDESK_DOMAIN=old.example.com\\n" > "$FIXTURE/.https.env"',
  );
  assert.notEqual(output.result.status, 0);
  assert.equal(
    readFileSync(join(output.directory, '.https.env'), 'utf8'),
    'RELAYDESK_DOMAIN=old.example.com\n',
  );
  assert.equal(output.calls, '');
});

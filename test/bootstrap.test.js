import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const bootstrap = resolve('bootstrap.sh');
test('install confirmation accepts its explicit default but cancellation, invalid input and EOF fail closed', () => {
  for (const [input, defaultAnswer, expected] of [
    ['\n', 'y', 0],
    ['n\n', 'y', 1],
    ['invalid\n', 'y', 1],
    ['', 'y', 1],
    ['\n', 'n', 1],
    ['Y\n', 'n', 0],
  ]) {
    const result = spawnSync('bash', ['-c', 'source "$BOOTSTRAP"; confirm Install "$DEFAULT"'], {
      input,
      encoding: 'utf8',
      env: { ...process.env, BOOTSTRAP: bootstrap, DEFAULT: defaultAnswer },
    });
    assert.equal(result.status, expected);
  }
});
function shell(code, env = {}) {
  return spawnSync('bash', ['-c', 'source "$BOOTSTRAP"\n' + code], {
    encoding: 'utf8',
    env: { ...process.env, BOOTSTRAP: bootstrap, ...env },
    timeout: 10000,
  });
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-bootstrap-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('bootstrap parses and help needs no root, terminal, Docker or network', () => {
  assert.equal(spawnSync('bash', ['-n', bootstrap]).status, 0);
  const result = spawnSync('bash', [bootstrap, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /first-time installer/);
  const streamed = spawnSync('bash', ['-s', '--', '--help'], {
    input: readFileSync(bootstrap),
    encoding: 'utf8',
  });
  assert.equal(streamed.status, 0);
  assert.match(streamed.stdout, /first-time installer/);
});
test('bootstrap verifies the complete source checksum and rejects corruption', (t) => {
  const path = join(fixture(t), 'archive');
  writeFileSync(path, 'sample archive');
  const hash = createHash('sha256').update('sample archive').digest('hex');
  assert.equal(
    shell('RELAYDESK_SHA256="$HASH"; verify_archive "$ARCHIVE"', {
      HASH: hash,
      ARCHIVE: path,
    }).status,
    0,
  );
  const result = shell('verify_archive "$ARCHIVE"', { ARCHIVE: path });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
});
test('bootstrap refuses existing paths and dangling symlinks without changing them', (t) => {
  const directory = fixture(t);
  const marker = join(directory, 'keep');
  writeFileSync(marker, 'unchanged');
  assert.notEqual(
    shell('RELAYDESK_DIRECTORY="$DEST"; check_destination', { DEST: directory }).status,
    0,
  );
  const link = join(directory, 'link');
  symlinkSync(join(directory, 'missing'), link);
  assert.notEqual(
    shell('RELAYDESK_DIRECTORY="$DEST"; check_destination', { DEST: link }).status,
    0,
  );
  assert.equal(readFileSync(marker, 'utf8'), 'unchanged');
});
test('bootstrap refuses unhealthy Docker, old Compose, existing projects and volumes', () => {
  const variants = [
    'docker() { return 1; }',
    'docker() { [[ "$*" != "compose version" ]]; }',
    'docker() { if [[ "$*" == "compose up --help" ]]; then echo old; fi; }',
    'docker() { case "$1" in compose) echo --wait-timeout;; ps) echo container;; esac; }',
    'docker() { case "$1" in compose) echo --wait-timeout;; volume) echo relaydesk_relaydesk-data;; esac; }',
    'docker() { case "$1" in compose) echo --wait-timeout;; ps) return 1;; esac; }',
    'docker() { case "$1" in compose) echo --wait-timeout;; volume) return 1;; esac; }',
  ];
  for (const mock of variants) assert.notEqual(shell(mock + '\ncheck_docker').status, 0);
  assert.equal(
    shell(
      'docker() { if [[ "$*" == "compose up --help" ]]; then echo --wait-timeout; fi; }\ncheck_docker',
    ).status,
    0,
  );
});
test('resume only accepts an inspected empty volume', () => {
  const mock = `resume_install=true
docker() { case "$1" in compose) echo --wait-timeout;; volume) echo relaydesk_relaydesk-data;; run) return "$RESULT";; esac; }
check_docker`;
  assert.equal(shell(mock, { RESULT: '0' }).status, 0);
  assert.notEqual(shell(mock, { RESULT: '1' }).status, 0);
});

test('bootstrap cancellation does not download or install', () => {
  const result = shell(
    'require_terminal() { :; }; check_destination() { :; }; confirm() { return 1; }; download() { echo SHOULD_NOT_RUN; }; main',
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
});
test('download failure and checksum mismatch stop before system changes', (t) => {
  const directory = fixture(t);
  for (const download of ['download() { return 42; }', 'download() { printf corrupted > "$2"; }']) {
    const dest = join(directory, 'not-created');
    const result = shell(
      `
require_terminal() { :; }; confirm() { return 0; }
RELAYDESK_DIRECTORY="$DEST"
check_docker() { echo SHOULD_NOT_RUN; }
install_docker() { echo SHOULD_NOT_RUN; }
${download}
main
`,
      { DEST: dest },
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
    assert.equal(existsSync(dest), false);
  }
});
test('verified bootstrap hands off to the wizard and retains source on wizard failure', (t) => {
  const directory = fixture(t),
    source = join(directory, 'source');
  mkdirSync(source);
  writeFileSync(
    join(source, 'install.sh'),
    'printf wizard-ran > "$MARKER"\nexit "${WIZARD_STATUS:-0}"\n',
  );
  writeFileSync(join(source, 'compose.install.yaml'), 'services: {}\n');
  const archive = join(directory, 'source.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', directory, 'source']).status, 0);
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
  // macOS tar lacks these Linux flags; strip them only in this test wrapper.
  const mocks = `
require_terminal() { :; }
confirm() { return 0; }
docker() { if [[ "$*" == "compose up --help" ]]; then echo --wait-timeout; fi; }
download() { cp "$ARCHIVE" "$2"; }
install_docker() { echo SHOULD_NOT_INSTALL_DOCKER; exit 1; }
tar() { local args=() arg; for arg in "$@"; do case "$arg" in --no-same-owner|--no-same-permissions) ;; *) args+=("$arg");; esac; done; command tar "\${args[@]}"; }
RELAYDESK_DIRECTORY="$DEST"
RELAYDESK_SHA256="$HASH"
main
`;
  for (const status of [0, 7]) {
    const dest = join(directory, 'install-' + status),
      marker = join(directory, 'marker-' + status);
    const result = shell(mocks, {
      ARCHIVE: archive,
      HASH: hash,
      DEST: dest,
      MARKER: marker,
      WIZARD_STATUS: String(status),
    });
    assert.equal(result.status, status, result.stderr);
    assert.equal(readFileSync(marker, 'utf8'), 'wizard-ran');
    assert.ok(existsSync(join(dest, 'install.sh')));
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_INSTALL_DOCKER/);
  }
});

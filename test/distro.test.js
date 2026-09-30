import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function probe(t, distro, codename, architecture, download) {
  const workdir = mkdtempSync(join(tmpdir(), 'relaydesk-distro-test-'));
  t.after(() => rmSync(workdir, { recursive: true, force: true }));
  return spawnSync(
    'bash',
    [
      '-c',
      `source "$BOOTSTRAP"\nworkdir="$TEST_DIR"\n${download}\ndocker_repository "$DISTRO" "$CODENAME" "$ARCH"`,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        BOOTSTRAP: resolve('bootstrap.sh'),
        TEST_DIR: workdir,
        DISTRO: distro,
        CODENAME: codename,
        ARCH: architecture,
      },
    },
  );
}
const available = `download() { echo "$1"; printf 'Package: %s\\n' docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin | gzip > "$2"; }`;
test('Ubuntu and Debian use their exact codename and architecture, including Resolute', (t) => {
  for (const [distro, codename, arch] of [
    ['ubuntu', 'resolute', 'amd64'],
    ['ubuntu', 'noble', 'arm64'],
    ['debian', 'bookworm', 'amd64'],
    ['debian', 'trixie', 'arm64'],
  ]) {
    const result = probe(t, distro, codename, arch, available);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(`linux/${distro}/dists/${codename}/stable/binary-${arch}/Packages.gz`),
    );
  }
});
test('unsupported distributions, unknown codenames and incomplete repositories fail closed', (t) => {
  for (const [distro, codename, arch, download] of [
    ['mint', 'noble', 'amd64', available],
    ['ubuntu', '', 'amd64', available],
    ['ubuntu', '../../noble', 'amd64', available],
    ['debian', 'trixie', 'armhf', available],
    ['ubuntu', 'future', 'amd64', 'download() { return 22; }'],
    ['ubuntu', 'resolute', 'amd64', 'download() { printf garbage > "$2"; }'],
    ['ubuntu', 'resolute', 'amd64', `download() { printf 'Package: docker-ce\\n' | gzip > "$2"; }`],
  ])
    assert.notEqual(probe(t, distro, codename, arch, download).status, 0);
});

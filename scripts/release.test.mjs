import { expect, it } from 'vitest';
import { candidateFor, parseTag, pickInstallers, resolveSource } from './release.mjs';

it('a release-candidate tag is a pre-release of the package version', () => {
  expect(parseTag('v0.1.0-rc.1', '0.1.0')).toEqual({ version: '0.1.0', prerelease: true });
  expect(parseTag('v0.1.0', '0.1.0')).toEqual({ version: '0.1.0', prerelease: false });
});

it('a tag that disagrees with package.json fails', () => {
  expect(() => parseTag('v0.2.0', '0.1.0')).toThrow(/0\.2\.0.*0\.1\.0/);
});

it('a tag that is not v<version> or v<version>-rc.<n> fails', () => {
  expect(() => parseTag('v0.1.0-beta', '0.1.0')).toThrow();
  expect(() => parseTag('0.1.0', '0.1.0')).toThrow();
});

it('only the three installers are released', () => {
  expect(
    pickInstallers([
      'Aji_0.1.0_x64-setup.exe',
      'Aji_0.1.0_aarch64.dmg',
      'Aji_0.1.0_amd64.AppImage',
      'bundle_dmg.sh',
      'Aji.app',
      'Aji_0.1.0_amd64.AppImage.tar.gz',
    ]),
  ).toEqual(['Aji_0.1.0_aarch64.dmg', 'Aji_0.1.0_amd64.AppImage', 'Aji_0.1.0_x64-setup.exe']);
});

it('a missing installer fails', () => {
  expect(() => pickInstallers(['Aji_0.1.0_x64-setup.exe', 'Aji_0.1.0_amd64.AppImage'])).toThrow(
    /dmg/,
  );
});

it('the newest release candidate on the commit is chosen', () => {
  const releases = [
    { tagName: 'v0.1.0-rc.1', sha: 'abc' },
    { tagName: 'v0.1.0-rc.2', sha: 'abc' },
    { tagName: 'v0.1.0-rc.3', sha: 'def' },
  ];
  expect(candidateFor('abc', releases)).toBe('v0.1.0-rc.2');
  expect(candidateFor('fff', releases)).toBeNull();
});

it('a release copies the walked candidate, and fails without one', () => {
  expect(() =>
    resolveSource({
      tag: 'v0.1.0',
      prerelease: false,
      sha: 'abc',
      releases: [{ tagName: 'v0.1.0-rc.3', sha: 'def' }],
    }),
  ).toThrow(/no release candidate on this commit/);
  expect(
    resolveSource({
      tag: 'v0.1.0',
      prerelease: false,
      sha: 'abc',
      releases: [{ tagName: 'v0.1.0-rc.1', sha: 'abc' }],
    }),
  ).toEqual({ kind: 'copy', from: 'v0.1.0-rc.1' });
  expect(resolveSource({ tag: 'v0.1.0-rc.4', prerelease: true, sha: 'abc', releases: [] })).toEqual(
    { kind: 'build' },
  );
});

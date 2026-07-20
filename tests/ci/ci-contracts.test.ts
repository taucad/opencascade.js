import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { branchSlug, deriveRelease } from '../../scripts/ci-release.mjs';
import { DIST_FILES, PACKAGE_FILES, validateExactFiles } from '../../scripts/package-candidate.mjs';
import { selectVersions } from '../../scripts/ghcr-retention.mjs';

const SHA = 'd5736f09aabbccddeeff00112233445566778899';
const EPOCH = 1_778_112_000; // 2026-05-07T00:00:00Z
const ROOT = path.resolve(import.meta.dirname, '../..');
const workflow = (name: string) => parse(
  fs.readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8'),
);

describe('CI contracts', () => {
  it('should derive immutable branch versions and channel ownership', () => {
    const feature = deriveRelease({
      event: 'push',
      ref: 'refs/heads/feature/npm',
      refName: 'feature/npm',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.3',
    });
    expect(feature).toMatchObject({
      version: '3.0.0-beta-d5736f09-20260507',
      channel: 'canary',
      branchSlug: 'feature-npm',
      publish: true,
    });
    expect(deriveRelease({
      event: 'push',
      ref: 'refs/heads/master',
      refName: 'master',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.3',
    }).channel).toBe('beta');
    expect(deriveRelease({
      event: 'pull_request',
      ref: 'refs/pull/1/merge',
      refName: '1/merge',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.3',
    }).publish).toBe(false);
    expect(branchSlug('feature/'.concat('very-long-segment-'.repeat(8)))).toHaveLength(64);
  });

  it('should require annotated release tags and exact package versions', () => {
    expect(deriveRelease({
      event: 'push',
      ref: 'refs/tags/v3.0.0-rc.1',
      refName: 'v3.0.0-rc.1',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-rc.1',
      tagObjectType: 'tag',
    })).toMatchObject({ version: '3.0.0-rc.1', channel: 'rc', publish: true });
    expect(() => deriveRelease({
      event: 'push',
      ref: 'refs/tags/v3.0.0',
      refName: 'v3.0.0',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0',
      tagObjectType: 'commit',
    })).toThrow('must be annotated');
  });

  it('should keep the package allowlists exact', () => {
    expect(DIST_FILES).toHaveLength(12);
    expect(PACKAGE_FILES).toHaveLength(18);
    expect(() => validateExactFiles([...DIST_FILES, 'stale.wasm'], DIST_FILES, 'dist'))
      .toThrow('extra=[stale.wasm]');
  });

  it('should keep specialized test surfaces independently runnable', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(manifest.scripts['test:regression']).toContain('vitest.regression.config.ts');
    expect(manifest.scripts['test:docker']).toContain('vitest.docker.config.ts');
    expect(manifest.scripts['test:package']).toContain('vitest.package.config.ts');
  });

  it('should make provisioned Replicad compatibility a mandatory candidate gate', () => {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    const replicadTest = fs.readFileSync(
      path.join(ROOT, 'tests/sentinel/test_replicad_native_validation.py'),
      'utf8',
    );
    expect(source).toContain('build-configs/replicad-validation.yml');
    expect(source).toContain('.venv/bin/pytest tests/integration tests/sentinel');
    expect(replicadTest).not.toContain('pytest.skip');
  });

  it('should select only expired, unprotected GHCR versions', () => {
    const now = Date.parse('2026-07-21T00:00:00Z');
    const version = (id: number, created_at: string, tags: string[], name = `sha256:${id}`) => ({
      id, name, created_at, metadata: { container: { tags } },
    });
    const branch = Array.from({ length: 7 }, (_, index) =>
      version(index + 1, `2026-07-${String(19 - index).padStart(2, '0')}T00:00:00Z`, ['branch-feature-x']),
    );
    const selected = selectVersions([
      ...branch,
      version(20, '2026-01-01T00:00:00Z', ['3.0.0-single-threaded']),
      version(21, '2026-01-01T00:00:00Z', ['sha256-deadbeef.sig']),
      version(22, '2026-01-01T00:00:00Z', [], 'sha256:orphan'),
      version(23, '2026-01-01T00:00:00Z', [], 'sha256:referenced'),
      version(24, '2026-01-01T00:00:00Z', ['branch-feature-x', 'buildcache-amd64-final-single']),
      version(25, '2026-01-01T00:00:00Z', ['sha256-deadbeef.att']),
      version(26, '2026-01-01T00:00:00Z', ['buildcache-amd64-final-single']),
      version(27, '2026-01-02T00:00:00Z', ['buildcache-amd64-final-single']),
    ], { now, referencedDigests: new Set(['sha256:referenced']) });
    expect(selected.map(({ id }) => id)).toEqual([7, 22, 26]);
  });

  it('should run every branch and PR while preserving every push publication', () => {
    const ci = workflow('docker.yml');
    expect(ci.on.push.branches).toEqual(['**']);
    expect(ci.on).toHaveProperty('pull_request', null);
    expect(ci.concurrency['cancel-in-progress']).toContain("github.event_name == 'pull_request'");
    expect(ci.jobs['npm-publish'].concurrency).toMatchObject({
      queue: 'max',
      'cancel-in-progress': false,
    });
  });

  it('should keep every ESLint relative import in clean checkouts', () => {
    for (const relative of [
      'tools/eslint-plugin/index.js',
      'tools/eslint-plugin/require-using-on-disposable.js',
    ]) {
      expect(fs.existsSync(path.join(ROOT, relative)), relative).toBe(true);
      const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', relative], {
        cwd: ROOT,
      });
      expect(ignored.status, `${relative} must not be ignored`).toBe(1);
    }
  });

  it('should expand push candidates to six complete native rows and validation to three amd64 rows', () => {
    const ci = workflow('docker.yml');
    const build = ci.jobs['candidate-build'];
    const validation = ci.jobs['candidate-validation'];

    expect(build.strategy.matrix).toEqual({
      stage: ['final-single', 'final-multi', 'bindgen-base'],
      arch: ['amd64', 'arm64'],
    });
    expect(validation.strategy.matrix).toEqual({
      stage: ['final-single', 'final-multi', 'bindgen-base'],
    });

    const rows = build.strategy.matrix.stage.flatMap((stage: string) =>
      build.strategy.matrix.arch.map((arch: string) => ({ stage, arch })),
    );
    expect(rows).toEqual([
      { stage: 'final-single', arch: 'amd64' },
      { stage: 'final-single', arch: 'arm64' },
      { stage: 'final-multi', arch: 'amd64' },
      { stage: 'final-multi', arch: 'arm64' },
      { stage: 'bindgen-base', arch: 'amd64' },
      { stage: 'bindgen-base', arch: 'arm64' },
    ]);
    expect(build['runs-on']).toContain("matrix.arch == 'arm64'");
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).toContain("matrix.arch == 'arm64' && 'linux/arm64' || 'linux/amd64'");
    expect(source).toContain("matrix.stage == 'final-multi' && 'build-configs/full_multi.yml'");
    expect(source).not.toContain('matrix.runner');
    expect(source).not.toContain('matrix.platform');
    expect(source).not.toContain('matrix.config');
  });

  it('should promote exactly one tested digest per native architecture', () => {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).toContain('digest-${STAGE}-${arch}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}');
    expect(source).toContain('for arch in amd64 arm64');
    expect(source).toContain('test "${#files[@]}" -eq 1');
    expect(source).toContain('test "$platforms" = "linux/amd64,linux/arm64"');
  });

  it('should keep mutation behind the package gate and npm OIDC away from checkout', () => {
    const ci = workflow('docker.yml');
    expect(ci.jobs.quality.needs).toBe('preflight');
    expect(ci.jobs['candidate-build'].needs).toBe('preflight');
    expect(ci.jobs['package-assemble'].needs).toEqual(['preflight', 'quality', 'candidate-gate']);
    expect(ci.jobs['ghcr-promote'].needs).toContain('package-gate');
    expect(ci.jobs['npm-publish'].needs).toContain('package-gate');
    expect(ci.jobs['npm-publish'].permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(ci.jobs['npm-publish'].steps.some(({ uses }: { uses?: string }) =>
      uses?.startsWith('actions/checkout@'),
    )).toBe(false);
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).not.toContain('NPM_TOKEN');
    expect(source).not.toContain('NODE_AUTH_TOKEN');
    expect(source).not.toContain('OCJS_CONFIG=debug');
  });

  it('should pin every workflow action to a full commit', () => {
    for (const name of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
      if (!name.endsWith('.yml')) continue;
      const jobs = Object.values(workflow(name).jobs ?? {}) as Array<{ steps?: Array<{ uses?: string }> }>;
      for (const { steps = [] } of jobs) {
        for (const { uses } of steps) {
          if (!uses) continue;
          const revision = uses.split('@').at(-1) ?? '';
          expect(revision, `${name}: ${uses}`).toHaveLength(40);
          expect([...revision].every((character) => '0123456789abcdef'.includes(character))).toBe(true);
        }
      }
    }
  });

  it('should keep obsolete automation deleted and active compatibility fixtures', () => {
    for (const relative of [
      '.github/workflows/buildFull.yml',
      '.github/workflows/firebase-hosting-pull-request.yml',
      '.github/workflows/general.yml',
      '.github/workflows/startGcpInstance.yml',
      '.github/workflows/tests.yml',
      '.github/workflows/updateReferenceDocs.yml',
      '.github/workflows/updateStarterTemplates.yml',
      'builds/opencascade.full.yml',
      'runAction.sh',
      'test',
      'typedoc-reference-docs',
    ]) {
      expect(fs.existsSync(path.join(ROOT, relative)), relative).toBe(false);
    }
    expect(fs.existsSync(path.join(ROOT, 'starter-templates/legacy'))).toBe(true);
  });
});

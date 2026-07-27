import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { branchSlug, deriveRelease } from '../../scripts/ci-release.mjs';
import { validateRequestedVersion } from '../../scripts/prepare-release.mjs';
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
      packageVersion: '3.0.0-beta.0',
    });
    expect(feature).toMatchObject({
      version: '3.0.0-canary.d5736f09',
      channel: 'canary',
      branchSlug: 'feature-npm',
      npmPublish: true,
      ghcrPromote: true,
    });
    expect(deriveRelease({
      event: 'push',
      ref: 'refs/heads/main',
      refName: 'main',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.0',
      commitSubject: 'feat(bindings): add symbols',
    })).toMatchObject({ kind: 'main', channel: 'none', npmPublish: false, ghcrPromote: true });
    expect(deriveRelease({
      event: 'pull_request',
      ref: 'refs/pull/1/merge',
      refName: '1/merge',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.0',
    }).npmPublish).toBe(false);
    expect(branchSlug('feature/'.concat('very-long-segment-'.repeat(8)))).toHaveLength(64);
  });

  it('should classify only exact release-PR merges as beta or stable publications', () => {
    const stableReleaseFiles = [
      '.nx/version-plans/feature.md',
      'CHANGELOG.md',
      'package-lock.json',
      'package.json',
    ];
    expect(deriveRelease({
      event: 'push',
      ref: 'refs/heads/main',
      refName: 'main',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-beta.1',
      commitSubject: 'chore(release): ocjs v3.0.0-beta.1',
      changedFiles: stableReleaseFiles,
    })).toMatchObject({
      version: '3.0.0-beta.1',
      channel: 'beta',
      npmPublish: true,
      isRelease: true,
      prerelease: true,
      releaseTag: 'v3.0.0-beta.1',
    });
    expect(deriveRelease({
      event: 'push',
      ref: 'refs/heads/main',
      refName: 'main',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0',
      commitSubject: 'chore(release): ocjs v3.0.0',
      changedFiles: stableReleaseFiles,
    })).toMatchObject({ channel: 'latest', kind: 'stable-release', prerelease: false });
    expect(() => deriveRelease({
      event: 'push',
      ref: 'refs/heads/main',
      refName: 'main',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0-rc.1',
      commitSubject: 'chore(release): ocjs v3.0.0-rc.1',
      changedFiles: stableReleaseFiles,
    })).toThrow('unsupported release prerelease');
    expect(() => deriveRelease({
      event: 'push',
      ref: 'refs/heads/main',
      refName: 'main',
      sha: SHA,
      commitEpoch: EPOCH,
      packageVersion: '3.0.0',
      commitSubject: 'chore(release): ocjs v3.0.0',
      changedFiles: [...stableReleaseFiles, 'src/late-change.ts'],
    })).toThrow('unexpected files');
  });

  it('should validate explicit beta and stable versions against Version Plans', () => {
    expect(validateRequestedVersion({
      currentVersion: '3.0.0-beta.0',
      plannedStableVersion: '3.0.0',
      requestedVersion: '3.0.0-beta.1',
    })).toEqual({ channel: 'beta', version: '3.0.0-beta.1' });
    expect(validateRequestedVersion({
      currentVersion: '3.0.0-beta.1',
      plannedStableVersion: '3.0.0',
      requestedVersion: '3.0.0',
    })).toEqual({ channel: 'stable', version: '3.0.0' });
    expect(validateRequestedVersion({
      currentVersion: '3.0.0',
      plannedStableVersion: '3.1.0',
      requestedVersion: '3.1.0-beta.1',
    })).toEqual({ channel: 'beta', version: '3.1.0-beta.1' });
    expect(() => validateRequestedVersion({
      currentVersion: '3.0.0-beta.1',
      plannedStableVersion: '3.1.0',
      requestedVersion: '3.0.0-beta.2',
    })).toThrow('Version Plans resolve');
    expect(() => validateRequestedVersion({
      currentVersion: '3.0.0-beta.1',
      plannedStableVersion: '3.0.0',
      requestedVersion: '3.0.0-beta.3',
    })).toThrow('next beta');
  });

  it('should keep the package allowlists exact', () => {
    expect(DIST_FILES).toHaveLength(13);
    expect(PACKAGE_FILES).toHaveLength(19);
    expect(DIST_FILES).toContain('api-reference.json');
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
    const ci = workflow('docker.yml');
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    const replicadTest = fs.readFileSync(
      path.join(ROOT, 'tests/sentinel/test_replicad_native_validation.py'),
      'utf8',
    );
    const replicadFixture = parse(fs.readFileSync(
      path.join(ROOT, 'build-configs/replicad-validation.yml'),
      'utf8',
    ));
    expect(source).toContain('build-configs/replicad-validation.yml');
    expect(source).toContain('.venv/bin/pytest tests/integration tests/sentinel');
    expect(replicadTest).not.toContain('pytest.skip');
    expect(replicadFixture.mainBuild.emccFlags).toContain('--emit-symbol-map');
    for (const jobName of ['candidate-validation', 'candidate-build']) {
      const step = ci.jobs[jobName].steps.find(
        ({ name }: { name?: string }) => name === 'Python integration and sentinel checks',
      );
      expect(step.run).toContain('rm -rf build/bindings');
      expect(step.run).toContain('npx nx run ocjs:generate --skip-nx-cache');
      expect(step.run).toContain('npx vitest run tests/no-clobber-validation.test.ts');
      expect(step.run).toContain('npx nx run ocjs:bind-symbols --skip-nx-cache');
      expect(step.run).toContain('cp -R /host/scripts /opencascade.js/scripts');
      expect(step.run).toContain('OCJS_OUTPUT_DIR=/opencascade.js/dist');
    }
  });

  it('should generate the API reference without rebuilding tested candidate outputs', () => {
    const ci = workflow('docker.yml');
    for (const jobName of ['candidate-validation', 'candidate-build']) {
      const step = ci.jobs[jobName].steps.find(
        ({ name }: { name?: string }) => name === 'Generate package-owned API reference',
      );
      expect(step.run).toContain(
        'npx nx run ocjs:api-reference --skip-nx-cache --excludeTaskDependencies',
      );
    }
  });

  it('should reuse candidate outputs for multi-threaded runtime assertions', () => {
    const ci = workflow('docker.yml');
    for (const jobName of ['candidate-validation', 'candidate-build']) {
      const step = ci.jobs[jobName].steps.find(
        ({ name }: { name?: string }) => name === 'Docker consumer behavior',
      );
      expect(step.env.OCJS_DOCKER_OUTPUT_DIR).toBe('${{ runner.temp }}/e2e');
    }
  });

  it('should provision pnpm for isolated docs lifecycle scripts', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts/test-candidate-docs.sh'),
      'utf8',
    );
    const provision = source.indexOf('corepack enable --install-directory "$COREPACK_BIN"');
    expect(provision).toBeGreaterThan(-1);
    expect(source.indexOf('pnpm typecheck')).toBeGreaterThan(provision);
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

  it('should fast-forward the upstream PR branch without triggering duplicate CI', () => {
    const mirror = workflow('mirror-upstream-pr-head.yml');
    const step = mirror.jobs.mirror.steps.find(
      ({ name }: { name?: string }) => name === 'Fast-forward upstream PR branch',
    );

    expect(mirror.on.push.branches).toEqual(['main']);
    expect(mirror.permissions).toEqual({ contents: 'write' });
    expect(mirror.jobs.mirror.if).toBe("github.repository == 'taucad/opencascade.js'");
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(step.run).toContain('git/refs/heads/occt-v8-emscripten-5');
    expect(step.run).toContain('-f sha="${GITHUB_SHA}"');
    expect(step.run).toContain('-F force=false');
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
    expect(source).toContain('digest-${STAGE}-${arch}-${GITHUB_RUN_ID}');
    expect(source).toContain('for arch in amd64 arm64');
    expect(source).toContain('test "${#files[@]}" -eq 1');
    expect(source).toContain(
      'select(.annotations["vnd.docker.reference.type"] != "attestation-manifest")',
    );
    expect(source).toContain('test "$platforms" = "linux/amd64,linux/arm64"');
  });

  it('should require every native candidate without comparing host-dependent bytes', () => {
    const ci = workflow('docker.yml');
    const nativeE2e = ci.jobs['candidate-build'].steps.find(
      ({ name }: { name?: string }) => name === 'Candidate e2e',
    );
    expect(ci.jobs['candidate-gate'].needs).toEqual([
      'candidate-validation',
      'candidate-build',
    ]);
    expect(nativeE2e.if).toBeUndefined();
    expect(nativeE2e.run).toBe('scripts/docker-e2e-validate.sh');
    expect(nativeE2e.env.OCJS_DOCKER_PLATFORM).toBe(
      "${{ matrix.arch == 'arm64' && 'linux/arm64' || 'linux/amd64' }}",
    );
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).not.toContain('artifact-parity');
    expect(source).not.toContain('artifact-manifest-');
    expect(source).not.toContain('byte-identical amd64 and arm64');
  });

  it('should use only stage-and-architecture-local Docker caches', () => {
    const ci = workflow('docker.yml');
    const validationStep = ci.jobs['candidate-validation'].steps.find(
      ({ name }: { name?: string }) => name === 'Build candidate for validation',
    );
    const buildSteps = ci.jobs['candidate-build'].steps.filter(
      ({ name }: { name?: string }) => ['Build candidate for e2e', 'Push tested candidate by digest'].includes(name ?? ''),
    );
    expect(validationStep.with['cache-from'].trim().split('\n')).toEqual([
      'type=registry,ref=${{ env.REGISTRY_IMAGE }}:buildcache-amd64-${{ matrix.stage }}',
    ]);
    for (const step of buildSteps) {
      expect(step.with['cache-from'].trim().split('\n')).toEqual([
        'type=registry,ref=${{ env.REGISTRY_IMAGE }}:buildcache-${{ matrix.arch }}-${{ matrix.stage }}',
      ]);
    }
    const initialBuild = buildSteps.find(
      ({ name }: { name?: string }) => name === 'Build candidate for e2e',
    );
    expect(initialBuild.with['cache-to']).toBe(
      'type=registry,ref=${{ env.REGISTRY_IMAGE }}:buildcache-${{ matrix.arch }}-${{ matrix.stage }},mode=max',
    );
  });

  it('should keep commit identity out of expensive Docker layers', () => {
    const ci = workflow('docker.yml');
    const source = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const expensive = source.slice(
      source.indexOf('FROM deps-base AS bindgen-content'),
      source.indexOf('FROM bindgen-content AS bindgen-base'),
    );
    expect(expensive).not.toContain('ARG REVISION');
    expect(expensive).not.toContain('ARG SOURCE_DATE_EPOCH');
    expect(source).not.toContain('ARG SOURCE_DATE_EPOCH');
    expect(source.match(/ARG OCJS_SOURCE_DATE_EPOCH/g)).toHaveLength(3);
    expect(source.match(/ENV OCJS_SOURCE_COMMIT=/g)).toHaveLength(3);
    for (const step of [
      ci.jobs['candidate-validation'].steps.find(
        ({ name }: { name?: string }) => name === 'Build candidate for validation',
      ),
      ...ci.jobs['candidate-build'].steps.filter(
        ({ name }: { name?: string }) => ['Build candidate for e2e', 'Push tested candidate by digest'].includes(name ?? ''),
      ),
    ]) {
      const buildArgs = step.with['build-args'].trim().split('\n');
      expect(buildArgs).toContain('SOURCE_DATE_EPOCH=0');
      expect(buildArgs).toContain(
        'OCJS_SOURCE_DATE_EPOCH=${{ needs.preflight.outputs.source_date_epoch }}',
      );
      expect(buildArgs).not.toContain(
        'SOURCE_DATE_EPOCH=${{ needs.preflight.outputs.source_date_epoch }}',
      );
    }
    const e2e = fs.readFileSync(path.join(ROOT, 'scripts/docker-e2e-validate.sh'), 'utf8');
    expect(e2e).toContain('"--build-arg" "SOURCE_DATE_EPOCH=0"');
    expect(e2e).toContain('"--build-arg" "OCJS_SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"');
  });

  it('should keep same-run artifacts stable across retry attempts', () => {
    const ci = workflow('docker.yml');
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).not.toContain('GITHUB_RUN_ATTEMPT');
    for (const jobName of ['candidate-validation', 'candidate-build', 'package-assemble']) {
      const uploads = ci.jobs[jobName].steps.filter(
        ({ uses }: { uses?: string }) => uses?.startsWith('actions/upload-artifact@'),
      );
      for (const upload of uploads) {
        expect(upload.with.overwrite, jobName).toBe(true);
      }
    }
  });

  it('should run one final link and reuse the minimal bindgen fixture', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/docker-e2e-validate.sh'), 'utf8');
    const fixture = (name: string) => parse(
      fs.readFileSync(path.join(ROOT, 'tests/docker/fixtures', name), 'utf8'),
    );
    expect(source).toContain('tests/docker/fixtures/simple.yml');
    expect(source).toContain('docker-js-smoke.mjs" "$OUTPUT_DIR/customBuild.simple.js" simple');
    for (const name of ['simple.yml', 'multi-threaded.yml', 'progress-indicator.yml']) {
      expect(fixture(name).mainBuild.emccFlags).toContain('--emit-symbol-map');
    }
    for (const obsolete of [
      'WARM_BUDGET_S',
      'SKIP_COLD_LINK',
      '--skip-cold-link',
      '--warm-budget',
      '_artifact_digest_manifest',
      'Warm-cache rerun',
    ]) {
      expect(source).not.toContain(obsolete);
    }
  });

  it('should test the exact npm candidate in the six-cell browser runtime matrix', () => {
    const ci = workflow('docker.yml');
    const browser = ci.jobs['package-browser'];
    expect(browser.needs).toBe('package-assemble');
    expect(browser.strategy).toBeUndefined();
    expect(ci.jobs['package-templates'].strategy).toBeUndefined();
    expect(ci.jobs['package-gate'].needs).toEqual([
      'package-runtime',
      'package-browser',
      'package-templates',
      'package-docs',
    ]);

    const runner = fs.readFileSync(path.join(ROOT, 'scripts/browser-runtime-matrix.mjs'), 'utf8');
    const wrapper = fs.readFileSync(path.join(ROOT, 'scripts/test-candidate-browser.sh'), 'utf8');
    const workflowSource = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(runner).toContain('Object.entries({ chromium, firefox, webkit })');
    expect(runner).toContain("single: 'opencascade_full'");
    expect(runner).toContain("multi: 'opencascade_full_multi'");
    expect(runner).toContain("page.on('console'");
    expect(runner).toContain("page.on('pageerror'");
    expect(runner).toContain("page.on('worker'");
    expect(wrapper).toContain('playwright@1.60.0');
    expect(wrapper).toContain('playwright install --with-deps chromium firefox webkit');
    expect(workflowSource).not.toContain('Browser multi-threaded boot');
  });

  it('should export wasmMemory from every canonical full-build configuration', () => {
    for (const relative of [
      'build-configs/full.yml',
      'build-configs/full_multi.yml',
      'build-configs/full_multi_browser.yml',
      'scripts/enumerate-symbols.py',
    ]) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(source, relative).toContain('-sEXPORTED_RUNTIME_METHODS=["FS","wasmMemory"]');
    }
  });

  it('should fail cheap quality checks before provisioning build dependencies', () => {
    const ci = workflow('docker.yml');
    const names = ci.jobs.quality.steps.map(({ name }: { name?: string }) => name ?? '');
    expect(names.indexOf('Cheap JavaScript and shell quality'))
      .toBeLessThan(names.indexOf('Install uv'));
    expect(names.indexOf('Workflow quality'))
      .toBeLessThan(names.indexOf('Materialize pinned build dependencies'));
    expect(names.indexOf('Materialize pinned build dependencies'))
      .toBeLessThan(names.indexOf('Python quality and unit tests'));
  });

  it('should lint the complete docs corpus without relying on the PR diff API', () => {
    const ci = workflow('docker.yml');
    const vale = ci.jobs['docs-prose'].steps.find(
      ({ name }: { name?: string }) => name === 'Vale',
    );
    expect(vale.with.filter_mode).toBe('nofilter');
    expect(vale.with.fail_on_error).toBe(true);
    expect(vale.with.reporter).toBe('local');
  });

  it('should keep Nx and build state readable and writable for non-root consumers', () => {
    const source = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const permissionCommand =
      'chmod -R go+rwX /opencascade.js/.nx /opencascade.js/build';
    expect(source.split(permissionCommand)).toHaveLength(4);
    expect(source).not.toContain(
      'chmod -R go+w /opencascade.js/.nx /opencascade.js/build',
    );
  });

  it('should keep the final aggregate free of custom timing API code', () => {
    const ci = workflow('docker.yml');
    expect(ci.jobs['ci-gate'].permissions).toEqual({ contents: 'read' });
    expect(ci.jobs['ci-gate'].steps).toHaveLength(1);
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).not.toContain('Summarize workflow timing');
    expect(source).not.toContain('/actions/runs/${process.env.GITHUB_RUN_ID}/jobs');
    expect(source).not.toContain('historical baseline:');
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

  it('should reserve moving GHCR aliases for stable releases', () => {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).toContain('PRERELEASE: ${{ needs.preflight.outputs.prerelease }}');
    expect(source).toContain(
      'if [ "$IS_RELEASE" = true ] && [ "$PRERELEASE" = false ]; then',
    );
    expect(source).toContain('tags=("$VERSION-$prefix" "sha-${FULL_SHA:0:8}-$prefix")');
  });

  it('should finalize releases and deploy Vercel only from the verified candidate', () => {
    const ci = workflow('docker.yml');
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(ci.jobs['release-finalize'].needs).toEqual(['preflight', 'registry-verify']);
    expect(ci.jobs['release-finalize'].permissions).toEqual({ contents: 'write' });
    expect(ci.jobs['release-finalize'].if).toContain("needs.registry-verify.result == 'success'");
    expect(ci.jobs['vercel-preview'].needs).toEqual(['preflight', 'package-assemble', 'ci-gate']);
    expect(ci.jobs['vercel-preview'].if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(ci.jobs['vercel-production'].needs).toEqual(['preflight', 'package-assemble', 'ci-gate']);
    expect(ci.jobs['vercel-production'].concurrency).toEqual({
      group: 'vercel-production',
      'cancel-in-progress': false,
    });
    expect(source).toContain('vercel@56.5.0 deploy --prebuilt --archive=tgz --token=');
    expect(source).toContain('vercel@56.5.0 deploy --prebuilt --archive=tgz --prod --token=');
    expect(source).toContain('git/ref/heads/main');
    expect(source).toContain('export OCJS_API_REFERENCE_SOURCE="$TARBALL"');
  });

  it('should launch the registry runtime check without worker-unsafe Node flags', () => {
    const source = fs.readFileSync(path.join(ROOT, '.github/workflows/docker.yml'), 'utf8');
    expect(source).toContain("cat > verify-runtime.mjs <<'NODE'");
    expect(source).toContain('node verify-runtime.mjs');
    expect(source).not.toContain('node --input-type=module -e');
  });

  it('should run generated-source checks before the dist-only package gate', () => {
    const ci = workflow('docker.yml');
    const packageGate = ci.jobs['package-assemble'].steps.find(
      ({ name }: { name?: string }) => name === 'Full runtime, regression, and declaration gates',
    );
    expect(packageGate.run).toContain(
      'npm test -- --exclude tests/no-clobber-validation.test.ts',
    );
  });

  it('should bridge the mutually exclusive candidate matrices explicitly', () => {
    const ci = workflow('docker.yml');
    const downstream = [
      'package-assemble',
      'package-runtime',
      'package-browser',
      'package-templates',
      'package-docs',
      'package-gate',
      'ghcr-promote',
      'npm-publish',
      'registry-verify',
    ];
    for (const jobName of downstream) {
      const job = ci.jobs[jobName];
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
      expect(job.if, jobName).toContain('always()');
      for (const dependency of needs) {
        expect(job.if, `${jobName} must require ${dependency}`).toContain(
          `needs.${dependency}.result == 'success'`,
        );
      }
    }
    expect(ci.jobs['ghcr-promote'].if).toContain("needs.preflight.outputs.ghcr_promote == 'true'");
    expect(ci.jobs['npm-publish'].if).toContain("needs.preflight.outputs.npm_publish == 'true'");
    expect(ci.jobs['registry-verify'].if).toContain("needs.preflight.outputs.npm_publish == 'true'");
  });

  it('should provision Node without a checkout in artifact-only registry jobs', () => {
    const ci = workflow('docker.yml');
    const nodeVersion = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
    for (const jobName of ['npm-publish', 'registry-verify']) {
      const setupNode = ci.jobs[jobName].steps.find(
        ({ uses }: { uses?: string }) => uses?.startsWith('actions/setup-node@'),
      );
      expect(setupNode.with, jobName).toMatchObject({ 'node-version': nodeVersion });
      expect(setupNode.with, jobName).not.toHaveProperty('node-version-file');
    }
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
      'docs-site/scripts/browser-multi-smoke.mjs',
      'runAction.sh',
      'scripts/docker-ci-preflight.sh',
      'test',
      'typedoc-reference-docs',
    ]) {
      expect(fs.existsSync(path.join(ROOT, relative)), relative).toBe(false);
    }
    const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.json'), 'utf8'));
    expect(project.targets).not.toHaveProperty('docker-ci-preflight');
    expect(fs.existsSync(path.join(ROOT, 'starter-templates/legacy'))).toBe(true);
  });
});

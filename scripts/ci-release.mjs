#!/usr/bin/env node

import fs from 'node:fs';

const SHA = /^[0-9a-f]{40}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const RELEASE_SUBJECT = /^chore\(release\): ocjs v(.+)$/;
const RELEASE_FILES = new Set(['CHANGELOG.md', 'package-lock.json', 'package.json']);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isVersionPlan = (file) =>
  file.startsWith('.nx/version-plans/') && file.endsWith('.md');

const validateReleaseFiles = (files, prerelease) => {
  assert(files.length > 0, 'release commit changed-file list is empty');
  for (const required of RELEASE_FILES) {
    assert(files.includes(required), `release commit must change ${required}`);
  }
  const versionPlans = files.filter(isVersionPlan);
  assert(
    prerelease ? versionPlans.length === 0 : versionPlans.length > 0,
    prerelease
      ? 'beta release must retain Version Plans'
      : 'stable release must consume at least one Version Plan',
  );
  const unexpected = files.filter(
    (file) => !RELEASE_FILES.has(file) && !isVersionPlan(file),
  );
  assert(unexpected.length === 0, `release commit has unexpected files: ${unexpected.join(', ')}`);
};

/**
 * @param {{
 *   event: string,
 *   ref: string,
 *   sha: string,
 *   commitEpoch: string | number,
 *   packageVersion: string,
 *   commitSubject?: string,
 *   changedFiles?: string[],
 * }} input
 */
export const deriveRelease = ({
  event,
  ref,
  sha,
  commitEpoch,
  packageVersion,
  commitSubject = '',
  changedFiles = [],
}) => {
  assert(SHA.test(sha), 'sha must be a lowercase 40-character hexadecimal commit');
  assert(/^\d+$/.test(String(commitEpoch)), 'commitEpoch must be a non-negative integer');
  const packageMatch = SEMVER.exec(packageVersion);
  assert(packageMatch, `package version is not valid SemVer: ${packageVersion}`);
  const core = `${packageMatch[1]}.${packageMatch[2]}.${packageMatch[3]}`;
  const common = {
    fullSha: sha,
    sourceDateEpoch: String(commitEpoch),
  };

  if (event === 'pull_request') {
    return {
      ...common,
      version: `${core}-canary.${sha.slice(0, 8)}`,
      channel: 'none',
      npmPublish: false,
      ghcrPromote: false,
      isRelease: false,
      kind: 'pull-request',
      releaseTag: '',
      prerelease: false,
    };
  }

  if (event === 'workflow_dispatch') {
    assert(ref.startsWith('refs/heads/'), `manual canary ref must be a branch: ${ref}`);
    return {
      ...common,
      version: `${core}-canary.${sha.slice(0, 8)}`,
      channel: 'canary',
      npmPublish: true,
      ghcrPromote: true,
      isRelease: false,
      kind: 'manual-canary',
      releaseTag: '',
      prerelease: false,
    };
  }

  assert(event === 'push', `unsupported event: ${event}`);
  assert(ref.startsWith('refs/heads/'), `push ref must be a branch: ${ref}`);
  assert(ref === 'refs/heads/main', `automatic push must target main: ${ref}`);

  const releaseMatch = RELEASE_SUBJECT.exec(commitSubject);
  if (!releaseMatch) {
    assert(
      !commitSubject.startsWith('chore(release): ocjs v'),
      `malformed release commit subject: ${commitSubject}`,
    );
    return {
      ...common,
      version: packageVersion,
      channel: 'none',
      npmPublish: false,
      ghcrPromote: true,
      isRelease: false,
      kind: 'main',
      releaseTag: '',
      prerelease: false,
    };
  }

  const subjectVersion = releaseMatch[1];
  assert(subjectVersion === packageVersion, `release subject ${subjectVersion} does not match ${packageVersion}`);
  const prerelease = packageMatch[4] !== undefined;
  if (prerelease) {
    assert(/^beta\.[1-9]\d*$/.test(packageMatch[4]), `unsupported release prerelease: ${packageMatch[4]}`);
  }
  validateReleaseFiles(changedFiles, prerelease);
  return {
    ...common,
    version: packageVersion,
    channel: prerelease ? 'beta' : 'latest',
    npmPublish: true,
    ghcrPromote: true,
    isRelease: true,
    kind: prerelease ? 'beta-release' : 'stable-release',
    releaseTag: `v${packageVersion}`,
    prerelease,
  };
};

const parseArgs = (argv) =>
  Object.fromEntries(
    argv.flatMap((value, index) =>
      value.startsWith('--') ? [[value.slice(2), argv[index + 1] ?? '']] : [],
    ),
  );

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const changedFiles = args['changed-files-file']
      ? fs.readFileSync(args['changed-files-file'], 'utf8').split(/\r?\n/).filter(Boolean)
      : [];
    const release = deriveRelease({
      event: args.event,
      ref: args.ref,
      sha: args.sha,
      commitEpoch: args['commit-epoch'],
      packageVersion: args['package-version'],
      commitSubject: args['commit-subject'],
      changedFiles,
    });
    const lines = Object.entries(release).map(
      ([key, value]) => `${key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)}=${value}`,
    );
    process.stdout.write(`${lines.join('\n')}\n`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

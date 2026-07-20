#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const branchSlug = (name) => {
  const slug = name.replace(/[^0-9A-Za-z_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  if (!slug) return 'detached';
  if (slug.length <= 64) return slug;
  const suffix = createHash('sha256').update(slug).digest('hex').slice(0, 8);
  return `${slug.slice(0, 55)}-${suffix}`;
};

export const deriveRelease = ({
  event,
  ref,
  refName,
  sha,
  commitEpoch,
  packageVersion,
  tagObjectType = '',
}) => {
  assert(SHA.test(sha), 'sha must be a lowercase 40-character hexadecimal commit');
  assert(/^\d+$/.test(String(commitEpoch)), 'commitEpoch must be a non-negative integer');
  const packageMatch = SEMVER.exec(packageVersion);
  assert(packageMatch, `package version is not valid SemVer: ${packageVersion}`);

  const date = new Date(Number(commitEpoch) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  const core = `${packageMatch[1]}.${packageMatch[2]}.${packageMatch[3]}`;
  const isTag = ref.startsWith('refs/tags/');
  const isPullRequest = event === 'pull_request';
  const isManual = event === 'workflow_dispatch';

  if (isTag) {
    assert(tagObjectType === 'tag', `release tag ${refName} must be annotated`);
    assert(refName.startsWith('v'), `release tag must start with v: ${refName}`);
    const version = refName.slice(1);
    const match = SEMVER.exec(version);
    assert(match, `release tag is not valid SemVer: ${refName}`);
    assert(packageVersion === version, `package version ${packageVersion} does not match tag ${version}`);
    const channel = match[4]?.split('.')[0] ?? 'latest';
    assert(channel !== 'latest' || !match[4], 'latest is reserved for stable releases');
    return {
      version,
      channel,
      publish: !isManual,
      isRelease: true,
      kind: match[4] ? 'prerelease-tag' : 'stable-tag',
      branchSlug: branchSlug(refName),
      fullSha: sha,
      sourceDateEpoch: String(commitEpoch),
    };
  }

  const version = `${core}-beta-${sha.slice(0, 8)}-${date}`;
  const isMaster = ref === 'refs/heads/master';
  return {
    version,
    channel: isMaster ? 'beta' : 'canary',
    publish: !isPullRequest && !isManual && event === 'push',
    isRelease: false,
    kind: isPullRequest ? 'pull-request' : isManual ? 'manual' : isMaster ? 'master' : 'branch',
    branchSlug: branchSlug(refName),
    fullSha: sha,
    sourceDateEpoch: String(commitEpoch),
  };
};

const parseArgs = (argv) => Object.fromEntries(
  argv.flatMap((value, index) => value.startsWith('--') ? [[value.slice(2), argv[index + 1] ?? '']] : []),
);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const release = deriveRelease({
      event: args.event,
      ref: args.ref,
      refName: args['ref-name'],
      sha: args.sha,
      commitEpoch: args['commit-epoch'],
      packageVersion: args['package-version'],
      tagObjectType: args['tag-object-type'],
    });
    const lines = Object.entries(release).map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}=${value}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

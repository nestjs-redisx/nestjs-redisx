#!/usr/bin/env node
/**
 * Release guard: refuses to release a version that is not properly recorded.
 *
 * Checks, against the version in the root package.json:
 *   1. CHANGELOG.md has an entry for the version, it is the TOPMOST entry,
 *      and it carries a real YYYY-MM-DD date;
 *   2. every publishable workspace package is at the same version (lockstep);
 *   3. the site nav version in website/.vitepress/config.ts is current
 *      (it is not derived from package.json and goes stale silently).
 *
 * Usage:
 *   node scripts/check-changelog.mjs           # local / CI on push
 *   node scripts/check-changelog.mjs v1.12.0   # CI on tag push: the tagged
 *                                              # version must ALSO match root
 *
 * Runs with no dependencies so the tag workflow needs no `npm ci`.
 * RELEASE_GUARD_ROOT overrides the repo root (used by the guard's own tests).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.RELEASE_GUARD_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = rootPkg.version;

const argVersion = process.argv[2]?.replace(/^v/, '');
if (argVersion && argVersion !== version) {
  errors.push(`Version mismatch: the tag/argument says ${argVersion}, but the root package.json says ${version}.`);
}

// 1. CHANGELOG: the topmost entry must be this version with a valid date
const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\S+)\s*$/gm)];
if (headings.length === 0) {
  errors.push('CHANGELOG.md contains no "## [X.Y.Z] - YYYY-MM-DD" headings at all.');
} else {
  const [, topVersion, topDate] = headings[0];
  if (topVersion !== version) {
    const existsElsewhere = headings.some((h) => h[1] === version);
    errors.push(
      existsElsewhere
        ? `CHANGELOG.md has an entry for ${version}, but it is not the topmost one — the newest release must come first.`
        : `CHANGELOG.md has no entry for ${version} — every published version gets an entry, including patches. Write it before releasing.`,
    );
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(topDate)) {
    errors.push(`CHANGELOG.md entry for ${version} has an invalid date "${topDate}" (expected YYYY-MM-DD).`);
  }
}

// 2. Lockstep: every publishable workspace package at the same version
let publishable = 0;
for (const name of readdirSync(join(repoRoot, 'packages'))) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', name, 'package.json'), 'utf8'));
  } catch {
    continue; // not a package directory
  }
  if (pkg.private) continue;
  publishable++;
  if (pkg.version !== version) {
    errors.push(`${pkg.name} is at ${pkg.version} — expected lockstep version ${version}.`);
  }
}
if (publishable === 0) {
  errors.push('No publishable packages found under packages/ — the guard cannot verify lockstep.');
}

// 3. Site nav version (manual, not derived from package.json)
const navConfig = readFileSync(join(repoRoot, 'website/.vitepress/config.ts'), 'utf8');
if (!navConfig.includes(`text: 'v${version}'`)) {
  const stale = navConfig.match(/text: 'v(\d+\.\d+\.\d+)'/)?.[1];
  errors.push(`website/.vitepress/config.ts nav shows ${stale ? `v${stale}` : 'no version'} — expected "text: 'v${version}'".`);
}

if (errors.length > 0) {
  console.error(`Release guard FAILED for v${version}:`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log(`Release guard OK for v${version}: topmost dated CHANGELOG entry, ${publishable} packages in lockstep, site nav current.`);

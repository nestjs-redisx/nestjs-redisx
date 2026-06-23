#!/usr/bin/env node
/**
 * Verifies that website/public/llms-full.txt documents every public method of
 * each plugin's service/producer/consumer port. Fails (exit 1) if any method is
 * missing, so the LLM reference cannot silently drift from the code.
 *
 * The required method set is derived from the port interfaces themselves
 * (packages/<pkg>/src/**\/ports/*-service.port.ts plus the streams
 * producer/consumer ports), so adding a method to a port also requires
 * documenting it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const LLMS_FULL = join(repoRoot, 'website', 'public', 'llms-full.txt');

/** Recursively collect files under `dir` matching `predicate`. */
function walk(dir, predicate, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

// Port files whose methods are part of the public programmatic API.
const isPortFile = (f) => {
  const name = basename(f);
  return name.endsWith('-service.port.ts') || name === 'stream-producer.port.ts' || name === 'stream-consumer.port.ts';
};

const portFiles = walk(join(repoRoot, 'packages'), isPortFile).sort();

// Extract method names from an interface body: lines like `  name(...)...;`
const METHOD_RE = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*(?:<[^>]*>)?\s*\(/;

function extractMethods(file) {
  const methods = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = METHOD_RE.exec(line);
    if (m) methods.add(m[1]);
  }
  return methods;
}

const llms = readFileSync(LLMS_FULL, 'utf8');
const hasWord = (name) => new RegExp(`\\b${name}\\b`).test(llms);

const missing = [];
let total = 0;
for (const file of portFiles) {
  const rel = file.slice(repoRoot.length + 1);
  for (const method of extractMethods(file)) {
    total++;
    if (!hasWord(method)) missing.push(`${rel} -> ${method}()`);
  }
}

if (missing.length > 0) {
  console.error(`llms-full.txt is missing ${missing.length}/${total} public method(s):`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error('\nDocument them in website/public/llms-full.txt (see "## Complete API Reference").');
  process.exit(1);
}

console.log(`llms-full.txt covers all ${total} public port methods across ${portFiles.length} port file(s).`);

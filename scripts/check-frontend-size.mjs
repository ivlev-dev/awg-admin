#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const DEFAULTS = {
  initialJsKiB: 160,
  cssKiB: 25,
  totalJsKiB: 420,
};

const KIB = 1024;

function usage() {
  console.log(`Usage: node scripts/check-frontend-size.mjs [options] [dist-dir]

Checks gzip budgets for a Vite build.

Options:
  --dist=<dir>              build directory (default: frontend/dist)
  --js-gzip=<KiB>           budget for the initial JS loaded by index.html (default: ${DEFAULTS.initialJsKiB})
  --css-gzip=<KiB>          budget for all CSS in assets/ (default: ${DEFAULTS.cssKiB})
  --total-js-gzip=<KiB>     guardrail for all JS chunks in assets/ (default: ${DEFAULTS.totalJsKiB})
  -h, --help                show this help

Exit code is 1 when any budget is exceeded.`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseBudget(raw, name) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

let distDir = resolve(REPO_ROOT, "frontend/dist");
let initialJsBudgetKiB = DEFAULTS.initialJsKiB;
let cssBudgetKiB = DEFAULTS.cssKiB;
let totalJsBudgetKiB = DEFAULTS.totalJsKiB;

for (const arg of process.argv.slice(2)) {
  if (arg === "-h" || arg === "--help") {
    usage();
    process.exit(0);
  }
  if (arg.startsWith("--dist=")) {
    distDir = resolve(arg.slice("--dist=".length));
    continue;
  }
  if (arg.startsWith("--js-gzip=")) {
    initialJsBudgetKiB = parseBudget(arg.slice("--js-gzip=".length), "--js-gzip");
    continue;
  }
  if (arg.startsWith("--css-gzip=")) {
    cssBudgetKiB = parseBudget(arg.slice("--css-gzip=".length), "--css-gzip");
    continue;
  }
  if (arg.startsWith("--total-js-gzip=")) {
    totalJsBudgetKiB = parseBudget(arg.slice("--total-js-gzip=".length), "--total-js-gzip");
    continue;
  }
  if (arg.startsWith("-")) {
    fail(`unknown option "${arg}" (try --help)`);
  }
  distDir = resolve(arg);
}

const assetsDir = join(distDir, "assets");
const indexPath = join(distDir, "index.html");

for (const path of [assetsDir, indexPath]) {
  try {
    statSync(path);
  } catch {
    fail(`${path} is missing; run "pnpm build" in frontend/ first`);
  }
}

const gzipSize = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

const jsFiles = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js"))
  .sort();
const cssFiles = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".css"))
  .sort();

if (jsFiles.length === 0) {
  fail(`no JavaScript chunks found in ${assetsDir}`);
}

const sizes = new Map();
for (const name of jsFiles) {
  sizes.set(name, gzipSize(join(assetsDir, name)));
}

const html = readFileSync(indexPath, "utf8");
const initialNames = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)]
      .map((match) => basename(match[1]))
      .filter((name) => sizes.has(name)),
  ),
];

if (initialNames.length === 0) {
  fail(`index.html does not reference any built JavaScript chunks in ${assetsDir}`);
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const initialBytes = sum(initialNames.map((name) => sizes.get(name)));
const totalBytes = sum([...sizes.values()]);
const cssBytes = sum(cssFiles.map((name) => gzipSize(join(assetsDir, name))));

const toKiB = (bytes) => bytes / KIB;
const fmt = (bytes) => toKiB(bytes).toFixed(1);

const printTop = (title, entries, limit = 5) => {
  console.log(title);
  for (const [name, bytes] of entries.slice(0, limit)) {
    console.log(`  ${fmt(bytes).padStart(7)} KiB  ${name}`);
  }
};

const failures = [];

function check(label, bytes, budgetKiB) {
  const used = toKiB(bytes);
  const percent = (used / budgetKiB) * 100;
  const status = used <= budgetKiB ? "ok" : "FAIL";
  console.log(
    `${label}: ${used.toFixed(1)} / ${budgetKiB.toFixed(1)} KiB (${percent.toFixed(1)}%) ${status}`,
  );
  if (used > budgetKiB) {
    failures.push(`${label} ${used.toFixed(1)} KiB exceeds ${budgetKiB.toFixed(1)} KiB`);
  }
}

console.log(`Frontend size budgets (gzip, 1 KiB = 1024 B)`);
console.log(`build: ${distDir}`);
console.log("");

const initialEntries = initialNames
  .map((name) => [name, sizes.get(name)])
  .sort((a, b) => b[1] - a[1]);
const allEntries = [...sizes.entries()].sort((a, b) => b[1] - a[1]);

printTop(`Top 5 initial JS chunks (${initialNames.length} total):`, initialEntries);
console.log("");
printTop(`Top 5 JS chunks (${jsFiles.length} total):`, allEntries);
console.log("");

check("Initial JS", initialBytes, initialJsBudgetKiB);
check("CSS", cssBytes, cssBudgetKiB);
check("All JS (guardrail)", totalBytes, totalJsBudgetKiB);

if (failures.length > 0) {
  console.error("");
  for (const failure of failures) {
    console.error(`budget exceeded: ${failure}`);
  }
  process.exit(1);
}

console.log("");
console.log("All frontend size budgets passed.");

#!/usr/bin/env node
// Raw-colour guard (JMAX UI Library build spec, phase 1). Screens use the --jm-* tokens
// (app/theme/tokens.css, Tailwind `jm-*` colours) instead of raw colours. Each file may keep at most
// the number of raw colours (#hex, rgb()/rgba(), hsl()/hsla()) listed in raw-colors-allowed.json;
// new files may have none. The list only shrinks: when a file drops below its allowance, lower the
// number in the same PR.
//   node scripts/check-raw-colors.mjs            check
//   node scripts/check-raw-colors.mjs --write    rewrite the allowance to today's counts (only after removing colours)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "app");
const allowFile = path.join(here, "raw-colors-allowed.json");
// #rgb, #rgba, #rrggbb, #rrggbbaa (not HTML entities like &#039;), and rgb()/hsl() functions.
const RAW = /(?<![&\w])#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3,4})\b|\b(?:rgba?|hsla?)\(/g;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(js|jsx|ts|tsx|mjs|css)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name) ? [p] : [];
  });
}

const counts = {};
for (const f of files(root)) {
  const rel = path.relative(root, f).split(path.sep).join("/");
  if (rel.startsWith("theme/")) continue;   // where the colours are defined
  const n = (fs.readFileSync(f, "utf8").match(RAW) || []).length;
  if (n) counts[rel] = n;
}

if (process.argv.includes("--write")) {
  const sorted = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
  fs.writeFileSync(allowFile, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((a, b) => a + b, 0)} raw colours.`);
  process.exit(0);
}

const allowed = JSON.parse(fs.readFileSync(allowFile, "utf8"));
const over = Object.entries(counts).filter(([f, n]) => n > (allowed[f] || 0));
const under = Object.entries(allowed).filter(([f, n]) => (counts[f] || 0) < n);
for (const [f, n] of over) console.error(`app/${f}: ${n} raw colours (allowed ${allowed[f] || 0}). Use a --jm-* token (Tailwind jm-*) instead.`);
for (const [f, n] of under) console.error(`app/${f}: now ${counts[f] || 0} raw colours; lower its allowance from ${n} in scripts/raw-colors-allowed.json.`);
if (over.length || under.length) process.exit(1);
console.log(`Raw colours: ${Object.values(counts).reduce((a, b) => a + b, 0)} in ${Object.keys(counts).length} files, within the allowance.`);

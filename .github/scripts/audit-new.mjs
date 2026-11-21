#!/usr/bin/env node
// @ts-check

/**
 * audit-new.mjs: runs the project's own audit tool on the PR and on its base,
 * and fails only on advisories the PR adds. An advisory published against a
 * dependency already on the base branch never blocks an unrelated PR.
 * Node >= 20, zero dependencies.
 *
 *   node audit-new.mjs --base <sha> [--level high] [--allow <file>] -- <audit command...>
 *   node audit-new.mjs --full [--level high] [--allow <file>] -- <audit command...>
 *
 * `--base` runs the command in a detached worktree at <sha>, then in the
 * current checkout, and compares advisory IDs. `--full` runs it once and
 * reports everything (the scheduled run that watches the default branch).
 *
 * The audit command must print JSON (or NDJSON) to stdout, e.g.
 * `bun audit --json`, `npm audit --json --package-lock-only`,
 * `pnpm audit --json`, `bundle-audit check --format json`,
 * `pip-audit -f json`, `cargo audit --json`. bun and npm output is read
 * field by field, with severities. Any other tool's output is read for
 * advisory IDs (GHSA, CVE, PYSEC, RUSTSEC, GO) without severities, so every
 * new ID counts: use that tool's own severity flag where it has one.
 *
 * `--allow` (default `.github/audit-allow.txt`) lists acknowledged advisory
 * IDs, one per line, `#` comments allowed. Adding one is a reviewable PR:
 * the escape hatch for an advisory the pod has decided to live with.
 *
 * Exit codes: 0 nothing new, 1 new advisories, 2 usage or the audit tool
 * failed to produce output.
 */

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEVERITIES = ["low", "moderate", "high", "critical"];
const ID_PATTERN = /\b(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d{4,}|PYSEC-\d{4}-\d+|RUSTSEC-\d{4}-\d{4}|GO-\d{4}-\d{4,})\b/g;

/** @typedef {{ id: string, severity: string | null, pkg: string | null, title: string | null }} Advisory */

/** @param {string} url */
function idFromUrl(url) {
  return url?.match(/GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}/)?.[0] ?? null;
}

/**
 * Reads advisories out of an audit tool's stdout.
 * @param {string} text
 * @returns {Advisory[]}
 */
export function parseAdvisories(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  /** @type {Advisory[]} */
  const out = [];
  if (json && typeof json === "object" && json.auditReportVersion && json.vulnerabilities) {
    // npm 7+: vulnerabilities[pkg].via[] holds advisory objects or package names.
    for (const vuln of Object.values(json.vulnerabilities)) {
      for (const via of vuln.via ?? []) {
        if (typeof via !== "object") continue;
        const id = idFromUrl(via.url) ?? String(via.source);
        out.push({ id, severity: via.severity ?? null, pkg: via.name ?? null, title: via.title ?? null });
      }
    }
    return dedupe(out);
  }
  if (json && typeof json === "object" && !Array.isArray(json) && Object.values(json).length > 0 &&
      Object.values(json).every((v) => Array.isArray(v) && v.every((a) => a && typeof a === "object" && "severity" in a))) {
    // bun: { [pkg]: [{ id, url, title, severity }] }
    for (const [pkg, list] of Object.entries(json)) {
      for (const a of list) {
        out.push({ id: idFromUrl(a.url) ?? String(a.id), severity: a.severity ?? null, pkg, title: a.title ?? null });
      }
    }
    return dedupe(out);
  }
  // Anything else: advisory IDs wherever they appear.
  for (const match of text.matchAll(ID_PATTERN)) out.push({ id: match[1], severity: null, pkg: null, title: null });
  return dedupe(out);
}

/** @param {Advisory[]} list */
function dedupe(list) {
  const seen = new Map();
  for (const a of list) if (!seen.has(a.id)) seen.set(a.id, a);
  return [...seen.values()];
}

/**
 * @param {Advisory} a
 * @param {string} level
 */
export function atOrAbove(a, level) {
  if (a.severity === null) return true; // unknown severity counts
  return SEVERITIES.indexOf(a.severity) >= SEVERITIES.indexOf(level);
}

/**
 * Advisories in head that are not in base, not allowed, and at or above level.
 * @param {Advisory[]} base
 * @param {Advisory[]} head
 * @param {{ level: string, allowed: Set<string> }} opts
 */
export function newAdvisories(base, head, { level, allowed }) {
  const before = new Set(base.map((a) => a.id));
  return head.filter((a) => !before.has(a.id) && !allowed.has(a.id) && atOrAbove(a, level));
}

/** @param {string} file */
export function readAllowList(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs.readFileSync(file, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean),
  );
}

/**
 * @param {string[]} command
 * @param {string} cwd
 */
function runAudit(command, cwd) {
  const res = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const stdout = res.stdout ?? "";
  // Audit tools exit non-zero when they find something; only no output is a failure.
  if (res.error || !stdout.trim()) {
    throw new Error(`\`${command.join(" ")}\` in ${cwd} produced no output${res.stderr ? `:\n${res.stderr.trim()}` : ""}`);
  }
  const found = parseAdvisories(stdout);
  // A tool that failed (a registry error, say) also exits non-zero, with an
  // error and no advisories: that is not a clean audit.
  if (res.status !== 0 && found.length === 0) {
    throw new Error(`\`${command.join(" ")}\` in ${cwd} exited ${res.status} and reported no advisories:\n${(res.stderr || stdout).trim().slice(0, 500)}`);
  }
  return found;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const flags = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  /** @type {{ base?: string, full: boolean, level: string, allow: string, command: string[] }} */
  const out = { full: false, level: "high", allow: ".github/audit-allow.txt", command };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--base") out.base = flags[++i];
    else if (f === "--full") out.full = true;
    else if (f === "--level") out.level = flags[++i];
    else if (f === "--allow") out.allow = flags[++i];
    else throw new Error(`unknown argument: ${f}`);
  }
  if (!out.command.length) throw new Error("give the audit command after --");
  if (!SEVERITIES.includes(out.level)) throw new Error(`--level must be one of ${SEVERITIES.join(", ")}`);
  if (!out.full && !out.base) throw new Error("pass --base <sha> or --full");
  return out;
}

/** @param {Advisory} a */
function line(a) {
  return `  ${a.id}${a.severity ? ` (${a.severity})` : ""}${a.pkg ? ` in ${a.pkg}` : ""}${a.title ? `: ${a.title}` : ""}`;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`audit-new.mjs: ${/** @type {Error} */ (err).message}`);
    process.exit(2);
  }
  const allowed = readAllowList(opts.allow);
  try {
    const head = runAudit(opts.command, process.cwd());
    if (opts.full) {
      const found = head.filter((a) => !allowed.has(a.id) && atOrAbove(a, opts.level));
      console.log(found.length ? `${found.length} advisories at ${opts.level} or above:\n${found.map(line).join("\n")}` : "no advisories");
      process.exit(found.length ? 1 : 0);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-base-"));
    execFileSync("git", ["worktree", "add", "--detach", dir, /** @type {string} */ (opts.base)], { stdio: "ignore" });
    let base;
    try {
      base = runAudit(opts.command, dir);
    } catch (err) {
      // Usually the PR adds the first lockfile, so the base has nothing to audit.
      console.log(`::notice title=Audit::No audit output on the base branch, so every advisory below counts as new. ${/** @type {Error} */ (err).message.split("\n")[0]}`);
      base = [];
    } finally {
      execFileSync("git", ["worktree", "remove", "--force", dir], { stdio: "ignore" });
    }
    const added = newAdvisories(base, head, { level: opts.level, allowed });
    if (added.length) {
      console.log(`::error title=Audit::This PR adds ${added.length} advisor${added.length === 1 ? "y" : "ies"} at ${opts.level} or above`);
      console.log(added.map(line).join("\n"));
      console.log(`Fix the dependency, or acknowledge the ID in ${opts.allow} with a reason.`);
      process.exit(1);
    }
    const preexisting = head.filter((a) => !allowed.has(a.id) && atOrAbove(a, opts.level)).length;
    console.log(`no new advisories${preexisting ? ` (${preexisting} already on the base branch; the scheduled run reports them)` : ""}`);
  } catch (err) {
    console.error(`::error title=Audit::${/** @type {Error} */ (err).message}`);
    process.exit(2);
  }
}

// Compare real paths: a raw `file://` comparison is false for a path with a space or a symlink, and the audit would do nothing and exit 0.
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();

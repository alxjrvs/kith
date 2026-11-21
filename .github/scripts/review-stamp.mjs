#!/usr/bin/env node
// @ts-check

/**
 * review-stamp.mjs: records an agent review's result on each commit, and checks it.
 * Node >= 20, zero dependencies; git >= 2.39.
 *
 *   node review-stamp.mjs stamp <pass|fail> [--base <ref>]   after the review, before the push
 *   node review-stamp.mjs vouch <commit>           a commit already on main, reviewed and passed
 *   node review-stamp.mjs check <base> <head> [--since-green <check>]   the Review workflow
 *   node review-stamp.mjs green-base <before> <check>   the base Audit compares with
 *   node review-stamp.mjs id [<commit>]            print a commit's review ID
 *
 * `stamp` adds an `Agent-Reviewed: <id> <pass|fail>` trailer to every commit between
 * <base> (default: the remote's default branch) and HEAD, rewriting only their
 * messages. The ID hashes the commit's changed lines alone
 * (`git diff-tree -U0 | git patch-id --verbatim`), so it survives a rebase
 * whose only effect is to move or surround those lines, and breaks when a
 * changed line does, whitespace included. Edit a commit after the review and
 * its stamp no longer matches: review and stamp again. The same lines changed
 * the same way elsewhere in a file share an ID: the stamp says the step ran on
 * this change, not where.
 *
 * `check` fails on a commit in <base>..<head> unless one of these holds:
 *   - its stamp matches its diff and records a passing review (a `fail` stamp
 *     is an honest record, and fails the check);
 *   - it is a pure `git revert`: its message names an ancestor (`This reverts
 *     commit <sha>`) and its diff is exactly that commit's, reversed. It needs
 *     no stamp, and the commit it undoes passes too. Undoing a revert is a
 *     re-apply, and needs a stamp like any change;
 *   - a later stamped commit in the range names it in an
 *     `Agent-Reviewed-Commit: <full sha>` trailer (`vouch` writes one, in an
 *     empty commit, for a commit pushed without its stamp);
 *   - GitHub made it and a merged PR whose head passed Review stands behind it
 *     (a squash merge). That lookup uses `gh` with GH_TOKEN and
 *     GITHUB_REPOSITORY. A commit made in GitHub's web editor has no PR.
 * A merge commit fails unless vouched for: nothing else can stamp one, and
 * main's history is linear. Commits by bots such
 * as Dependabot are skipped; CI and Audit still gate them.
 *
 * `--since-green <check>` (pushes to main) widens the range: the base becomes
 * the newest ancestor of <base> on which <check> passed, however far back, so
 * a later clean push doesn't hide an earlier red one and a red commit never
 * ages out. Main stays red until the commit is reverted or vouched for.
 *
 * What this proves: a passing review was recorded for that exact change. It
 * can't tell whether the review ran or was any good, a stamp or a bot author
 * name can be forged on purpose, and anyone who can push to main can edit
 * this file. It turns "I forgot" and "it failed" into a red check.
 *
 * Every commit on main names its issue, the way a squashed PR's title does.
 * Any of these counts: `#123`, `owner/repo#123`, `AB#123`; a tracker key
 * (`ABC-123`, `[sc-123]`); a link to a tracker item; or a `Refs:`, `Fixes:`,
 * `Closes:`, `Resolves:`, `Issue:` or `Ticket:` trailer with anything in it
 * (`Refs: none` for a change with no issue). A commit without one gets a
 * warning from `stamp` and `check`, never a failure.
 *
 * Exit codes: 0 every commit passes, 1 a commit doesn't, 2 usage or git failed.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRAILER = "Agent-Reviewed";
export const VOUCH_TRAILER = "Agent-Reviewed-Commit";
const NULL_SHA = /^0{40}$/;
const GITHUB_COMMITTER = "noreply@github.com";
const TRACKER_REFS = [
  /(?:^|[\s(\[,:])(?:[\w.-]+\/[\w.-]+|AB)?#\d+\b/m, // #123, owner/repo#123, AB#123, fix:#12
  /\b[A-Z][A-Z0-9]+-\d+\b/, // ABC-123 anywhere
  /[(\[][a-z][a-z0-9]+-\d+[)\]]/i, // (abc-123), [sc-12345]
  /https?:\/\/\S*(?:\/issues\/\d|\/pull\/\d|\/merge_requests\/\d|\/_workitems\/|\/browse\/|\/issue\/|\/tickets?\/|\/story\/|\/task\/|atlassian\.net|linear\.app|app\.shortcut\.com|app\.asana\.com|trello\.com\/c\/|notion\.so)/i,
  /^(?:Refs|Fixes|Closes|Resolves|Issue|Ticket):[ \t]*\S/im, // a trailer
];

/**
 * Whether a commit message references a tracker item.
 * @param {string} message
 */
export function hasTrackerRef(message) {
  return TRACKER_REFS.some((re) => re.test(message));
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: opts.cwd, input: opts.input, env: opts.env ?? process.env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 ** 3 }).trim();
}

/**
 * @param {string} diff
 * @param {string} [cwd]
 */
function patchId(diff, cwd) {
  return git(["patch-id", "--verbatim"], { cwd, input: diff + "\n" }).split(/\s+/)[0] ?? "";
}

/**
 * The commit's review ID: a hash of its changed lines, or "empty" for a commit with none.
 * @param {string} commit
 * @param {string} [cwd]
 */
export function reviewId(commit, cwd) {
  return patchId(git(["diff-tree", "-p", "-U0", "--root", "--no-color", commit], { cwd }), cwd) || "empty";
}

/**
 * The ID a pure revert of `commit` would have: its diff, reversed. "" for a root or merge commit.
 * @param {string} commit
 * @param {string} [cwd]
 */
export function revertIdOf(commit, cwd) {
  const parents = parentsOf(commit, cwd);
  if (parents.length !== 1) return "";
  return patchId(git(["diff-tree", "-p", "-U0", "--no-color", commit, /** @type {string} */ (parents[0])], { cwd }), cwd);
}

/**
 * The commit a pure revert undoes: the ancestor its message names (`This
 * reverts commit <sha>`), when the diff is exactly that commit's, reversed. "" otherwise.
 * @param {string} commit
 * @param {string} id the commit's review ID
 * @param {string} [cwd]
 */
function revertTarget(commit, id, cwd) {
  const named = /^This reverts commit ([0-9a-f]{7,40})\b/m.exec(git(["log", "-1", "--format=%B", commit], { cwd }))?.[1];
  if (!named) return "";
  try {
    const sha = git(["rev-parse", "--verify", "--quiet", `${named}^{commit}`], { cwd });
    git(["merge-base", "--is-ancestor", sha, `${commit}^`], { cwd });
    return revertIdOf(sha, cwd) === id ? sha : "";
  } catch {
    return "";
  }
}

/**
 * @param {string} commit
 * @param {string} [cwd]
 */
function parentsOf(commit, cwd) {
  return git(["log", "-1", "--format=%P", commit], { cwd }).split(" ").filter(Boolean);
}

/**
 * A trailer's values on a commit, in order.
 * @param {string} commit
 * @param {string} key
 * @param {string} [cwd]
 */
function trailers(commit, key, cwd) {
  return git(["log", "-1", `--format=%(trailers:key=${key},valueonly)`, commit], { cwd }).split("\n").map((v) => v.trim()).filter(Boolean);
}

export const RESULTS = ["pass", "fail"];

/**
 * The commit's last Agent-Reviewed trailer, or "": `<review id> <pass|fail>`.
 * @param {string} commit
 * @param {string} [cwd]
 */
export function stampOf(commit, cwd) {
  return trailers(commit, TRAILER, cwd).at(-1) ?? "";
}

/**
 * A stamp's parts: the review ID it was made for, and the review's result.
 * @param {string} stamp
 */
export function parseStamp(stamp) {
  const [id = "", result = ""] = stamp.split(/\s+/);
  return { id, result: RESULTS.includes(result) ? result : "" };
}

/**
 * The newest GitHub Actions check-run named `check` on a commit: "success", "failure", or "" for none or unfinished.
 * @param {string} commit
 * @param {string} check
 * @returns {string}
 */
export function githubCheck(commit, check) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY isn't set, so check runs can't be looked up");
  const conclusion = execFileSync("gh", ["api", `repos/${repo}/commits/${commit}/check-runs?check_name=${encodeURIComponent(check)}`, "--jq", `[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.started_at) | last | .conclusion // ""`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return conclusion === "success" ? "success" : conclusion ? "failure" : "";
}

/** Git's empty tree: as a base it means "every commit". */
export function emptyTree(cwd) {
  return git(["hash-object", "-t", "tree", "/dev/null"], { cwd });
}

/**
 * Whether this script existed in a commit: commits from before the repo adopted
 * the check have no result to find. False when the script runs from outside the repo.
 * @param {string} commit
 * @param {string} [cwd]
 */
function adoptedAt(commit, cwd) {
  const rel = path.relative(realpathSync(git(["rev-parse", "--show-toplevel"], { cwd })), fileURLToPath(import.meta.url));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;
  try {
    git(["cat-file", "-e", `${commit}:${rel.split(path.sep).join("/")}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * The base a push to main is judged from: the newest ancestor of `before`
 * (itself included) on which the check passed. The walk has no limit, so a red
 * commit never ages out. With no pass since the repo adopted the check, the
 * last commit from before it did; with none of those either, the empty tree.
 * @param {string | undefined} before
 * @param {string} [cwd]
 * @param {{ status?: (commit: string) => string, adopted?: (commit: string) => boolean }} [opts]
 * @returns {string | undefined}
 */
export function greenBase(before, cwd, { status = (c) => githubCheck(c, "Review"), adopted = (c) => adoptedAt(c, cwd) } = {}) {
  if (!before || NULL_SHA.test(before)) return before;
  for (const commit of git(["rev-list", "--first-parent", before], { cwd }).split("\n").filter(Boolean)) {
    if (!adopted(commit)) return commit;
    if (status(commit) === "success") return commit;
  }
  return emptyTree(cwd);
}

/**
 * For a commit GitHub made: "" when a merged PR produced it and Review passed on
 * the PR's head, otherwise why not. Asks the GitHub API through `gh`.
 * @param {string} commit
 * @returns {string}
 */
export function githubPrReview(commit) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return "made on GitHub, and GITHUB_REPOSITORY isn't set to look up its PR";
  const pr = execFileSync("gh", ["api", `repos/${repo}/commits/${commit}/pulls`, "--jq", `[.[] | select(.merged_at != null)] | first | if . then "\\(.number) \\(.head.sha)" else "" end`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!pr) return "made on GitHub with no merged PR behind it (an edit in the web editor?)";
  const [number, headSha] = pr.split(" ");
  return githubCheck(/** @type {string} */ (headSha), "Review") === "success" ? "" : `merged from PR #${number}, whose Review didn't pass`;
}

/**
 * The commits in base..head that fail, oldest first. A null or missing base checks head alone.
 * @param {string | undefined} base
 * @param {string} head
 * @param {string} [cwd]
 * @param {{ prReview?: (commit: string) => string, warn?: (w: { commit: string, subject: string, problem: string }) => void }} [opts]
 *   how a GitHub-made commit's PR is checked; where a commit with no tracker reference is reported
 * @returns {{ commit: string, subject: string, problem: string }[]}
 */
export function checkRange(base, head, cwd, { prReview = githubPrReview, warn = () => {} } = {}) {
  const range = !base || NULL_SHA.test(base) ? ["-1", head] : base === emptyTree(cwd) ? [head] : [`${base}..${head}`];
  const commits = git(["rev-list", "--reverse", ...range], { cwd }).split("\n").filter(Boolean).map((commit) => {
    const [author = "", committerEmail = "", subject = ""] = git(["log", "-1", "--format=%an%n%ce%n%s", commit], { cwd }).split("\n");
    const id = reviewId(commit, cwd);
    const stamp = parseStamp(stampOf(commit, cwd));
    return { commit, author, committerEmail, subject, id, stamp, stamped: stamp.id === id && stamp.result === "pass", merge: parentsOf(commit, cwd).length > 1 };
  });

  // A pure revert needs no stamp, and clears the commit it undoes. It must name
  // that commit (`git revert` does), so two unrelated commits with opposite
  // diffs don't cancel. Undoing a revert is a re-apply, and needs its own stamp.
  /** @type {Set<string>} */
  const cancelled = new Set();
  for (const c of commits) {
    if (c.id === "empty" || c.merge) continue;
    const undone = revertTarget(c.commit, c.id, cwd);
    if (!undone || revertTarget(undone, reviewId(undone, cwd), cwd)) continue;
    cancelled.add(c.commit);
    cancelled.add(undone);
  }
  const vouched = new Set(commits.filter((c) => c.stamped).flatMap((c) => trailers(c.commit, VOUCH_TRAILER, cwd)));

  /** @type {{ commit: string, subject: string, problem: string }[]} */
  const problems = [];
  for (const c of commits) {
    if (/\[bot\]$/.test(c.author)) continue;
    const report = { commit: c.commit, subject: c.subject };
    if (cancelled.has(c.commit)) continue;
    if (c.merge) {
      // Nothing can stamp a merge, and main's history can't be rewritten: a vouch is the way out.
      if (!vouched.has(c.commit)) problems.push({ ...report, problem: "a merge commit: rebase instead (already on main? review it, then `vouch` for it)" });
      continue;
    }
    if (!c.stamped && !vouched.has(c.commit)) {
      const why = c.committerEmail === GITHUB_COMMITTER ? prReview(c.commit)
        : !c.stamp.id ? "no review stamp"
        : c.stamp.id !== c.id ? "changed after its review: the stamp is for a different diff"
        : c.stamp.result === "fail" ? "its review failed: fix the findings, review again, and stamp pass"
        : "its stamp records no review result: review again, then stamp pass or fail";
      if (why) problems.push({ ...report, problem: why });
    }
    if (!hasTrackerRef(git(["log", "-1", "--format=%B", c.commit], { cwd }))) warn({ ...report, problem: "references no tracker item (`#123`, `ABC-123`, a link, or a `Refs:` trailer)" });
  }
  return problems;
}

/**
 * Amend HEAD's message with its stamp, replacing an old one.
 * @param {string} result pass or fail
 */
function stampHead(result) {
  if (!RESULTS.includes(result)) throw new Error(`a review result is pass or fail, got ${result || "nothing"}`);
  git(["-c", "trailer.ifexists=replace", "commit", "--amend", "--no-edit", "--no-verify", "--allow-empty", "--trailer", `${TRAILER}: ${reviewId("HEAD")} ${result}`]);
}

/** @param {unknown} err */
function firstLine(err) {
  const e = /** @type {{ stderr?: string, message?: string }} */ (err);
  const lines = String(e.stderr || e.message || err).trim().split("\n");
  return (lines.find((l) => /^(::error|error:|fatal:)/.test(l)) ?? lines[0] ?? "").replace(/^::error title=Review::/, "").trim();
}

/**
 * @param {string} result the review's result: pass or fail
 * @param {string | undefined} base
 */
function stamp(result, base) {
  if (!RESULTS.includes(result)) throw new Error("usage: stamp <pass|fail> [--base <ref>]: record what the review concluded");
  // The remote's default branch, not this branch's upstream: on a pushed
  // feature branch the upstream already has the commits, and nothing would be stamped.
  const upstream = base ?? (() => {
    for (const ref of [["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], ["rev-parse", "--abbrev-ref", "@{upstream}"]]) {
      try {
        return git(ref);
      } catch {
        // try the next
      }
    }
    throw new Error("can't tell which branch to compare with: pass --base <ref>, e.g. --base origin/main");
  })();
  if (git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("commit or stash your changes first: stamping rewrites commit messages");
  const forkPoint = git(["merge-base", upstream, "HEAD"]);
  const todo = git(["rev-list", "--reverse", `${forkPoint}..HEAD`]).split("\n").filter(Boolean);
  if (todo.length === 0) {
    console.log(`nothing to stamp: HEAD has no commits that ${upstream} doesn't`);
    return;
  }
  if (git(["rev-list", "--merges", `${forkPoint}..HEAD`])) throw new Error("merge commits can't be stamped; rebase instead (main's history is linear)");
  const missing = todo.filter((c) => !hasTrackerRef(git(["log", "-1", "--format=%B", c]))).map((c) => git(["log", "-1", "--format=%h %s", c]));
  if (missing.length) console.warn(`warning: ${missing.length === 1 ? "this commit names" : "these commits name"} no issue (\`#123\`, \`ABC-123\`, a link, or a \`Refs:\` trailer; \`Refs: none\` when there is none): ${missing.join(" | ")}`);
  const before = git(["rev-parse", "HEAD"]);
  try {
    if (todo.length === 1) stampHead(result);
    // The script's path goes through the environment, never the shell's command line.
    else git(["rebase", "--quiet", "--force-rebase", "--exec", '"$REVIEW_STAMP_NODE" "$REVIEW_STAMP_SELF" stamp-head "$REVIEW_STAMP_RESULT"', forkPoint], { env: { ...process.env, REVIEW_STAMP_NODE: process.execPath, REVIEW_STAMP_SELF: fileURLToPath(import.meta.url), REVIEW_STAMP_RESULT: result } });
  } catch (err) {
    try {
      git(["rebase", "--abort"]);
    } catch {
      // no rebase in progress
    }
    throw new Error(`stamping stopped (${firstLine(err)}); your branch is unchanged`);
  }
  // Verify after writing: a commit hook can rewrite the message and drop the trailer.
  const bad = checkRange(forkPoint, "HEAD", undefined, { prReview: () => "made on GitHub" })
    .filter((b) => !(result === "fail" && /review failed/.test(b.problem)));
  if (bad.length) {
    git(["reset", "--quiet", "--soft", before]);
    throw new Error(`the stamp didn't take on ${bad.map((b) => b.commit.slice(0, 7)).join(", ")} (${bad[0]?.problem}): is a commit hook rewriting messages? Your branch is unchanged`);
  }
  console.log(`stamped ${todo.length} commit${todo.length === 1 ? "" : "s"} with ${TRAILER}: ${result}`);
  if (result === "fail") console.log("Review will fail these commits: fix the findings, review again, and stamp pass before pushing");
}

/**
 * An empty, stamped commit saying a commit already pushed has now been reviewed, and passed.
 * @param {string | undefined} target
 */
function vouch(target) {
  if (!target) throw new Error("usage: vouch <commit>");
  const sha = git(["rev-parse", "--verify", `${target}^{commit}`]);
  if (git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("commit or stash your changes first");
  const subject = git(["log", "-1", "--format=%s", sha]);
  git(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", `Review ${sha.slice(0, 7)}: ${subject}`, "--trailer", `${VOUCH_TRAILER}: ${sha}`, "--trailer", `${TRAILER}: empty pass`]);
  console.log(`vouched for ${sha.slice(0, 7)} in ${git(["rev-parse", "--short", "HEAD"])}; push it`);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "stamp") {
      const [result = "", ...rest] = args;
      if (!RESULTS.includes(result) || (rest.length && (rest[0] !== "--base" || !rest[1] || rest.length > 2))) throw new Error("usage: stamp <pass|fail> [--base <ref>]: record what the review concluded");
      stamp(result, rest[1]);
    } else if (cmd === "stamp-head") stampHead(args[0] ?? "");
    else if (cmd === "vouch") vouch(args[0]);
    else if (cmd === "id") console.log(reviewId(args[0] ?? "HEAD"));
    else if (cmd === "green-base") {
      if (args.length !== 2) throw new Error("usage: green-base <before> <check>");
      const check = /** @type {string} */ (args[1]);
      console.log(greenBase(args[0], undefined, { status: (c) => githubCheck(c, check) }) ?? "");
    } else if (cmd === "check") {
      const sinceGreen = args[2] === "--since-green" ? args[3] : undefined;
      if (args.length !== 2 && !(args.length === 4 && sinceGreen)) throw new Error("usage: check <base> <head> [--since-green <check>]");
      const base = sinceGreen ? greenBase(args[0], undefined, { status: (c) => githubCheck(c, sinceGreen) }) : args[0];
      const problems = checkRange(base, /** @type {string} */ (args[1]), undefined, {
        warn: (w) => console.log(`::warning title=Review::${w.commit.slice(0, 12)} ${w.subject}: ${w.problem}`),
      });
      for (const p of problems) console.log(`::error title=Review::${p.commit.slice(0, 12)} ${p.subject}: ${p.problem}`);
      if (problems.length) {
        console.log("Before the push: run the agent review, fix its findings until it passes, then `node .github/scripts/review-stamp.mjs stamp pass`. Already on main: `git revert` it, or review it and `node .github/scripts/review-stamp.mjs vouch <sha>`, then push. Main stays red until then.");
        process.exit(1);
      }
      console.log("every commit has an agent review stamp");
    } else throw new Error("usage: review-stamp.mjs stamp <pass|fail> [--base <ref>] | vouch <commit> | check <base> <head> [--since-green <check>] | green-base <before> <check> | id [<commit>]");
  } catch (err) {
    console.error(`::error title=Review::${firstLine(err)}`);
    process.exit(2);
  }
}

// Compare real paths: a raw `file://` comparison is false for a path with a space or a symlink, and the script would do nothing and exit 0.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();

# Shipping

How a change gets from a commit to kith.alxjrvs.com. Orrey follows The Gnar's
`factory:repo-ruleset` ([TheGnarCo/agent-skills](https://github.com/TheGnarCo/agent-skills/tree/main/factory/skills/repo-ruleset))
with **merge `pr`** and **deploy `production`**. The `## Shipping` block in
`CLAUDE.md` is the short version and wins where the two differ.

## The path

1. **Locally:** `bun run typecheck`, `bun run test`, then `/code-review` on the
   diff (ideally from a session that didn't write it) until it passes. Then
   `node .github/scripts/review-stamp.mjs stamp pass --base <the PR's base>`
   writes an `Agent-Reviewed` trailer on each commit. When the review changed
   the code, the commit body lists each finding and what was done. The
   `pre-push` hook (`.githooks/`, turned on by `bun install`) runs all of this
   but the review.
2. **On the PR:** three checks, all required to merge.
   - `CI`: typecheck, tests and the site build (`required-ci.yml`).
   - `Audit`: `bun audit`, failing only on advisories at `high` or above that
     the PR adds (`required-audit.yml`). A weekly `Audit (full)` reports
     everything already on main. Accept one in `.github/audit-allow.txt`.
   - `Review`: every commit carries a matching, passing stamp
     (`required-review.yml`). No model runs in CI; it proves a passing review
     was recorded for that exact diff, nothing more.
3. **Merge:** squash, once green. The stack workflow (`.claude/skills/stack`)
   still applies: bottom PR first, and a human reads it.
4. **Deploy:** when `CI` passes on main, `deploy.yml` waits for `Audit` and
   `Review` on the same commit, deploys it if it is still main's head
   (`bin/deploy`: build, D1 migrations, `wrangler deploy`), then checks
   `HEALTH_URL` answers.
5. **Release:** a verified deploy is tagged `vYYYY.MM.DD` (UTC; a second deploy
   that day is `.2`, then `.3`) and published as a GitHub release with notes
   generated from its PRs. A tag means "this ran in production and answered".
6. **Red main:** `notify-red.yml` posts once when `CI`, `Audit`, `Review` or
   `Deploy` fails on main, and never when green. Whoever broke it fixes or
   reverts it before anything else lands.

## Ways out

| Stuck on | Way out |
|----------|---------|
| A commit without its stamp | review it and `review-stamp.mjs stamp pass` (on a branch), or `vouch <sha>` (on main) |
| A bad commit on main | `git revert <sha>` in a PR; a pure revert needs no stamp |
| An advisory you accept | its ID and a `# reason` in `.github/audit-allow.txt` |
| A deploy that went out bad | `bunx wrangler rollback` to the last good version (the release before it), then revert the commit |
| A Deploy gate that timed out | re-run the Deploy run |

Migrations expand, then contract, so the release before runs on the new
schema and a Worker rollback never needs a schema rollback.

## Admin steps (Jrvs)

These need repo admin, which an agent here doesn't have.

1. **Rulesets.** Until 2026-11-21 `default-branch-protection` required a PR and
   `quality-checks`, with no bypass. It was swapped for the factory's two rulesets
   (history lock; PR plus `CI`, `Audit`, `Review` from GitHub Actions,
   squash or rebase only, admins bypass, maintainers bypass only by PR) from a
   checkout of TheGnarCo/agent-skills:

   ```sh
   node factory/skills/repo-ruleset/scripts/ruleset.mjs apply --repo alxjrvs/orrey \
     --merge pr --deploy production --adopt --dry-run   # look, then drop --dry-run
   ```

   It also restricts the `production` environment to main, sets the workflow
   token to read-only, and turns on Dependabot and secret push protection.
   It doesn't touch the old ruleset (another name), so delete that one too:
   `gh api -X DELETE repos/alxjrvs/orrey/rulesets/23124853`.
   Done 2026-11-21; the old `quality-checks` job is gone.
2. **Production environment.** Move `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` to secrets of the `production` environment (repo
   secrets still work), and add the variable
   `HEALTH_URL=https://kith.alxjrvs.com/healthz`.
3. **Red-main alerts.** Add the Actions secret `SLACK_ALERTS_WEBHOOK_URL`. A
   Discord channel works: create a webhook on it and append `/slack` to its
   URL. Until then the workflow warns and stays green.
4. **Optional:** a tag ruleset on `v*` (no update, no deletion) so a release
   tag can't be moved.

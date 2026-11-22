# Working in this repo

Read [issue #1](https://github.com/alxjrvs/kith/issues/1) first. It is the specification,
and the phase epics below it are the ordered work. This file is the short version of the
rules that are easy to violate by accident.

## Invariants

- **Messages are send-only.** Never call the channel message-edit endpoint. The only write
  to an existing message is `UPDATE_MESSAGE` (type 7) as the response to an interaction
  that came *from* that message. The one exception is the cutover strip-components step.
- **Kith's database is the source of truth.** Discord and Google are projections. Never
  read state back out of a Discord message.
- **Words live in EmDash; state lives in D1.** Every word a visitor reads (game copy,
  characters, knowledge pages, links, the site's own copy) is written in kith-cms
  (`cms/`, admin at cms.kith.town) and read over the `CMS` service binding.
  Anything a rule reads (rosters, attendance, schedules, signups, visibility of a
  table) stays in D1. A game is born in EmDash; its D1 row follows it. `docs/CMS.md`.
- **Discord is the only identity system.** `identify` scope only; roles come from the bot
  token; never request `guilds`.
- **The command surface is four commands.** Administration belongs in the console. If a new
  command seems necessary, that is a sign the console needs a page.
- **Signups attach to campaigns at formation and to game days — never to an individual
  session.** Enforced by a CHECK constraint.
- **Once a campaign has a roster, attendance is unanimous.** Silence is in, and one
  `out` from a roster member means the evening moves — to a date poll, never to a
  cancellation. A quorum is what a table still being *found* is measured by: a
  forming campaign, a game day. `campaigns.quorum` is the opt-out and the only one,
  and which rule applies is derived in `src/attendance/quorum.ts` rather than stored.
  Nothing else may decide it a second way.
- **Never write to the user's Social calendar.** Kith writes only to the Kith calendar.
- **Test games never reach prod.** A campaign or game marked `staging` posts only to the
  Staging channels, stays off Google and server-wide events, and is organisers-only on the
  site. Every read of the scheduling channel goes through `src/projection/staging.ts`.
- Every component id goes through `src/discord/custom-id.ts`. Unknown ids must degrade to
  the retired-post response, never to "interaction failed".

## Shape

One Worker, three entry points: HTTP (interactions + console + ICS), a queue consumer
(outbound projection), and cron (the clock). Time-based work lives in the D1 `jobs` table,
not in a queue, so it can be inspected and re-run.

Domain tables arrive with the phase that uses them — don't add schema ahead of the phase.

## How work lands

A phase is cut as a stack of small PRs, reviewed and merged bottom-first:
`.claude/skills/stack/SKILL.md` is the workflow, `docs/PHASE-1-STACK.md` is phase 1's
slicing, and `npm run stack -- status p1` is where the chain's state lives.

## Shipping

- Ruleset: factory:repo-ruleset (this block wins where it differs)
- Merge: pr. Every change reaches main by a squash-merged PR with `CI`, `Audit` and `Review` green
- Deploy: production. A green main deploys and is tagged `vYYYY.MM.DD[.N]` as a GitHub release
- Always a PR: everything, including `.github/`
- Before pushing: tests, main green, /code-review, then
  `node .github/scripts/review-stamp.mjs stamp pass`. Never stamp without the review
- Red main: notify-red.yml alerts the channel in `SLACK_ALERTS_WEBHOOK_URL`; fix or revert before landing anything else

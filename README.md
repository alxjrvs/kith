# The Orrey

Campaign and game-day scheduling for **the Orrey of Worlds** — a Discord bot and a small
console, running as one Cloudflare Worker.

Orrey's own database is the source of truth. Discord and Google Calendar are displays.

> **Status: phase 0.** Footings only. Nothing has been cut over yet.
> The plan this is being built to is [issue #1](https://github.com/alxjrvs/orrey/issues/1)
> — the specification, with a phase epic and ordered issues under it.

## Three premises

1. **Orrey is a reconciler, not a replicator** — for Google events and Discord scheduled
   events. Discord *messages* are send-only and are never reconciled.
2. **There are three questions, not one.** *Which day?* → *who's in?* → *still coming?*
   Consecutive stages with different audiences; any event may skip any of them.
3. **Discord is identity.** `identify` scope alone; roles read with the bot token;
   `guilds` never requested.

The central question is **"does it run"** — quorum, not just a date on a calendar. When the
answer is no, the response is a date poll, not a cancellation.

## Send-only messages

Orrey never edits a post it has already sent. The single exception: **a click may rewrite
the message it came from**, as that interaction's own response. No cron, queue consumer or
console action ever touches a posted message.

That buys three things — the 15-minute interaction token stops mattering, message rate
limits stop being a design concern, and Discord projection narrows to scheduled events.
It costs one: posts are snapshots and go stale. Hence every post carries an *as-of* line
and a **Refresh** button, and anything that changes from outside posts a *new* notice
rather than mutating an old message.

## Layout

```
src/
  index.ts            Worker entrypoint — fetch, queue, scheduled
  http/app.ts         Hono router; signature check before anything else
  discord/
    verify.ts         Ed25519 over `timestamp + body`
    interactions.ts   PING / COMMAND / AUTOCOMPLETE / COMPONENT / MODAL
    custom-id.ts      Namespaced ids; unknown ids fall through as "retired post"
    commands.ts       The whole command surface: four commands
    rest.ts           Bot-token REST client
  db/schema.ts        The footings (users, settings, jobs) and the phase-1 domain
  jobs/drain.ts       Leased claim-and-run over the jobs table
  queue/consumer.ts   Outbound projection: Google + Discord scheduled events
  cron/scheduled.ts   The clock — minute, hourly, daily, nightly
  do/                 Per-guild rate-limit governor; per-session click lock
scripts/
  register-commands.ts  Bulk overwrite of the guild command set
  seed-session.ts       SQL for the one hardcoded campaign and its next session
  stack.ts              Status, restack and push for a stacked PR train
web/                  The site: React 19, TanStack Router + Query, Vite → dist/
public/               Copied into dist/ as-is: the old organiser console, privacy page
```

## Getting started

Bun workspaces: the root package is the Worker, `web/` is the site it serves.

```sh
bun install
cp .dev.vars.example .dev.vars      # fill in the Discord application secrets

bunx wrangler d1 create orrey       # paste database_id into wrangler.jsonc
bun run db:generate                 # drizzle-kit → ./drizzle
bun run db:migrate:local

bun run build && bun run dev        # the Worker on :8787, serving dist/
bun run dev:web                     # the site with hot reload on :5173, proxying the Worker
```

`bun run dev` serves `/interactions` locally; point a tunnel at it to exercise real
interactions, or POST a signed request yourself. The Worker's tests stay on Vitest
(`bun run test`), because the Workers test pool runs inside workerd.

## Deploying

`bun run deploy` builds the site and runs `wrangler deploy`. On GitHub, the Deploy
workflow does the same after CI passes on `main`, and applies D1 migrations first;
it needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## How the work is cut

A phase lands as a **stack** of small PRs — each based on the one before it, all open
at once, merged bottom-first and restacked after each merge. The workflow is
`.claude/skills/stack/SKILL.md`; phase 1's eight slices are planned in
[`docs/PHASE-1-STACK.md`](docs/PHASE-1-STACK.md).

```sh
bun run stack -- status p1 --prs      # the chain, its drift, and each PR's state
bun run stack -- restack p1 --apply   # replay the stack after the bottom PR merges
bun run stack -- push p1 --apply      # --force-with-lease, in order
```

## The custom domain

The Worker answers at **orrey.alxjrvs.com** (a Workers Custom Domain, declared in
`wrangler.jsonc`) as well as at orrey.alxjrvs.workers.dev, which stays on. Code derives
its origin from the request, so the deploy alone changes nothing users see. Three steps
outside the repo move people over:

- **Discord developer portal, OAuth2:** add `https://orrey.alxjrvs.com/console/callback`
  as a redirect. Keep the workers.dev one until nothing uses it.
- **Discord developer portal, Interactions Endpoint URL:** set it to
  `https://orrey.alxjrvs.com/interactions`. `/console` login links and the privacy link
  are built from the interaction's origin, so this is the switch that sends people to the
  new hostname. Discord validates on save, so deploy first.
- **Google:** verify orrey.alxjrvs.com in the Google console, *then* change
  `PUBLIC_ORIGIN`. Google refuses push channels to an unverified domain, so changing the
  var first would break the next channel renewal.

## Cutover, when it comes

Orrey reuses the existing **Hermuz** Discord application rather than registering a new one,
which inherits guild permissions and authorship of the scheduled events and roles Hermuz
created. Two things about that are worth knowing before the switch is thrown:

- **Saving an Interactions Endpoint URL stops Discord delivering interactions over the
  gateway.** Hermuz goes deaf the moment it is saved. There is no overlap period.
- Discord validates the endpoint on save — including with a deliberately bad signature it
  expects a **401** for — so **the Worker must already be deployed and verifying.**

The rest of the cutover: drop the two privileged intents, bulk-overwrite the command set
(`npm run commands:register`), strip components from Hermuz's old interactive posts, and
rotate the bot token and client secret.

**No data is imported.** Four campaigns are entered by hand; only the Discord ids — guild,
per-campaign roles and channels, live scheduled events — are carried across.

## Platform constraints worth not rediscovering

- Discord cannot own recurrence: weekly means exactly one weekday, and `count` / `end`
  cannot be set externally. Orrey owns the cadence (anchor + interval in weeks).
- Discord has no yes/no/maybe — the event user list has no response field.
- Google's `syncToken` is incompatible with `timeMin`, `q` and `privateExtendedProperty`,
  which is why Orrey has a calendar of its own.
- Discord's `COMPLETED` / `CANCELED` statuses are terminal and fire automatically, so
  moving a lapsed session means minting a *new* Discord event.
- 100 scheduled events per guild; 5 buttons per row, so a 10-date poll needs a multi-select.
- Bot DMs cannot be pre-checked — error `50007` is how you find out. Treat it as permanent
  and fall back to a channel mention.
- Google upsert: mint your own base32hex id, `insert`, and on `409` `update`.
- `events.watch` carries no body, has a 7-day TTL, does not auto-renew, and is not 100%
  reliable. Hence the nightly reconcile.
- Discord's terms require a stated privacy policy and a delete-my-data path.

## License

MIT.

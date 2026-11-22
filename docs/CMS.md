# Kith's CMS

Every word a visitor reads on kith.alxjrvs.com is written in
[EmDash](https://github.com/emdash-cms/emdash), Cloudflare's Astro CMS, the
same one alxjrvs.com uses. It runs on its own Worker, **kith-cms** (`cms/`),
with its own D1 database, R2 bucket and KV namespace. Its admin is at
**cms.kith.alxjrvs.com**, behind Cloudflare Access.

The Kith Worker reads published entries from EmDash's content API over a
`CMS` service binding, with a read-only API token. It never reads EmDash's
tables directly, and never writes to EmDash.

## What lives where

| EmDash (words)                                   | D1 (state)                                         |
| ------------------------------------------------ | -------------------------------------------------- |
| Games: name, category, system, tagline, summary, pitch, hero, cover, sound | Campaigns and board games as things that are scheduled: cadence, quorum, capacity, Discord channel and role |
| Characters: name, sheet link, game, player       | Rosters: who is on a table, and as what role        |
| Knowledge pages and links, with who may see them | Sessions, attendance, game days, signups, polls     |
| The site's own copy (`sections`)                 | Users, feeds, settings, the audit log, jobs        |

The rule of thumb: if a rule reads it (attendance, quorum, who sees a table),
it is D1. If a person reads it, it is EmDash.

**A game is born in EmDash.** Publishing a new entry in Games creates its row
in Kith within a minute, with the entry's name and visibility. Its slug is its
address, `kith.alxjrvs.com/games/<slug>`. From then on its name, visibility,
schedule and Discord wiring are set in Organise, as before: the sync only
ever creates, so the two never undo each other.

**A character belongs to a game and a player.** `game` is the game's slug and
`player` is the player's Discord username or Discord user id (an id survives
a rename). Kith shows the character beside the
player on that game's roster, linking to `sheet`. Whether the player is on the
roster at all is still D1's answer.

**Where Kith reads it** (`src/cms/`): a campaign's tagline, pitch, hero,
sound, system and logo (its cover, worn above its title and on its card)
(`src/hub/listings.ts`); a board game's summary and cover, and its art on
its game days (`src/hub/catalog.ts`); characters and sheet links on rosters
(`src/hub/home-base.ts`); a campaign's pages and links (`src/hub/knowledge.ts`);
uploaded files at `/media/<key>`. Where a game has no entry in EmDash yet, its
words still come from D1, and a campaign's pages and links from D1 are listed
after EmDash's, until they are moved over. A game day's own words stay in D1.
Published changes show within 30 seconds (`CMS_TTL_MS`).

The content model is `cms/seed/seed.json`. The setup wizard applies it to a
fresh database; after that, collections and fields are edited in the admin
(Content types), and `seed/seed.json` is kept in step by hand
(`bunx emdash export-seed`).

## Setting it up (once)

1. **Create its storage.** On a machine where wrangler is signed in to the
   Cloudflare account: `bin/cms-setup`. It creates `kith-emdash` (D1),
   `kith-emdash-media` (R2) and `kith-cms-sessions` (KV), and writes their ids
   into `cms/wrangler.jsonc`. Commit that.
2. **Put the admin behind Access.** Zero Trust → Access → Applications → the
   app that guards admin.alxjrvs.com → add `cms.kith.alxjrvs.com` as another
   public hostname. `cms/wrangler.jsonc` already names that app's AUD tag. (If
   Kith gets its own Access app instead, put its AUD in `CF_ACCESS_AUDIENCE`.)
   Do this before the first deploy, so the admin is never reachable without it.
3. **Deploy.** Merging to main deploys kith-cms before the Kith Worker
   (`bin/deploy`). Until step 1 is committed, the deploy skips kith-cms.
4. **Run the setup wizard** at cms.kith.alxjrvs.com. It applies the content
   model and makes you its admin.
5. **Give Kith a token.** In the admin, Settings → API tokens → a token with
   only `content:read`. Then `bunx wrangler secret put CMS_TOKEN --name orrey`.

## Locally

```sh
bun run dev:cms   # http://localhost:4321/_emdash/admin, local passkey
```

Locally EmDash uses a throwaway D1 under `cms/.wrangler/`; the setup wizard
seeds it from `cms/seed/seed.json`.

## Upgrades and recovery

Never merge an EmDash or Astro upgrade unread: a new EmDash can carry database
migrations, and production runs them on its first request. A Worker rollback
does not undo one. `bunx wrangler d1 time-travel restore kith-emdash
--timestamp <ISO time>` rewinds the database to any minute in the last 30
days. Uploaded files live in `kith-emdash-media`, which that does not cover.

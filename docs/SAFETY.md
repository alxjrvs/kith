# The stop sign and the suggestion box

Every game's home base (`/games/<slug>`) has both, for anybody signed in who can
see that game. The code is `src/hub/safety.ts`.

## The stop sign

A safety tool, like the X-card. Pressing it asks once ("Press the stop sign?"),
then:

1. writes a `stop_signs` row (who, which game, when);
2. posts a short alert naming them in the game's Discord channel: the campaign's
   own channel, or the scheduling channel when it has none (a board game always
   uses the scheduling channel). A test game's goes to the Staging channel, by
   the usual rule in `src/projection/staging.ts`;
3. emails the organiser who pressed it and for which game.

Two presses by the same person on the same game within two minutes are one
press. Whatever doesn't go out straight away is retried by the
`stop-sign.deliver` job: the Discord alert for half an hour (after that the
evening has moved on, and a late alert alarms more than it helps), the email
for a day. An alert Discord never confirmed (a timeout, a 5xx) is
not sent again, because a second alert is worse than a missing confirmation.
The console lists every press under **Stop signs**, with whether the alert and
the email went.

### Setting up the email

The email goes through Cloudflare Email (the `send_email` binding). It is set up
(2026-11-23): Email Routing is on for kith.town, the organiser's address is a
verified destination and the `STOP_SIGN_EMAIL_TO` secret, and the binding is in
`wrangler.jsonc`. To set it up again from nothing:

1. In the Cloudflare dashboard, open the kith.town zone, then **Email > Email
   Routing**, and turn it on. It adds the DNS records it needs.
2. Under **Destination addresses**, add the address the alerts should go to and
   click the link in the verification email.
3. Set that address as a secret: `wrangler secret put STOP_SIGN_EMAIL_TO`.
4. Keep the binding in `wrangler.jsonc` and deploy:

   ```jsonc
   "send_email": [{ "name": "EMAIL" }]
   ```

The mail comes from `kith@kith.town` (override with the `EMAIL_FROM` var).

## The suggestion box

A note for the organiser, with a name or without one. Nothing goes to Discord.
The console lists them under **Suggestion box**, where each can be marked read.

Anonymous means it: the row has no author, there is no audit entry, nothing is
logged, and only the day is kept rather than the time, so a small table can't
work out who wrote it from when it arrived. The table is `WITHOUT ROWID`, so
not even SQLite's hidden row number records the order suggestions came in, and
the console breaks same-day ties by the random id.

/**
 * The console, as one module and no build step.
 *
 * It reads and renders and does nothing else yet — the write half is the PR
 * above this one. Everything it shows comes from Kith's own API, which reads
 * D1: nothing here asks Discord what it holds.
 */
const main = document.getElementById("main");
const status = document.getElementById("status");

/**
 * The header's avatar, as the site shows it: their Discord picture, or their
 * initials. Read once, on its own, so the rest of the page never waits on it.
 */
async function fillHeader() {
  const avatar = document.getElementById("avatar");
  const me = await fetch("/api/hub/me", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!avatar || !me?.signedIn) return;
  avatar.setAttribute("aria-label", `Your profile, ${me.user.name}`);
  if (me.user.avatarUrl) {
    const img = document.createElement("img");
    img.src = me.user.avatarUrl;
    img.alt = "";
    avatar.replaceChildren(img);
  } else {
    avatar.textContent = me.user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }
}
void fillHeader();

/** Every response is JSON; the interesting part is what a refusal means. */
async function api(path, init) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(init ?? {}),
    ...(init?.body === undefined ? {} : { headers: { "content-type": "application/json" } }),
  });

  if (response.status === 401) throw new Refusal("Not signed in. Sign in with Discord on the front page.");
  if (response.status === 403) throw new Refusal("That is an organiser's to do.");
  if (response.status === 503) {
    const body = await response.json().catch(() => ({}));
    throw new Refusal(body.error ?? "Kith is not configured yet.");
  }
  // 400 is the domain saying no to what was asked — a sentence meant to be read,
  // not a failure to log.
  if (response.status === 400) {
    const body = await response.json().catch(() => ({}));
    throw new Refusal(body.error ?? "Kith would not take that.");
  }
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);

  return response.json();
}

class Refusal extends Error {}

function text(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/** Unix seconds to something a person reads, in their own zone. */
function when(seconds) {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function cadence(campaign) {
  if (!campaign.intervalWeeks) return "—";
  const every = campaign.intervalWeeks === 1 ? "Weekly" : `Every ${campaign.intervalWeeks} weeks`;
  return `${every}, from ${when(campaign.recurrenceAnchor)}`;
}

/** An element, its class, and its words, in one line. */
function el(tag, className, words) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (words !== undefined && words !== null) node.textContent = words;
  return node;
}

function cell(row, value, className) {
  const td = el("td", className, value);
  row.append(td);
  return td;
}

/** A table's header row, from [label, className] pairs or bare labels. */
function headRow(table, columns) {
  const head = document.createElement("tr");
  for (const column of columns) {
    const [label, className] = Array.isArray(column) ? column : [column, ""];
    head.append(el("th", className, label));
  }
  const thead = document.createElement("thead");
  thead.append(head);
  table.append(thead);
}

/** Every table scrolls sideways inside itself on a narrow screen; the page never does. */
function wrapTable(table) {
  const wrap = el("div", "table-wrap");
  wrap.append(table);
  return wrap;
}

/** A first sub-line under a name: a place, an id, a time. */
function subline(words, className = "muted") {
  return el("div", className, words);
}

/**
 * Where a thing stands, as a word and not a code: the site's pill, in sentence
 * case. Colour follows meaning: going ahead is green, needing an eye is amber,
 * off is red, still to come is ember, and over is quiet.
 */
const STATE_WORDS = {
  // Campaigns
  FORMING: ["Forming", "accent"],
  RUNNING: ["Running", "in"],
  HIATUS: ["On a break", "maybe"],
  CONCLUDED: ["Finished", "done"],
  // Sessions
  SCHEDULED: ["Scheduled", "accent"],
  JEOPARDY: ["Short", "maybe"],
  CONFIRMED: ["Confirmed", "in"],
  LOCKED: ["Locked in", "in"],
  PLAYED: ["Played", "done"],
  CANCELLED: ["Called off", "out"],
  // Game days
  PROPOSED: ["Proposed", "accent"],
  SEATING: ["Seating", "in"],
};

function statePill(state) {
  const [words, tone] = STATE_WORDS[state] ?? [state.charAt(0) + state.slice(1).toLowerCase(), ""];
  const pill = el("span", `pill ${tone}`.trim(), words);
  pill.dataset.state = state;
  return pill;
}

function stateCell(row, state) {
  const td = el("td");
  td.append(statePill(state));
  row.append(td);
  return td;
}

/**
 * One panel of the page, as the site draws them: a heading, an optional line
 * saying what it is for, and its body. `id` is where the jump links land.
 */
function panel(id, title, lede, ...children) {
  const section = el("section", "panel");
  section.id = id;
  const head = el("div", "panel-head");
  head.append(el("h2", null, title));
  if (lede) head.append(el("p", "lede", lede));
  const body = el("div", "panel-body");
  body.append(...children.filter(Boolean));
  section.append(head, body);
  return section;
}

/** A titled part of a panel, under a rule. */
function subsection(title, ...children) {
  const box = el("div", "sub");
  if (title) box.append(el("h3", null, title));
  box.append(...children.filter(Boolean));
  return box;
}

function emptyNote(words) {
  return el("p", "empty", words);
}

function campaignsTable(campaigns) {
  if (campaigns.length === 0) return emptyNote("No campaigns yet. Make one below.");
  const table = document.createElement("table");
  headRow(table, [
    "Campaign",
    "Where it stands",
    "Game",
    "How often",
    ["Players", "numeric"],
    ["Sessions", "numeric"],
    ["", "actions"],
  ]);

  const body = document.createElement("tbody");
  for (const campaign of campaigns) {
    const row = document.createElement("tr");

    const name = cell(row, "");
    const open = el("button", "link", campaign.name);
    open.type = "button";
    open.setAttribute("aria-expanded", String(campaignState.selected === campaign.id));
    open.addEventListener("click", () => {
      // Toggling rather than only opening: a second click on the name you just
      // opened is the obvious way back out of a long page.
      campaignState.selected = campaignState.selected === campaign.id ? null : campaign.id;
      load();
    });
    name.append(open, subline(campaign.id, "faint"));
    if (campaignState.selected === campaign.id) row.setAttribute("aria-selected", "true");

    stateCell(row, campaign.state);
    cell(row, text(campaign.gameName ?? campaign.gameId));
    cell(row, cadence(campaign));
    cell(row, String(campaign.members), "numeric");
    cell(row, String(campaign.sessions), "numeric");
    lifecycleCell(row, campaign);

    body.append(row);
  }
  table.append(body);
  return wrapTable(table);
}

function gamesTable(games) {
  if (games.length === 0) return emptyNote("No games yet.");
  const table = document.createElement("table");
  headRow(table, [
    "Game",
    ["Players", "numeric"],
    ["Usual length", "numeric"],
    "Played in",
    "Test game",
    ["", "actions"],
  ]);

  const body = document.createElement("tbody");
  for (const game of games) {
    const row = document.createElement("tr");
    const name = cell(row, game.name);
    name.style.fontWeight = "600";
    cell(
      row,
      game.minPlayers || game.maxPlayers
        ? `${text(game.minPlayers)}–${text(game.maxPlayers)}`
        : "Any",
      "numeric",
    );
    cell(row, game.defaultDurationMinutes ? lengthOf(game.defaultDurationMinutes) : "—", "numeric");
    heldBy(row, game);
    gameActions(row, game);
    body.append(row);
  }
  table.append(body);
  return wrapTable(table);
}

/** Minutes as somebody would say them: "2½ hours", not "150 min". */
function lengthOf(minutes) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  const whole = Math.floor(hours);
  const half = hours - whole >= 0.5 ? "½" : "";
  return `${whole}${half} ${whole === 1 && !half ? "hour" : "hours"}`;
}

/**
 * The agenda: the worklist, and the record.
 *
 * Two views, and the split is the whole point of the panel. **What I'm
 * scheduling** is sessions still waiting on something. **What's confirmed**
 * is the record, not the work, and carries no action.
 *
 * It reads `/api/agenda` and nothing else. Nothing here is derived in the
 * browser — not the quorum, not the tally, and not the day a session falls on,
 * which is a fact about the table rather than about the reader's laptop.
 */
const UNSETTLED = new Set(["SCHEDULED", "JEOPARDY"]);

const AGENDA_VIEWS = {
  scheduling: {
    title: "What I'm scheduling",
    lede: "Sessions still waiting on something: an answer, a poll, or a post.",
    empty: "Nothing outstanding. Every session in the window has an answer.",
    match: (row) => UNSETTLED.has(row.state),
    filters: {
      All: () => true,
      "Short of players": (row) => row.inJeopardy,
      "Not yet asked": (row) => row.tally.in + row.tally.out + row.tally.maybe === 0,
    },
  },
  confirmed: {
    title: "What's confirmed",
    lede: "Going ahead, posted to Discord and on the calendar. Nothing here needs you.",
    empty: "Nothing confirmed in this window yet.",
    match: (row) => !UNSETTLED.has(row.state),
    filters: {
      All: () => true,
      "Campaign sessions": (row) => row.campaignId !== null,
      "Game days": (row) => row.gameDayId !== null,
    },
  },
};

const agendaState = { mode: "scheduling", grouped: true, filter: "All", selected: null };

function segmented(options, value, onChange, label) {
  const wrap = el("div", "segmented");
  wrap.setAttribute("role", "group");
  if (label) wrap.setAttribute("aria-label", label);
  for (const option of options) {
    const button = el("button", null, option);
    button.type = "button";
    if (option === value) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => onChange(option));
    wrap.append(button);
  }
  return wrap;
}

/**
 * Does it run, in a phrase — the same answer the attendance post gives.
 *
 * Under the veto rule a tally is the wrong shape of sentence: "3 of 5 in" over a
 * session that is going ahead reads as a shortfall. So the line is the
 * standing, and the counts stay in the bar beside it.
 *
 * `tally` is optional because the session rail has no bar, so there the count
 * has to be in the sentence or it is nowhere. (Where there is a bar, it is built
 * from every answer while `vetoes` counts only seats, so the sentence must not
 * deny a red segment drawn under it.)
 */
function standingLine(quorum, tally) {
  if (quorum.rule === "unanimous") {
    if (quorum.vetoes.length > 0) {
      return `Has to move: ${quorum.vetoes.length} of ${quorum.roster} can't make it`;
    }
    return tally
      ? `Going ahead, ${quorum.roster} on the roster`
      : `Going ahead, nobody out of ${quorum.roster}`;
  }

  if (quorum.required !== null) return `${quorum.saidIn} of ${quorum.required} needed are in`;
  return tally ? `${tally.in} in, ${tally.noReply} not heard from` : `${quorum.saidIn} in`;
}

/** In / maybe / out against the roster, as a bar and a sentence. */
function quorumMeter(row) {
  const td = el("td");
  const bar = el("div", "meter");
  for (const [kind, n] of [
    ["in", row.tally.in],
    ["maybe", row.tally.maybe],
    ["out", row.tally.out],
    ["none", row.tally.noReply],
  ]) {
    if (n === 0) continue;
    const part = el("span");
    part.dataset.kind = kind;
    part.style.flexGrow = String(n);
    bar.append(part);
  }
  td.append(bar, subline(standingLine(row.quorum, row.tally)));
  return td;
}

function agendaTable(rows) {
  const table = document.createElement("table");
  const columns = agendaState.grouped
    ? ["Session", "Who's in", "Where it stands"]
    : ["When", "Session", "Who's in", "Where it stands"];
  headRow(table, columns);

  const body = document.createElement("tbody");
  let lastDay = null;

  for (const row of rows) {
    if (agendaState.grouped && row.day !== lastDay) {
      const header = el("tr", "day");
      // The label comes from the server, in the guild's zone.
      const th = el("th", null, row.dayLabel);
      th.colSpan = columns.length;
      header.append(th);
      body.append(header);
      lastDay = row.day;
    }

    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    if (agendaState.selected === row.sessionId) tr.setAttribute("aria-selected", "true");
    const pick = () => {
      agendaState.selected = row.sessionId;
      load();
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter") pick();
    });

    if (!agendaState.grouped) cell(tr, when(row.startsAt), "num");

    const title = cell(tr, row.title);
    title.style.fontWeight = "600";
    title.append(
      subline(
        agendaState.grouped
          ? [time(row.startsAt), row.location].filter(Boolean).join(", ")
          : text(row.location),
      ),
    );

    tr.append(quorumMeter(row));
    stateCell(tr, row.state);

    body.append(tr);
  }

  table.append(body);
  return wrapTable(table);
}

/** Just the time of day, for a row that already sits under its day's header. */
function time(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The session beside the agenda: who said what, whether it reached the
 * calendar, and the three things an organiser can do to it.
 *
 * Projection state sits here rather than behind a button, because it is
 * ambient. A dead event link is expected rather than broken: a lapsed Discord
 * event is replaced rather than revived.
 */
function detailRail(detail) {
  const rail = el("aside", "rail");
  rail.setAttribute("aria-label", "The session you picked");

  if (!detail) {
    rail.append(el("p", "muted", "Pick a session to see who's coming and what's left to do."));
    return rail;
  }

  const head = el("div");
  head.append(el("h3", null, detail.title));
  head.append(el("p", "muted num", [when(detail.startsAt), detail.location].filter(Boolean).join(", ")));
  rail.append(head);

  const standing = el("div", "buttons");
  standing.append(statePill(detail.state), el("span", "muted small", standingLine(detail.quorum)));
  rail.append(standing);

  rail.append(
    rosterList(detail.roster),
    syncLog(detail.sync),
    railLinks(detail),
    railActions(detail),
    logList(detail.logs),
    recapForm(detail),
  );
  return rail;
}

/**
 * What was written down about the evening, oldest first.
 *
 * Absent rather than empty when there is nothing: most sessions have not
 * happened yet, and a heading over nothing reads as a page that failed to load.
 */
function logList(logs, heading = true) {
  const box = el("div");
  if (!logs || logs.length === 0) return box;

  box.className = "logs";
  if (heading) box.append(el("h4", null, "Written up"));

  for (const entry of logs) {
    const article = el("article");
    // `authorName` falls back to the id on a cache that has not caught up.
    const by = el("p", "muted small", `${entry.authorName}, ${when(entry.createdAt)}`);
    // `textContent`, and a wrapping style rather than markup: a recap keeps its
    // newlines and is somebody else's text.
    const body = el("p", "log-body", entry.body);
    article.append(by, body);
    box.append(article);
  }
  return box;
}

/**
 * The second door on to `writeRecap`: the console route calls the same
 * function the Discord modal calls, so a recap here lands in the same row and
 * the same thread.
 */
function recapForm(detail) {
  const form = el("form");
  // A session that has not happened has nothing to write up yet.
  if (detail.state !== "PLAYED") return form;

  form.className = "field";
  form.style.gap = "8px";
  const label = el("label", null, "Write up how it went");
  const body = el("textarea");
  body.name = "body";
  body.id = "recap-body";
  label.htmlFor = body.id;
  body.rows = 6;
  body.maxLength = 4000;

  const submit = el("button", "primary", "Post the recap");
  submit.type = "submit";
  submit.style.alignSelf = "flex-start";
  form.append(label, body, submit);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    await act(async () => {
      try {
        await api(`/api/sessions/${detail.sessionId}/recap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: body.value }),
        });
      } finally {
        submit.disabled = false;
      }
    });
  });

  return form;
}

/**
 * The three writes, each behind one sentence of confirmation: all three are
 * hard to take back. Cancelling posts a message nobody can unpost; locking does
 * not unlock; opening a poll claims the session until it closes.
 *
 * Each calls the domain function the bot calls. There is no second cancel here.
 */
function railActions(detail) {
  const box = el("div", "buttons");
  // Nothing left to do to a session that is over or already off.
  if (detail.state === "PLAYED" || detail.state === "CANCELLED") return box;

  const id = encodeURIComponent(detail.sessionId);

  if (detail.state !== "LOCKED") {
    box.append(
      action("Lock it in", `Lock in ${detail.title}? It can't be unlocked.`, () =>
        api(`/api/sessions/${id}/lock`, { method: "POST", body: "{}" }),
      ),
    );
  }

  box.append(
    action("Suggest another day", `Open a poll to move ${detail.title}?`, () => {
      const dates = prompt("Which days might work? One per line.");
      if (!dates) return null;
      return api(`/api/sessions/${id}/poll`, {
        method: "POST",
        body: JSON.stringify({ dates }),
      });
    }),
    action(
      "Call it off",
      `Call off ${detail.title}? The thread is told and the calendar cleared.`,
      () => api(`/api/sessions/${id}/cancel`, { method: "POST", body: "{}" }),
      "danger",
    ),
  );

  return box;
}

function action(label, confirmation, work, className) {
  const button = el("button", className ? `small ${className}` : "small", label);
  button.type = "button";
  button.addEventListener("click", async () => {
    if (confirmation && !confirm(confirmation)) return;
    button.disabled = true;
    await act(async () => {
      const started = work();
      if (started) await started;
    });
  });
  return button;
}

const INTENT_WORDS = { in: "In", maybe: "Maybe", out: "Can't make it" };

/** Intent and attended side by side. No reply is its own answer, never "out". */
function rosterList(roster) {
  const list = el("dl", "people");
  for (const row of roster) {
    const said = el("dd");
    said.dataset.intent = row.intent ?? "none";
    said.textContent = [
      row.intent ? INTENT_WORDS[row.intent] ?? row.intent : "Not heard from",
      row.attended === null ? null : row.attended ? "came" : "didn't come",
      row.corrected ? "(corrected)" : null,
      row.note ? `“${row.note}”` : null,
    ]
      .filter(Boolean)
      .join(", ");
    list.append(el("dt", null, row.name), said);
  }
  return list;
}

function syncLog(sync) {
  const box = el("p", "sync");
  box.dataset.state = sync.state;
  box.textContent =
    sync.state === "not-projected"
      ? "Not on the calendar yet."
      : sync.state === "failing"
        ? `The last calendar update failed: ${sync.lastError}`
        : `On the calendar, updated ${when(sync.syncedAt)}.`;
  return box;
}

function railLinks(detail) {
  const links = el("p", "links");
  for (const [label, href] of [
    ["Discord thread", detail.threadUrl],
    ["Discord event", detail.eventUrl],
  ]) {
    if (!href) continue;
    const a = el("a", null, `${label} ↗`);
    a.href = href;
    a.rel = "noreferrer";
    a.target = "_blank";
    links.append(a);
  }
  return links;
}

function agendaSection(agenda) {
  const view = AGENDA_VIEWS[agendaState.mode];
  const filters = Object.keys(view.filters);
  if (!filters.includes(agendaState.filter)) agendaState.filter = "All";

  const rows = agenda.rows.filter(view.match).filter(view.filters[agendaState.filter]);

  const section = el("section");
  section.setAttribute("aria-label", view.title);

  const controls = el("div", "controls");
  controls.append(
    segmented(
      Object.keys(AGENDA_VIEWS).map(modeLabel),
      modeLabel(agendaState.mode),
      (label) => {
        agendaState.mode = label === modeLabel("scheduling") ? "scheduling" : "confirmed";
        agendaState.filter = "All";
        load();
      },
      "Which sessions",
    ),
    segmented(
      filters,
      agendaState.filter,
      (value) => {
        agendaState.filter = value;
        load();
      },
      "Narrow it down",
    ),
    segmented(
      ["By day", "One list"],
      agendaState.grouped ? "By day" : "One list",
      (value) => {
        agendaState.grouped = value === "By day";
        load();
      },
      "Layout",
    ),
  );
  section.append(controls, el("p", "muted", view.lede));

  section.append(rows.length === 0 ? emptyNote(view.empty) : agendaTable(rows));
  section.append(el("p", "faint small", `Up to date as of ${when(agenda.asOf)}.`));

  return section;
}

function modeLabel(mode) {
  return AGENDA_VIEWS[mode].title;
}

function gameDaysTable(days) {
  if (days.length === 0) return emptyNote("No game days on the calendar.");
  const table = document.createElement("table");
  headRow(table, [
    "Day",
    "Where it stands",
    "When",
    "Where",
    ["Seated", "numeric"],
    ["Waiting", "numeric"],
    ["", "actions"],
  ]);

  const body = document.createElement("tbody");
  for (const day of days) {
    const row = document.createElement("tr");

    const name = cell(row, text(day.gameName ?? day.title ?? "Game day"));
    name.style.fontWeight = "600";
    name.append(subline(day.kind === "multi" ? `Several tables, ${day.id}` : day.id, "faint"));

    stateCell(row, day.state);
    cell(row, when(day.startsAt), "num");
    cell(row, text(day.venue));
    // The seat count as the day itself knows it, never as the post shows it.
    cell(row, day.capacity ? `${day.seated} of ${day.capacity}` : String(day.seated), "numeric");
    cell(row, day.waitlisted === 0 ? "—" : String(day.waitlisted), "numeric");
    dayLifecycleCell(row, day);

    body.append(row);
  }
  table.append(body);
  return wrapTable(table);
}

/** What a day in this state may do next. `src/game-days/lifecycle.ts` holds the
 *  map that decides; this is the same shape, for buttons. */
const DAY_NEXT = {
  PROPOSED: [
    ["SEATING", "Open seating"],
    ["CANCELLED", "Call it off"],
  ],
  SEATING: [
    ["LOCKED", "Lock it in"],
    ["CANCELLED", "Call it off"],
  ],
  LOCKED: [["CANCELLED", "Call it off"]],
  PLAYED: [],
  CANCELLED: [],
};

function dayLifecycleCell(row, day) {
  const td = el("td", "actions");
  for (const [to, label] of DAY_NEXT[day.state] ?? []) {
    const button = el("button", to === "CANCELLED" ? "small danger" : "small", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      // Opening seating posts a message nobody can unpost, and calling a day off
      // is the end of it. Both are worth one sentence of friction.
      const name = day.gameName ?? day.title ?? "this day";
      if (!confirm(`${label}: ${name}?`)) return;

      button.disabled = true;
      await act(() =>
        api(`/api/game-days/${encodeURIComponent(day.id)}/transition`, {
          method: "POST",
          body: JSON.stringify({ to }),
        }),
      );
    });
    td.append(button);
  }
  row.append(td);
}

/** What a campaign in this state may do next. The map that says so lives in
 *  `src/campaigns/lifecycle.ts`; this is the same shape, for buttons. */
const NEXT = {
  FORMING: [["RUNNING", "Start it"]],
  RUNNING: [
    ["HIATUS", "Take a break"],
    ["CONCLUDED", "Finish it"],
  ],
  HIATUS: [
    ["RUNNING", "Pick it back up"],
    ["CONCLUDED", "Finish it"],
  ],
  CONCLUDED: [],
};

function lifecycleCell(row, campaign) {
  const td = el("td", "actions");
  td.append(...lifecycleButtons(campaign));
  row.append(td);
}

/**
 * The edges a campaign may take, as buttons.
 *
 * Split out of the cell so the campaign page offers exactly the same ones. Two
 * places offering different transitions for one campaign is how a console grows
 * a second, wrong copy of the lifecycle.
 */
function lifecycleButtons(campaign) {
  const buttons = [];
  for (const [to, label] of NEXT[campaign.state] ?? []) {
    const button = el("button", "small", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      // Finishing is terminal and starting closes the roster for good. Both are
      // worth one sentence of friction.
      const grave = to === "CONCLUDED" || to === "RUNNING";
      if (grave && !confirm(`${label}: ${campaign.name}?`)) return;

      button.disabled = true;
      await act(() =>
        api(`/api/campaigns/${encodeURIComponent(campaign.id)}/transition`, {
          method: "POST",
          body: JSON.stringify({ to }),
        }),
      );
    });
    buttons.push(button);
  }
  return buttons;
}

/**
 * The new-campaign form. Each field is [name, label, how it is asked, hint].
 * Blank is a field the form says nothing about, which the API reads as
 * `undefined`, not "set this to nothing".
 */
const KINDS = [
  ["run", "We run it here"],
  ["play", "Someone else runs it"],
  ["tracked", "Calendar only"],
];

const FIELDS = [
  ["name", "Name", "text", null],
  ["kind", "Who runs it", "kind", null],
  ["gameId", "Game", "game", null],
  ["recurrenceAnchor", "First session, in your time", "datetime", null],
  ["intervalWeeks", "Every how many weeks", "number", "1 for weekly"],
  // Blank is the veto rule — but only once the campaign has started and has
  // somebody on it, which a campaign being created here has not. A number is how
  // an organiser opts back into counting, so the hint says both halves.
  ["quorum", "Players needed to go ahead", "number", "Blank: everyone, once it has a roster"],
  ["capacity", "Seats", "number", null],
  ["maxSessions", "Most sessions", "number", "Blank: open-ended"],
  ["firstSessionNumber", "Number of the first session", "number", "1"],
  ["discordChannelId", "Discord scheduling channel id", "text", null],
  ["discordRoleId", "Discord role id", "text", null],
];

function createForm(games) {
  const form = el("form");
  form.style.display = "flex";
  form.style.flexDirection = "column";
  form.style.gap = "16px";

  const grid = el("div", "form-grid");
  for (const [name, label, kind, hint] of FIELDS) {
    const wrap = el("label", "field");
    wrap.append(el("span", null, label));
    let input;
    if (kind === "kind") {
      input = el("select");
      for (const [value, words] of KINDS) {
        const option = el("option", null, words);
        option.value = value;
        input.append(option);
      }
    } else if (kind === "game") {
      input = el("select");
      const none = el("option", null, "No game yet");
      none.value = "";
      input.append(none);
      for (const game of games) {
        const option = el("option", null, game.name);
        option.value = game.id;
        input.append(option);
      }
    } else {
      input = el("input");
      input.type = kind === "datetime" ? "datetime-local" : kind;
      if (kind === "number") input.min = "0";
      if (hint) input.placeholder = hint;
    }
    input.name = name;
    if (name === "name") input.required = true;
    wrap.append(input);
    grid.append(wrap);
  }
  form.append(grid);

  const foot = el("div", "form-foot");
  const submit = el("button", "primary", "Make the campaign");
  submit.type = "submit";
  foot.append(submit);
  form.append(foot);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;

    const body = {};
    for (const [name, , kind] of FIELDS) {
      const raw = form.elements[name].value.trim();
      if (raw === "") continue;
      if (kind === "number") body[name] = Number(raw);
      // The API keeps the anchor as unix seconds; the box is the reader's own clock.
      else if (kind === "datetime") body[name] = Math.floor(new Date(raw).getTime() / 1000);
      else body[name] = raw;
    }

    await act(() => api("/api/campaigns", { method: "POST", body: JSON.stringify(body) }));
    submit.disabled = false;
  });

  return form;
}

/** Do it, then re-read. The page is a view of D1, never of what it just sent. */
async function act(work) {
  try {
    await work();
    await load();
  } catch (error) {
    const p = el(
      "p",
      error instanceof Refusal ? "notice" : "notice error",
      error instanceof Refusal ? error.message : "Kith could not do that. Try again.",
    );
    p.setAttribute("role", "alert");
    const head = main.querySelector(".page-head");
    if (head) head.after(p);
    else main.prepend(p);
    p.scrollIntoView({ block: "nearest" });
    if (!(error instanceof Refusal)) console.error(error);
  }
}

/** Which campaign's page is open, if any. None, until a name is clicked. */
const campaignState = { selected: null };

/**
 * One campaign's plan: where it is and where it may go, what it runs on, who
 * is on it, and what is coming — and, when nothing is coming, the sentence
 * saying why. An empty table under a heading is the one thing this must never
 * render.
 */
function campaignPageSection(plan, history, polls, stats) {
  const section = el("section", "panel opened");
  section.id = "campaign";

  const head = el("div", "panel-head");
  const title = el("h2", null, plan.name);
  title.append(" ", statePill(plan.state));
  const close = el("button", "small", "Close");
  close.type = "button";
  close.addEventListener("click", () => {
    campaignState.selected = null;
    load();
  });
  head.append(title, close);

  const body = el("div", "panel-body");
  const actions = el("div", "buttons");
  actions.append(...lifecycleButtons(plan));
  body.append(
    campaignFacts(plan),
    actions.childElementCount > 0 ? actions : null,
    stagingToggle(plan.staging, (staging) =>
      api(`/api/campaigns/${encodeURIComponent(plan.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ staging }),
      }),
    ),
    subsection("Who's on it", memberList(plan.roster)),
    subsection(
      "Coming up",
      plan.upcoming.length === 0 ? el("p", "muted", plan.upcomingNote) : upcomingTable(plan.upcoming),
    ),
  );

  if (history) body.append(historySection(history));
  if (stats) body.append(statsSection(stats));
  if (polls) body.append(pollsSection(polls));

  section.append(head, body);
  return section;
}

/**
 * The numbers, each next to a sentence saying what it counts. A null renders
 * as what it means — "not enough played yet" — never as a dash the reader has
 * to guess at.
 */
function dayStatsSection(stats) {
  if (stats.days.length === 0) return subsection("How the days went", el("p", "muted", "No day has been run yet."));

  const average = el(
    "p",
    null,
    stats.averageFillRate === null
      ? "No day with a set number of seats yet, so there is nothing to fill."
      : `Days with seats fill about ${Math.round(stats.averageFillRate * 100)}% of them.`,
  );

  const table = document.createElement("table");
  headRow(table, ["Day", ["Seated", "numeric"], ["How full", "numeric"], ["Waiting", "numeric"], ["Tables", "numeric"]]);
  const body = document.createElement("tbody");
  for (const day of stats.days) {
    const row = document.createElement("tr");
    cell(row, day.title ?? when(day.startsAt));
    cell(row, day.capacity === null ? `${day.seated}` : `${day.seated} of ${day.capacity}`, "numeric");
    // A multi day has no capacity to be full of, so it says so.
    cell(row, day.fillRate === null ? "Open to everybody" : `${Math.round(day.fillRate * 100)}%`, "numeric");
    cell(row, day.waitlistDepth === null ? "Still seating" : `${day.waitlistDepth}`, "numeric");
    cell(row, day.tablesRecorded === null ? "One game" : `${day.tablesRecorded}`, "numeric");
    body.append(row);
  }
  table.append(body);
  return subsection("How the days went", average, wrapTable(table));
}

function statsSection(stats) {
  const list = el("dl", "people");
  for (const member of stats.attendance.members) {
    list.append(
      el("dt", null, member.name),
      el("dd", null, member.rate === null ? "Not enough played yet." : `${missed(member)}${streakLine(member)}`),
    );
  }

  const played =
    stats.attendance.sessionsPlayed === 1
      ? "One session played."
      : `${stats.attendance.sessionsPlayed} sessions played.`;
  const most = stats.schedule.mostRescheduled;
  const moved = most
    ? `Moved most: ${most.number === null ? most.sessionId : `session ${most.number}`}, ${most.moves} ${most.moves === 1 ? "time" : "times"}.`
    : "Nothing has been moved.";
  const lead =
    stats.schedule.averageLeadSeconds === null
      ? "No session has been confirmed yet."
      : `Sessions are confirmed about ${hours(stats.schedule.averageLeadSeconds)} after they're made, over ${stats.schedule.confirmed} ${stats.schedule.confirmed === 1 ? "session" : "sessions"}.`;

  return subsection(
    "How it's going",
    stats.attendance.members.length > 0 ? list : null,
    el("p", "muted", `${played} ${moved} ${lead}`),
  );
}

/** The fraction, the way the person it is about would say it. */
function missed(member) {
  const absent = member.played - member.attended;
  if (absent === 0) return `Came to all ${member.played}.`;
  return `Missed ${absent} of ${member.played}.`;
}

function streakLine(member) {
  if (member.streak === 0) return "";
  return member.streak === 1 ? " Came to the last one." : ` ${member.streak} in a row.`;
}

function hours(seconds) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.round(seconds / 60)} minutes`;
  if (h < 48) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
}

/**
 * What a blank quorum means for *this* campaign, which is not one thing.
 *
 * `isUnanimous` wants a campaign past FORMING **and** somebody on the roster.
 * This reports the rule rather than applying it (CLAUDE.md: nothing may decide
 * it a second way) — and when the rule does not hold it says which condition
 * is missing.
 */
function quorumFact(plan) {
  if (plan.quorum !== null) return `${plan.quorum} players`;
  if (plan.state === "FORMING") return "Everyone, once it starts. A claim isn't a seat.";
  if (plan.roster.length === 0) return "Not set: nobody on the roster yet";
  return "Everyone: one out and it moves";
}

function campaignFacts(plan) {
  const list = el("dl", "facts");
  const facts = [
    ["Game", text(plan.gameName ?? plan.gameId)],
    ["How often", cadence({ intervalWeeks: plan.cadence.intervalWeeks, recurrenceAnchor: plan.cadence.anchor })],
    ["Needed to go ahead", quorumFact(plan)],
    ["Seats", text(plan.capacity)],
    ["Sessions left", plan.maxSessions === null ? "Open-ended" : String(plan.remaining)],
    ["Numbering starts at", String(plan.firstSessionNumber)],
  ];
  for (const [label, value] of facts) {
    const pair = el("div");
    pair.append(el("dt", null, label), el("dd", null, value));
    list.append(pair);
  }
  if (plan.channelUrl) {
    const pair = el("div");
    const said = el("dd");
    const link = el("a", null, "Open in Discord ↗");
    link.href = plan.channelUrl;
    link.rel = "noreferrer";
    link.target = "_blank";
    said.append(link);
    pair.append(el("dt", null, "Channel"), said);
    list.append(pair);
  }
  return list;
}

/**
 * Who is on it.
 *
 * Not `rosterList`: that one is a *session's* roster and says what each person
 * said about that session. A campaign's roster has no intent to show.
 */
const ROLE_WORDS = { gm: "Runs it", player: "Playing" };

function memberList(roster) {
  if (roster.length === 0) return el("p", "muted", "Nobody on it yet.");
  const list = el("dl", "people");
  for (const member of roster) {
    // Null role means a claimant: nobody is GM of a campaign that has not started.
    const role = member.role ? ROLE_WORDS[member.role] ?? member.role : "Claimed a place";
    list.append(
      el("dt", null, member.name),
      el("dd", null, member.characterName ? `${role}, as ${member.characterName}` : role),
    );
  }
  return list;
}

function upcomingTable(rows) {
  const table = document.createElement("table");
  headRow(table, ["When", "Session", "Who's in", "Where it stands", "Calendar"]);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    // The rail is the one place a session is read in full, wherever it was
    // clicked from.
    const pick = () => {
      agendaState.selected = row.sessionId;
      load();
      document.getElementById("agenda")?.scrollIntoView({ behavior: "smooth" });
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter") pick();
    });

    // The day label comes from the server, in the guild's zone.
    cell(tr, `${row.dayLabel}, ${time(row.startsAt)}`, "num");
    const title = cell(tr, row.title);
    title.style.fontWeight = "600";
    title.append(subline(text(row.location)));
    tr.append(quorumMeter(row));
    stateCell(tr, row.state);
    const sync = el("td");
    sync.append(syncLog(row.sync));
    tr.append(sync);

    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

/**
 * What the campaign has already done, and what that implies. Every number in
 * the first table is counted from the second, so they sit together. Flake
 * memory is information for the organiser and never an automatic consequence.
 */
function historySection(history) {
  return subsection(
    "The record",
    history.note ? el("p", "muted", history.note) : null,
    history.members.length > 0 ? recordTable(history.members) : null,
    history.sessions.length > 0 ? playedTable(history.sessions) : null,
    history.logs && history.logs.length > 0 ? logbook(history.logs) : null,
  );
}

/**
 * The written record beside the counted one, one heading per evening. Sessions
 * nobody wrote up are absent rather than empty.
 */
function logbook(groups) {
  const box = el("div", "logs");
  box.append(el("h4", null, "Written up"));
  for (const group of groups) {
    const evening = el(
      "p",
      "small",
      [group.number === null ? null : `Session ${group.number}`, when(group.startsAt)].filter(Boolean).join(", "),
    );
    evening.style.fontWeight = "600";
    box.append(evening, logList(group.entries, false));
  }
  return box;
}

function recordTable(members) {
  const table = document.createElement("table");
  headRow(table, [
    "Player",
    ["Came", "numeric"],
    ["Of", "numeric"],
    ["How often", "numeric"],
    ["Said in, didn't come", "numeric"],
  ]);

  const body = document.createElement("tbody");
  for (const member of members) {
    const tr = document.createElement("tr");
    cell(tr, member.name);
    cell(tr, String(member.attended), "numeric");
    cell(tr, String(member.played), "numeric");
    // No number at all below the threshold: "1 of 2" reads as a judgement.
    cell(tr, member.rate === null ? "—" : `${Math.round(member.rate * 100)}%`, "numeric");
    cell(tr, member.noShowStreak === 0 ? "—" : String(member.noShowStreak), "numeric");
    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

function playedTable(sessions) {
  const table = document.createElement("table");
  table.append(el("caption", null, "Sessions played"));
  headRow(table, [
    "When",
    "Session",
    ["Came", "numeric"],
    ["Missed", "numeric"],
    ["Nobody noted", "numeric"],
  ]);

  const body = document.createElement("tbody");
  for (const played of sessions) {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    const pick = () => {
      agendaState.selected = played.sessionId;
      load();
      document.getElementById("agenda")?.scrollIntoView({ behavior: "smooth" });
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter") pick();
    });
    cell(tr, when(played.startsAt), "num");
    const title = cell(tr, played.number === null ? played.sessionId : `Session ${played.number}`);
    title.append(subline(text(played.location)));
    cell(tr, String(played.came), "numeric");
    cell(tr, String(played.missed), "numeric");
    // Never folded into "missed": nobody noting who came is not the same answer
    // as they did not turn up.
    cell(tr, played.unrecorded === 0 ? "—" : String(played.unrecorded), "numeric");
    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

const WAITING = {
  responses: "Waiting on answers.",
  gm: "Past its bar, but not on a night the GM has marked free. Waiting on the GM.",
  organiser: "Ready to pick. The pick is made on the poll post in Discord.",
};

const WIN_RULES = {
  min_players: "The first date with enough players wins",
  quorum_of_roster: "The first date enough of the roster can make wins",
  best_available: "The date most people can make wins",
  organiser_picks: "An organiser picks the date",
};

/**
 * The campaign's open date polls, and the one setting beside them. Every row
 * ends at a link to the post: the pick is an organiser-only button there, and a
 * second way to reach the same decision would put it behind two confirmations.
 */
function pollsSection(polls) {
  return subsection(
    "Date polls",
    autoResolveToggle(polls),
    ...(polls.polls.length === 0 ? [el("p", "muted", "No open polls.")] : polls.polls.map(pollCard)),
  );
}

/** A checkbox, its label, and the sentence saying exactly what it does. */
function toggle(checked, label, caveat, onChange) {
  const wrap = el("div", "toggle");
  const line = el("label", "check");
  const box = el("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box));
  line.append(box, document.createTextNode(label));
  wrap.append(line);
  if (caveat) wrap.append(el("p", "muted", caveat));
  return wrap;
}

function autoResolveToggle(polls) {
  // The constraint in the copy and not only in the code. A control that quietly
  // does something narrower than its label is one somebody blames for the wrong thing.
  return toggle(
    polls.autoResolvePolls,
    "Pick the date automatically",
    "Only onto a date the GM has marked free, and only for a poll with a fixed number to reach.",
    async (box) => {
      box.disabled = true;
      await act(() =>
        api(`/api/campaigns/${encodeURIComponent(campaignState.selected)}`, {
          method: "PATCH",
          body: JSON.stringify({ autoResolvePolls: box.checked }),
        }),
      );
    },
  );
}

function pollCard(poll) {
  const card = el("article", "poll");

  const rule = WIN_RULES[poll.winRule] ?? poll.winRule.replace(/_/g, " ");
  card.append(
    el(
      "p",
      null,
      `${rule}${poll.required === null ? "" : `, needing ${poll.required}`}. ${poll.rosterSize} on the roster.`,
    ),
    el("p", "muted", WAITING[poll.waitingOn]),
  );

  const table = document.createElement("table");
  headRow(table, ["Date", ["Can make it", "numeric"], "GM free", ""]);
  const body = document.createElement("tbody");
  const proposed = new Set(poll.proposed);
  for (const date of poll.dates) {
    const tr = document.createElement("tr");
    cell(tr, when(date.startsAt), "num");
    cell(tr, String(date.yes), "numeric");
    // Null is "nobody was asked": a campaign with no GM is a real state, and
    // rendering it as a refusal blames somebody who does not exist.
    cell(tr, date.gmAvailable === null ? "No GM" : date.gmAvailable ? "Yes" : "—");
    const mark = el("td");
    if (proposed.has(date.pollDateId)) mark.append(el("span", "pill accent", "Proposed"));
    tr.append(mark);
    body.append(tr);
  }
  table.append(body);
  card.append(wrapTable(table));

  if (poll.postUrl) {
    const links = el("p");
    const link = el("a", null, "Open the poll in Discord ↗");
    link.href = poll.postUrl;
    link.rel = "noreferrer";
    link.target = "_blank";
    links.append(link);
    card.append(links);
  }

  return card;
}

/**
 * Who is holding this game: shown in the row rather than only in the refusal,
 * so the cost of a delete is legible before anybody reaches for it.
 */
function heldBy(row, game) {
  const usage = game.usage;
  if (!usage) return cell(row, "—");

  const names = usage.campaigns.map((held) => held.name);
  if (usage.gameDays > 0) {
    names.push(`${usage.gameDays} game ${usage.gameDays === 1 ? "day" : "days"}`);
  }
  return cell(row, names.length === 0 ? "Nothing yet" : names.join(", "), names.length === 0 ? "faint" : "");
}

/**
 * "This is a test." Its posts go to the Staging channels, nothing reaches the
 * calendar, and only organisers see it on the site (src/projection/staging.ts).
 * `caveat` is false in the games table, where the panel says it once for every row.
 */
const STAGING_CAVEAT =
  "Posts go to the Staging channels, nothing goes on the calendar, and only organisers see it on the site. Set it before anything is scheduled: it can't change after.";

function stagingToggle(checked, save, caveat = true) {
  return toggle(checked, "Test game", caveat ? STAGING_CAVEAT : null, async (box) => {
    box.disabled = true;
    await act(() => save(box.checked));
    // A save that worked re-rendered the page and this box with it. One that
    // was refused leaves it here, and it must show what is true, not what was asked.
    box.checked = checked;
    box.disabled = false;
  });
}

function gameActions(row, game) {
  const test = el("td");
  const box = stagingToggle(
    game.staging,
    (staging) =>
      api(`/api/games/${encodeURIComponent(game.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name: game.name, staging }),
      }),
    false,
  );
  // The label is the column's heading; the box keeps it for screen readers.
  box.querySelector("label").lastChild.textContent = "";
  box.querySelector("input").setAttribute("aria-label", `${game.name} is a test game`);
  test.append(box);
  row.append(test);

  const td = el("td", "actions");
  const usage = game.usage;
  // No button at all while somebody holds it. The server refuses either way,
  // but a button that always refuses trains people to ignore refusals.
  if (usage && usage.campaigns.length === 0 && usage.gameDays === 0) {
    const remove = el("button", "small danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete ${game.name}?`)) return;
      remove.disabled = true;
      await act(() => api(`/api/games/${encodeURIComponent(game.id)}`, { method: "DELETE" }));
    });
    td.append(remove);
  }
  row.append(td);
}

/**
 * The settings, one form per key: the fields have nothing to do with each
 * other, a single Save would make one bad value refuse nine good ones, and the
 * audit row is per key anyway.
 */
function settingsSection(settings) {
  const section = el("div", "settings");

  for (const field of settings) {
    const form = el("form", "setting");

    const about = el("div", "about");
    const label = el("label", null, field.label);
    label.htmlFor = `setting-${field.key}`;
    about.append(label, el("p", null, field.help));
    // What it costs, on the page and not only in a commit message.
    if (field.caveat) about.append(el("p", null, field.caveat));
    if (!field.writable) about.append(el("p", "faint", "Set when Kith was installed; it can't be changed here."));
    form.append(about);

    const box = el("div", "box");
    const input = el("input");
    input.id = `setting-${field.key}`;
    input.name = "value";
    input.type = field.kind === "number" ? "number" : "text";
    input.value = field.value === null || field.value === undefined ? "" : asText(field.value);
    // A blank box is not a mystery: the placeholder is what the Worker actually
    // uses when nothing is written.
    if (field.fallback !== null && field.fallback !== undefined) {
      input.placeholder = `${asText(field.fallback)} (the default)`;
    }
    input.disabled = !field.writable;
    box.append(input);

    if (field.writable) {
      const save = el("button", null, "Save");
      save.type = "submit";
      box.append(save);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        save.disabled = true;
        const raw = input.value.trim();
        const value =
          field.kind === "number"
            ? Number(raw)
            : field.kind === "list"
              ? raw.split(/[,\s]+/).filter(Boolean).map(Number)
              : raw;
        await act(() =>
          api(`/api/settings/${field.key}`, { method: "PUT", body: JSON.stringify({ value }) }),
        );
        save.disabled = false;
      });
    }
    form.append(box);

    section.append(form);
  }

  return section;
}

function asText(value) {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** The log's paging state. Cursors only — there is no page number to hold. */
const auditState = { cursor: null, actor: null, rows: [] };

/** Who changed what, newest first: a time, a name, and what happened. */
function auditSection(page, actors) {
  const section = el("div");
  section.style.display = "flex";
  section.style.flexDirection = "column";
  section.style.gap = "12px";

  const filter = el("label", "log-filter");
  filter.append(el("span", "muted", "Changes by"));
  const select = el("select");
  const anyone = el("option", null, "Everyone");
  anyone.value = "";
  select.append(anyone);
  for (const actor of actors) {
    const option = el("option", null, actor.name);
    option.value = actor.userId;
    if (auditState.actor === actor.userId) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => {
    auditState.actor = select.value || null;
    // A new filter is a new reading, so the cursor and the rows behind it go.
    auditState.cursor = null;
    auditState.rows = [];
    load();
  });
  filter.append(select);
  section.append(filter);

  const rows = [...auditState.rows, ...page.rows];
  if (rows.length === 0) {
    section.append(emptyNote("Nothing has changed yet."));
    return section;
  }

  const list = el("ul", "log");
  for (const row of rows) list.append(auditLine(row));
  section.append(list);

  if (page.cursor) {
    const more = el("button", "small", "Show older changes");
    more.type = "button";
    more.style.alignSelf = "flex-start";
    more.addEventListener("click", () => {
      // Keep what is on screen and append: the cursor is where the next page
      // starts, not which page it is.
      auditState.rows = [...auditState.rows, ...page.rows];
      auditState.cursor = page.cursor;
      load();
    });
    section.append(more);
  }

  return section;
}

/**
 * One change, in the browser's own zone: this is a log of when things happened
 * to the reader, not a schedule the table shares.
 */
function auditLine(row) {
  const item = el("li");
  const stamp = new Date(row.createdAt * 1000);
  const at = el(
    "time",
    null,
    stamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  );
  at.dateTime = stamp.toISOString();
  const who = el("span", "who", row.actorName ?? row.actorUserId ?? "Kith");

  const verb = row.action.includes(".") ? row.action.slice(row.action.indexOf(".") + 1) : row.action;
  const parts = [`${verb.replace(/[_-]/g, " ")} ${row.targetType} ${row.targetId}`];
  const detail = row.detail;
  if (detail && typeof detail === "object" && "after" in detail) {
    const after = scalarOf(detail.after);
    const before = scalarOf(detail.before);
    // No arrow with nothing on the left of it.
    if (after !== null) parts.push(before === null ? `to ${after}` : `${before} → ${after}`);
  }
  const what = el("span", "what", parts.join(", "));
  what.textContent = what.textContent.charAt(0).toUpperCase() + what.textContent.slice(1);

  item.append(at, who, what);
  return item;
}

function scalarOf(value) {
  if (value === null || value === undefined) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return String(value).toLowerCase();
  return null;
}

/**
 * Delete my data.
 *
 * Two confirmations rather than one, and the second asks for the word. This is
 * the only action in the console that cannot be undone by doing the opposite.
 * The receipt is shown table by table afterwards, in Kith's own words, because
 * "done" is not an answer to "what did you hold about me".
 */
function deleteMeSection() {
  const section = el("div");
  section.style.display = "flex";
  section.style.flexDirection = "column";
  section.style.gap = "12px";
  section.style.alignItems = "flex-start";

  section.append(
    el(
      "p",
      "muted",
      "This deletes everything Kith holds that's keyed to your Discord account: what you said about sessions, your campaign places, your signups, and the tokens Kith uses to recognise you. Your Discord account is untouched. It can't be undone.",
    ),
  );

  const receipt = el("p");
  const button = el("button", "danger", "Delete my data");
  button.type = "button";
  button.addEventListener("click", async () => {
    if (!confirm("Delete everything Kith holds about you? This can't be undone.")) return;
    if (prompt('Type "delete" to confirm.') !== "delete") return;

    button.disabled = true;
    try {
      const answer = await api("/console/me/delete", { method: "POST", body: "{}" });
      receipt.textContent = answer.said;
      receipt.className = "notice";
    } catch (error) {
      receipt.className = "notice error";
      receipt.textContent =
        error instanceof Refusal ? error.message : "Kith could not do that. Try again.";
    }
  });

  section.append(button, receipt);
  return section;
}

/**
 * Your calendar feeds: one URL per campaign, plus everything. The token is in
 * the path, so these URLs are credentials: nothing here hands one to a third
 * party.
 */
function feedsSection(feeds) {
  const section = el("div", "settings");

  for (const link of feeds.links) {
    const row = el("div", "setting");
    const about = el("div", "about");
    const label = el("label", null, link.label);
    const id = `feed-${link.label.replace(/\W+/g, "-").toLowerCase()}`;
    label.htmlFor = id;
    about.append(label);

    const box = el("div", "box feed");
    const input = el("input");
    input.id = id;
    input.type = "text";
    input.readOnly = true;
    input.value = link.url;
    input.addEventListener("focus", () => input.select());
    const copy = el("button", null, "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link.url);
        copy.textContent = "Copied";
      } catch {
        input.focus();
      }
    });
    box.append(input, copy);
    row.append(about, box);
    section.append(row);
  }

  // On the panel rather than in a tooltip: somebody who does not know a
  // subscribed feed refreshes overnight reads a correct feed as a broken one.
  const foot = el("div", "sub");
  foot.append(el("p", "muted", feeds.lag));

  const rotate = el("button", "danger", "Make new links");
  rotate.type = "button";
  rotate.style.alignSelf = "flex-start";
  rotate.addEventListener("click", async () => {
    if (!confirm("Make new links? Every calendar you've subscribed stops updating until you give it the new one.")) {
      return;
    }
    rotate.disabled = true;
    await act(() => api("/console/me/feeds/rotate", { method: "POST", body: "{}" }));
  });
  foot.append(
    el(
      "p",
      "muted small",
      "Making new links stops every link above working at once, and every calendar app you've subscribed has to be given the new one by hand.",
    ),
    rotate,
  );
  section.append(foot);

  return section;
}

/**
 * People who signed up from the site and aren't in the Kith server. Their
 * signups hold their places until somebody answers here or on the post in the
 * approvals channel; both call the same functions.
 */
const DOOR_STATE = {
  pending: ["Waiting", "maybe"],
  approved: ["Let in, not joined yet", "in"],
  declined: ["Not this time", "done"],
};
const SIGNUP_WORDS = { in: "in", waitlisted: "waitlisted", interested: "interested" };

function doorSection(door) {
  if (door.rows.length === 0) return el("p", "muted", "Nobody is waiting to be let into the server.");
  const table = document.createElement("table");
  headRow(table, ["Who", "Signed up for", "Asked", "Where they are", ["", "actions"]]);
  const body = document.createElement("tbody");
  for (const row of door.rows) {
    const tr = document.createElement("tr");
    const who = cell(tr, row.person.name);
    who.style.fontWeight = "600";
    cell(
      tr,
      row.signups.length === 0
        ? "Nothing right now"
        : row.signups.map((s) => `${s.name} (${SIGNUP_WORDS[s.state] ?? s.state})`).join(", "),
    );
    cell(tr, when(row.askedAt), "num");
    const where = el("td");
    const [words, tone] = DOOR_STATE[row.state] ?? [row.state, ""];
    where.append(el("span", `pill ${tone}`, words));
    if (row.invite) {
      const link = el("a", null, "Their invite ↗");
      link.href = row.invite;
      link.target = "_blank";
      link.rel = "noopener";
      const line = subline("");
      line.append(link);
      where.append(line);
    }
    tr.append(where);
    const actions = el("td", "actions");
    const id = encodeURIComponent(row.person.id);
    if (row.state !== "approved") {
      actions.append(
        action(
          "Let them in",
          `Let ${row.person.name} into the Kith server? Kith makes them a one-use invite.`,
          () => api(`/api/door/${id}/let-in`, { method: "POST", body: "{}" }),
          "primary",
        ),
      );
    }
    if (row.state !== "declined") {
      actions.append(
        action("Not this time", `Turn ${row.person.name} away? Their places are given back.`, () =>
          api(`/api/door/${id}/turn-away`, { method: "POST", body: "{}" }),
        ),
      );
    }
    tr.append(actions);
    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

/**
 * The suggestion box, every game's, newest first. An anonymous one has no
 * name and only a day, because that is all Kith ever kept.
 */
function suggestionsSection(suggestions) {
  if (suggestions.length === 0) return el("p", "muted", "Nothing in the suggestion box yet.");
  const table = document.createElement("table");
  headRow(table, ["Game", "From", "Left", "Suggestion", ["", "actions"]]);
  const body = document.createElement("tbody");
  for (const row of suggestions) {
    const tr = document.createElement("tr");
    if (row.readAt) tr.className = "read";
    const game = el("td");
    const link = el("a", null, row.game.name);
    link.href = `/games/${encodeURIComponent(row.game.id)}`;
    game.append(link);
    tr.append(game);
    cell(tr, row.author ? row.author.name : "Anonymous");
    cell(
      tr,
      row.dayOnly
        ? new Date(row.createdAt * 1000).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })
        : when(row.createdAt),
      "num",
    );
    cell(tr, row.body, "pre wordy");
    const actions = el("td", "actions");
    const id = encodeURIComponent(row.id);
    actions.append(
      row.readAt
        ? action("Mark as new", null, () => api(`/api/suggestions/${id}/unread`, { method: "POST", body: "{}" }))
        : action("Mark as read", null, () => api(`/api/suggestions/${id}/read`, { method: "POST", body: "{}" })),
    );
    tr.append(actions);
    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

/** Every stop sign pressed, newest first, and whether the alert and the email went. */
function stopSignsSection(signs) {
  const table = document.createElement("table");
  headRow(table, ["Game", "Who", "When", "Discord alert", "Email"]);
  const body = document.createElement("tbody");
  for (const row of signs) {
    const tr = document.createElement("tr");
    const game = cell(tr, row.game.name);
    game.style.fontWeight = "600";
    cell(tr, row.person ? row.person.name : "Someone");
    cell(tr, when(row.createdAt), "num");
    const posted = el("td");
    posted.append(
      row.posted
        ? el("span", "pill in", "Posted")
        : row.unconfirmed
          ? el("span", "pill maybe", "Sent, not confirmed")
          : el("span", "pill out", "Not yet"),
    );
    tr.append(posted);
    const email = el("td");
    email.append(row.emailed ? el("span", "pill in", "Sent") : el("span", "pill out", "Not yet"));
    if (row.lastError) email.append(subline(row.lastError));
    tr.append(email);
    body.append(tr);
  }
  table.append(body);
  return wrapTable(table);
}

/** The top of the page: its name, what it is for, and a way to each panel. */
function pageHead(stops) {
  const head = el("header", "page-head");
  head.append(
    el("h1", null, "Organise"),
    el("p", "muted", "Everything Kith runs on, for organisers: the schedule, the games, the people waiting, and the settings."),
  );
  const nav = el("nav", "jump");
  nav.setAttribute("aria-label", "On this page");
  for (const [id, label, attention] of stops) {
    const a = el("a", attention ? "attention" : null, label);
    a.href = `#${id}`;
    nav.append(a);
  }
  head.append(nav);
  return head;
}

async function load() {
  try {
    const [
      me,
      agenda,
      { campaigns },
      { games },
      { gameDays },
      settings,
      log,
      { actors },
      feeds,
      dayStats,
      door,
      suggestions,
      stopSigns,
    ] = await Promise.all([
      api("/api/me"),
      api("/api/agenda"),
      api("/api/campaigns"),
      // The admin list rather than the plain summaries: this page offers a
      // delete, and a delete needs to know what it would break.
      api("/api/games/usage"),
      api("/api/game-days"),
      api("/api/settings"),
      api(
        `/api/audit?limit=50${auditState.actor ? `&actor=${encodeURIComponent(auditState.actor)}` : ""}${
          auditState.cursor ? `&cursor=${encodeURIComponent(auditState.cursor)}` : ""
        }`,
      ).catch(() => null),
      api("/api/audit/actors").catch(() => ({ actors: [] })),
      api("/console/me/feeds").catch(() => null),
      api("/api/game-days/stats").catch(() => null),
      api("/api/door").catch(() => null),
      api("/api/suggestions").catch(() => null),
      api("/api/stop-signs").catch(() => null),
    ]);

    // The rail is a second read rather than part of the agenda's: one session's
    // roster is not something the list needs.
    const detail = agendaState.selected
      ? await api(`/api/sessions/${encodeURIComponent(agendaState.selected)}`).catch(() => null)
      : null;

    // Likewise the campaign page: a campaign nobody has opened is a query
    // nobody has asked for.
    const [plan, history, polls, stats] = campaignState.selected
      ? await Promise.all([
          api(`/api/campaigns/${encodeURIComponent(campaignState.selected)}/page`).catch(() => null),
          api(`/api/campaigns/${encodeURIComponent(campaignState.selected)}/history`).catch(() => null),
          api(`/api/campaigns/${encodeURIComponent(campaignState.selected)}/polls`).catch(() => null),
          api(`/api/campaigns/${encodeURIComponent(campaignState.selected)}/stats`).catch(() => null),
        ])
      : [null, null, null, null];

    const waiting = door ? door.rows.filter((row) => row.state === "pending").length : 0;
    const unread = suggestions ? suggestions.suggestions.filter((row) => !row.readAt).length : 0;

    const panels = [];
    const stops = [];
    const add = (node, label, attention = false) => {
      if (!node) return;
      panels.push(node);
      if (label) stops.push([node.id, label, attention]);
    };

    if (door) {
      const p = panel("door", "Waiting to join the server", "People who signed up on the site but aren't in the Kith server yet.", doorSection(door));
      if (waiting > 0) p.classList.add("attention");
      add(p, "Waiting to join", waiting > 0);
    }

    const split = el("div", "split");
    split.append(agendaSection(agenda), detailRail(detail));
    add(panel("agenda", "Agenda", null, split), "Agenda");

    if (stopSigns?.stopSigns.length) {
      const p = panel("stop-signs", "Stop signs", "Every time someone pressed a game's stop sign, newest first.", stopSignsSection(stopSigns.stopSigns));
      add(p, "Stop signs");
    }
    if (suggestions) {
      const p = panel("suggestions", "Suggestion box", "Every game's suggestions, newest first.", suggestionsSection(suggestions.suggestions));
      if (unread > 0) p.classList.add("attention");
      add(p, "Suggestion box", unread > 0);
    }

    add(panel("campaigns", "Campaigns", "Pick a campaign's name to open its page.", campaignsTable(campaigns)), "Campaigns");
    if (plan) add(campaignPageSection(plan.campaign, history, polls, stats));

    add(
      panel("game-days", "Game days", null, gameDaysTable(gameDays), dayStats ? dayStatsSection(dayStats) : null),
      "Game days",
    );
    add(
      panel(
        "games",
        "Games",
        `The systems and board games Kith knows. A test game: ${STAGING_CAVEAT.charAt(0).toLowerCase()}${STAGING_CAVEAT.slice(1)}`,
        gamesTable(games),
      ),
      "Games",
    );
    add(panel("new-campaign", "Make a campaign", "Only the name is needed. Everything else can be set later.", createForm(games)), "Make a campaign");
    add(panel("settings", "Settings", "How Kith behaves for everyone. Each one saves on its own.", settingsSection(settings.settings)), "Settings");
    if (log) add(panel("log", "Changes", "Who changed what, newest first.", auditSection(log, actors)), "Changes");
    if (feeds) {
      add(
        panel("feeds", "Your calendar feeds", "Subscribe to these in your calendar app. They're yours: don't share them.", feedsSection(feeds)),
        "Your feeds",
      );
    }
    add(panel("your-data", "Your data", null, deleteMeSection()), "Your data");

    main.replaceChildren(pageHead(stops), ...panels);
  } catch (error) {
    const message =
      error instanceof Refusal ? error.message : "Kith could not load that. Try again.";
    main.replaceChildren(el("p", error instanceof Refusal ? "notice" : "notice error", message));
    if (!(error instanceof Refusal)) console.error(error);
  } finally {
    main.setAttribute("aria-busy", "false");
    if (status.isConnected) status.remove();
  }
}

load();

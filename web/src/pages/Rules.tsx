import type { ReactNode } from "react";
import { useCopy } from "../api.ts";
import { Markdown } from "../markdown.tsx";

/**
 * Kith's rules, as Jrvs wrote them (2026-11-22). Publishing a `conduct` section
 * in the CMS replaces them; until then these are the words.
 */
const RULES: { title: string; body: ReactNode }[] = [
  {
    title: "Respect the game",
    body: "It is a privilege to come together and play games like this. Take everyone as they are, and interact with the story we are telling collectively. Lean in. Dork out. Bring your shit. Let's get weird.",
  },
  {
    title: "Respect each other's time",
    body: "We get precious few opportunities to spend time with each other. Needing to step away for a day, from a game, running late, had a tough one, etc. All human. Just let us know ASAP rather than letting guilt linger.",
  },
  {
    title: "Give each other grace",
    body: "It's all our first time being alive. We will make mistakes, we will annoy each other, and we may even hurt each other's feelings. This is the bargain we make when we want to play games that make us feel things. Keep it on the court, and remember that we are all friends.",
  },
  {
    title: "Don't be an asshole",
    body: "Bigotry, harassment, continued patterns of breaking boundaries and agreed upon rules, and overall being an unpleasant games partner will get you un-invited and kicked out.",
  },
  {
    title: "Say if it sucks",
    body: (
      <>
        This is fun make believe time. If we ever cross the line into real hurtful experiences, traumas, we <em>stop and take some time</em>. We have a
        universal stop sign button on every game's page in the app, and a suggestion box for private communication. I am always available to chat about
        anything.
      </>
    ),
  },
  {
    title: "I'm God, fuck you",
    body: "At the end of the day, this is my server, and I'll kick you out if you suck. I doubt I'll have to, but, live in fear.",
  },
];

/** The code of conduct, for everyone signed in. */
export function Rules() {
  const copy = useCopy().data?.conduct;
  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h1 style={{ fontSize: 32 }}>{copy?.title ?? "The rules"}</h1>
        {copy?.body ? null : <p className="muted">How we play together at Kith.town.</p>}
      </div>
      {copy?.body ? (
        <div className="rules-copy">
          <Markdown source={copy.body} />
        </div>
      ) : (
        <ol className="rules">
          {RULES.map((rule) => (
            <li key={rule.title}>
              <h2>{rule.title}</h2>
              <p>{rule.body}</p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Where a table lives on the site. A campaign is a game with a home base at
 * `/games/<slug>`; a game day still has its own page under `/table`, and its
 * board game's home base lists it. Every link to either goes through here so
 * the two never drift.
 */
type Kind = "campaign" | "game-day";

interface Common {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ToTable({ kind, id, ...rest }: Common & { kind: Kind | string; id: string }) {
  return kind === "campaign" ? (
    <Link to="/games/$slug" params={{ slug: id }} {...rest} />
  ) : (
    <Link to="/table/$kind/$id" params={{ kind, id }} {...rest} />
  );
}

export function ToPage({ kind, id, slug, title, ...rest }: Common & { kind: Kind | string; id: string; slug: string; title?: string }) {
  const search = title ? { title } : {};
  return kind === "campaign" ? (
    <Link to="/games/$slug/$page" params={{ slug: id, page: slug }} search={search} {...rest} />
  ) : (
    <Link to="/table/$kind/$id/$slug" params={{ kind, id, slug }} search={search} {...rest} />
  );
}

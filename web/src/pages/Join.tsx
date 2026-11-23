import { Navigate, useParams } from "@tanstack/react-router";
import { useListing } from "../api.ts";

/**
 * `/join/<kind>/<id>`, the address of the old splash page, which links in
 * Discord still use. A game has one page and a join link is just that page:
 * a campaign's home base, a board game day's board game, and any other game
 * day's own page. Each shows "I Want To Play" when it is taking signups.
 */
export function Join() {
  const { kind, id } = useParams({ from: "/join/$kind/$id" });
  if (kind === "campaign") return <Navigate to="/games/$slug" params={{ slug: id }} replace />;
  return <JoinDay id={id} />;
}

function JoinDay({ id }: { id: string }) {
  const query = useListing("game-day", id);
  if (query.isPending) return <div className="show" aria-busy="true" />;
  const game = query.data?.listing.game;
  if (game?.category === "board") return <Navigate to="/games/$slug" params={{ slug: game.id }} replace />;
  // Not one we can see goes to the day's page too, which says so in its own words.
  return <Navigate to="/table/$kind/$id" params={{ kind: "game-day", id }} replace />;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * The site's one door to the Worker. Same origin, so the session cookie rides
 * along and there is no CORS. The shapes mirror src/hub/*.ts; they are written
 * out here rather than imported so the site never pulls Worker code into the
 * browser bundle.
 */
export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export type Me = { signedIn: false } | { signedIn: true; user: Person; organiser: boolean };

export type Visibility = "public" | "members" | "organisers";

export interface Listing {
  kind: "campaign" | "game-day";
  id: string;
  name: string;
  state: string;
  visibility: Visibility;
  open: boolean;
  game: { id: string; name: string; category: "ttrpg" | "board" } | null;
  tagline: string | null;
  pitch: string | null;
  heroUrl: string | null;
  soundUrl: string | null;
  lead: Person | null;
  capacity: number | null;
  taken: number;
  waitlist: number;
  when: { startsAt: number | null; endsAt: number | null; intervalWeeks: number | null };
  where: string | null;
  mine: "in" | "waitlisted" | null;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: "ttrpg" | "board";
  summary: string | null;
  coverUrl: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  defaultDurationMinutes: number | null;
}

export type Intent = "in" | "out" | "maybe";

export interface AgendaRow {
  sessionId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  day: string;
  dayLabel: string;
  state: string;
  location: string | null;
  campaignId: string | null;
  gameDayId: string | null;
  rosterSize: number;
  tally: { in: number; out: number; maybe: number; noReply: number };
  quorum: { rule: string; required: number | null; saidIn: number; roster: number; met: boolean; confirmed: boolean };
  inJeopardy: boolean;
  mine: boolean;
  myIntent: Intent | null;
}

export interface FeedsPanel {
  links: { label: string; url: string }[];
  lag: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Orrey answered ${response.status}.`;
    throw new ApiError(response.status, message);
  }
  return parsed as T;
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/hub/me") });

export const useListings = () =>
  useQuery({
    queryKey: ["listings"],
    queryFn: () => api<{ asOf: number; listings: Listing[] }>("/api/hub/listings"),
  });

export const useListing = (kind: string, id: string) =>
  useQuery({
    queryKey: ["listing", kind, id],
    queryFn: () => api<{ asOf: number; listing: Listing }>(`/api/hub/listings/${kind}/${encodeURIComponent(id)}`),
    retry: false,
  });

export const useGames = () =>
  useQuery({ queryKey: ["games"], queryFn: () => api<{ games: CatalogEntry[] }>("/api/hub/games") });

export const useAgenda = (scope: "mine" | "public") =>
  useQuery({
    queryKey: ["agenda", scope],
    queryFn: () => api<{ asOf: number; rows: AgendaRow[] }>(`/api/hub/agenda?scope=${scope}`),
  });

export const useFeeds = (enabled: boolean) =>
  useQuery({ queryKey: ["feeds"], queryFn: () => api<FeedsPanel>("/console/me/feeds"), enabled });

/** Take a seat, join the waitlist, or give the place back. */
export function useSignup(listing: Pick<Listing, "kind" | "id">) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: "seat" | "waitlist" | "out") =>
      api<{ listing: Listing }>(
        listing.kind === "campaign"
          ? `/api/hub/campaigns/${encodeURIComponent(listing.id)}/signup`
          : `/api/hub/game-days/${encodeURIComponent(listing.id)}/seat`,
        { method: "POST", body: { action } },
      ),
    onSuccess: (data) => {
      client.setQueryData(["listing", listing.kind, listing.id], (old: { asOf: number } | undefined) => ({
        asOf: old?.asOf ?? Math.floor(Date.now() / 1000),
        listing: data.listing,
      }));
      void client.invalidateQueries({ queryKey: ["listings"] });
      void client.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}

export function useIntent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, intent }: { sessionId: string; intent: Intent }) =>
      api(`/api/hub/sessions/${encodeURIComponent(sessionId)}/intent`, { method: "POST", body: { intent } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agenda"] }),
  });
}

export function useListingEdit(listing: Pick<Listing, "kind" | "id">) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<Listing, "visibility" | "tagline" | "pitch" | "heroUrl" | "soundUrl">>) =>
      api(
        `/api/${listing.kind === "campaign" ? "campaigns" : "game-days"}/${encodeURIComponent(listing.id)}/listing`,
        { method: "PATCH", body: patch },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["listing", listing.kind, listing.id] });
      void client.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}

export function useCatalogEdit(gameId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<CatalogEntry, "category" | "summary" | "coverUrl">>) =>
      api(`/api/games/${encodeURIComponent(gameId)}/catalog`, { method: "PATCH", body: patch }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["games"] }),
  });
}

import type { Visibility } from "../db/schema.ts";

/**
 * Who is looking. `userId` is absent for somebody who has not signed in;
 * `organiser` is read with the bot token, never from anything the viewer holds.
 */
export interface Viewer {
  userId: string | undefined;
  organiser: boolean;
}

export const ANONYMOUS: Viewer = { userId: undefined, organiser: false };

/**
 * The one rule for the whole site, like `quorum.ts` is for attendance:
 * public is anybody, members is the people on the thing (and organisers),
 * organisers is organisers. Nothing else decides it a second way.
 */
export function canSee(visibility: Visibility, viewer: Viewer, isMember: boolean): boolean {
  if (viewer.organiser) return true;
  switch (visibility) {
    case "public":
      return true;
    case "members":
      return viewer.userId !== undefined && isMember;
    default:
      return false;
  }
}

export function isVisibility(value: unknown): value is Visibility {
  return value === "public" || value === "members" || value === "organisers";
}

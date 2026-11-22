/** A person as the site shows them: a name and maybe a picture, never more. */
export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export function personFrom(row: {
  discordId: string;
  username: string | null;
  globalName: string | null;
  avatar?: string | null;
}): Person {
  return {
    id: row.discordId,
    name: row.globalName ?? row.username ?? "Someone",
    avatarUrl: avatarUrl(row.discordId, row.avatar ?? null),
  };
}

/**
 * Discord's CDN. Somebody with no avatar of their own gets the default one
 * Discord itself shows them, picked the way Discord picks it, so the site's
 * faces match the server's.
 */
export function avatarUrl(userId: string, hash: string | null): string | null {
  if (hash && /^(a_)?[0-9a-f]{32}$/.test(hash)) return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=96`;
  return defaultAvatarUrl(userId);
}

export function defaultAvatarUrl(userId: string): string | null {
  if (!/^\d{1,20}$/.test(userId)) return null;
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

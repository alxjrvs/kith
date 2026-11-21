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

/** Discord's CDN. A null hash is the default avatar, which the site draws itself. */
export function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash || !/^(a_)?[0-9a-f]{32}$/.test(hash)) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=96`;
}

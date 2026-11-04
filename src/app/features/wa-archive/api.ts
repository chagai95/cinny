import { useEffect, useState } from 'react';
import { atom } from 'jotai';
import type { IEventWithRoomId, MatrixClient } from 'matrix-js-sdk';

/**
 * Older WhatsApp history (before the bridge reset of 4 Feb 2024, and the
 * 2020-21 chats of the old account) lives in Matrix rooms this account can no
 * longer read. A small read-only service on the homeserver host
 * (matrix-os/bin/wa-history-api.py, at <homeserver>/wa-history) serves them,
 * linked to the current chat by the WhatsApp chat id. Everything here is
 * read-only; errors simply mean "no older history".
 */

export type ArchiveLink = { room: string; first_ts: number; last_ts: number; messages: number };
export type ArchiveProfiles = Record<
  string,
  Record<string, { displayname?: string; avatar_url?: string }>
>;
export type ArchiveEvent = IEventWithRoomId & {
  unsigned: Record<string, any> & { 'chagai.so'?: number; 'chagai.current_room'?: string };
};
export type ArchiveCursor = { ts: number; id: number };
export type ArchivePage = {
  chunk: ArchiveEvent[];
  profiles: ArchiveProfiles;
  /** cursor for older pages (null = reached the oldest) */
  end: ArchiveCursor | null;
  /** cursor for newer pages (only for around/after loads; null = reached the newest) */
  start?: ArchiveCursor | null;
};

/** "Jump to Time" to a moment before the current chat began: ArchiveTimeline opens there. */
export const archiveJumpAtom = atom<{ roomId: string; ts: number } | undefined>(undefined);

const base = (mx: MatrixClient) => `${mx.baseUrl.replace(/\/+$/, '')}/wa-history`;

export const archiveFetch = async <T>(
  mx: MatrixClient,
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const res = await fetch(`${base(mx)}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${mx.getAccessToken() ?? ''}` },
  });
  if (!res.ok) throw new Error(`archive ${res.status}`);
  return (await res.json()) as T;
};

let linksPromise: Promise<Record<string, ArchiveLink[]>> | undefined;
let linksAt = 0;
const LINKS_TTL = 30 * 60 * 1000;

/** current room id -> its older rooms (cached per session, refreshed every 30 min). */
export const getArchiveLinks = (mx: MatrixClient): Promise<Record<string, ArchiveLink[]>> => {
  if (!linksPromise || Date.now() - linksAt > LINKS_TTL) {
    linksAt = Date.now();
    linksPromise = archiveFetch<{ rooms: Record<string, ArchiveLink[]> }>(mx, '/v1/links')
      .then((r) => (r && typeof r.rooms === 'object' && r.rooms ? r.rooms : {}))
      .catch(() => {
        linksAt = Date.now() - LINKS_TTL + 5 * 60 * 1000; // retry in 5 min
        return {};
      });
  }
  return linksPromise;
};

export const useArchiveLinks = (mx: MatrixClient, roomId: string): ArchiveLink[] | undefined => {
  const [links, setLinks] = useState<ArchiveLink[]>();
  useEffect(() => {
    let alive = true;
    getArchiveLinks(mx).then((all) => {
      const mine = all[roomId];
      if (alive) setLinks(Array.isArray(mine) ? mine : []);
    });
    return () => {
      alive = false;
    };
  }, [mx, roomId]);
  return links;
};

export const getArchiveMessages = (
  mx: MatrixClient,
  roomId: string,
  at: { before?: ArchiveCursor; after?: ArchiveCursor; around?: number } = {}
): Promise<ArchivePage> =>
  archiveFetch<ArchivePage>(mx, `/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
    limit: 40,
    before_ts: at.before?.ts,
    before_id: at.before?.id,
    after_ts: at.after?.ts,
    after_id: at.after?.id,
    around_ts: at.around,
  });

/** Oldest linked message of a chat (for date pickers), or undefined. */
export const earliestArchiveTs = (links: ArchiveLink[] | undefined): number | undefined => {
  const firsts = (links ?? []).map((l) => l.first_ts).filter((t) => typeof t === 'number');
  return firsts.length > 0 ? Math.min(...firsts) : undefined;
};

export type ArchiveSearch = { results: ArchiveEvent[]; profiles: ArchiveProfiles };

export const searchArchive = (
  mx: MatrixClient,
  term: string,
  rooms?: string[]
): Promise<ArchiveSearch> =>
  archiveFetch<ArchiveSearch>(mx, '/v1/search', {
    q: term,
    rooms: rooms?.join(','),
    limit: 40,
  });

/** Old m.room.member events (profile-picture history) of these users / the chat's contact. */
export const getArchiveMembers = (
  mx: MatrixClient,
  roomId: string,
  users: string[],
  contact: boolean
): Promise<{ chunk: ArchiveEvent[]; users: string[] }> =>
  archiveFetch(mx, `/v1/rooms/${encodeURIComponent(roomId)}/members`, {
    users: users.join(','),
    contact: contact ? 1 : 0,
  });

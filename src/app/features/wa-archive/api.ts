import { useEffect, useState } from 'react';
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
export type ArchivePage = {
  chunk: ArchiveEvent[];
  profiles: ArchiveProfiles;
  end: { ts: number; id: number } | null;
};

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
  before?: { ts: number; id: number }
): Promise<ArchivePage> =>
  archiveFetch<ArchivePage>(mx, `/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
    limit: 40,
    before_ts: before?.ts,
    before_id: before?.id,
  });

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

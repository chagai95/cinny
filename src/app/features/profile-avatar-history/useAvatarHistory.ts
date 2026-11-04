import { useEffect, useMemo, useState } from 'react';
import { Method, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { roomMessagesFetcher } from '../media-viewer/roomWalker';
import {
  AvatarHistoryEntry,
  collectHistoryEvents,
  extractMemberAvatarHistory,
  extractRoomAvatarHistory,
  memberHistoryFilter,
  roomAvatarHistoryFilter,
  StateLikeEvent,
} from './avatarHistory';
import {
  getDmPartnerUserId,
  getSamePersonGhostIds,
  isBridgedDm,
  LeftMemberEvent,
} from '../../utils/dmAvatar';
import { getArchiveMembers } from '../wa-archive/api';

export type AvatarHistoryState = {
  member: AvatarHistoryEntry[];
  room: AvatarHistoryEntry[];
  loading: boolean;
  /** false when the walk stopped at its bound and older pictures may exist. */
  complete: boolean;
  error?: string;
};

const cache = new Map<string, { at: number; events: StateLikeEvent[]; complete: boolean }>();
const CACHE_MS = 5 * 60 * 1000;

const fetchAll = async (
  mx: ReturnType<typeof useMatrixClient>,
  roomId: string,
  key: string,
  filter: Record<string, unknown>
) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const fetchPage = roomMessagesFetcher(mx, roomId, filter);
  const res = await collectHistoryEvents((from) => fetchPage('b', from, 100), 30);
  const entry = { at: Date.now(), events: res.events, complete: res.complete };
  cache.set(key, entry);
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
  return entry;
};

/** Members who left a bridged 1:1 chat (old ghosts of the contact), cached like the history. */
const fetchLeftMembers = async (
  mx: ReturnType<typeof useMatrixClient>,
  roomId: string
): Promise<LeftMemberEvent[]> => {
  const key = `${roomId}|left`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events as LeftMemberEvent[];
  try {
    const res = await mx.http.authedRequest<{ chunk: LeftMemberEvent[] }>(
      Method.Get,
      `/rooms/${encodeURIComponent(roomId)}/members`,
      { membership: 'leave' }
    );
    const events = res.chunk ?? [];
    cache.set(key, { at: Date.now(), events: events as StateLikeEvent[], complete: true });
    return events;
  } catch {
    return [];
  }
};

/**
 * Profile-picture history of `userId` (and/or the room's own picture) as this
 * room saw it. Shows the current pictures from room state immediately, then
 * fills in the history from `/messages` filtered on the member's own state
 * events.
 */
export const useAvatarHistory = (
  room: Room,
  userId: string | undefined,
  includeRoom: boolean
): AvatarHistoryState => {
  const mx = useMatrixClient();
  const currentMember = userId ? room.getMember(userId)?.getMxcAvatarUrl() : undefined;
  const currentRoom = room.currentState.getStateEvents('m.room.avatar', '')?.getContent()?.url as
    | string
    | undefined;

  const initial = useMemo<AvatarHistoryState>(
    () => ({
      member: userId ? extractMemberAvatarHistory([], userId, currentMember) : [],
      room: includeRoom ? extractRoomAvatarHistory([], currentRoom) : [],
      loading: true,
      complete: true,
    }),
    [userId, includeRoom, currentMember, currentRoom]
  );
  const [state, setState] = useState<AvatarHistoryState>(initial);

  useEffect(() => {
    let alive = true;
    setState(initial);
    (async () => {
      try {
        // In a bridged 1:1 chat the same contact can have several ghosts
        // (WhatsApp's move to LIDs): read all of their picture changes.
        const ghostIds =
          userId && isBridgedDm(room)
            ? getSamePersonGhostIds(room, userId, await fetchLeftMembers(mx, room.roomId))
            : userId && [userId];
        const [m, r] = await Promise.all([
          userId && ghostIds
            ? fetchAll(
                mx,
                room.roomId,
                `${room.roomId}|m|${ghostIds.join(',')}`,
                memberHistoryFilter(ghostIds)
              )
            : undefined,
          includeRoom
            ? fetchAll(mx, room.roomId, `${room.roomId}|r`, roomAvatarHistoryFilter())
            : undefined,
        ]);
        // older pictures from the linked older rooms (WhatsApp before Feb 2024), read-only
        const partner = isBridgedDm(room) ? getDmPartnerUserId(room) : undefined;
        const older =
          userId && ghostIds
            ? await getArchiveMembers(
                mx,
                room.roomId,
                ghostIds,
                !!partner && ghostIds.includes(partner)
              ).catch(() => ({ chunk: [], users: [] as string[] }))
            : { chunk: [], users: [] as string[] };
        const olderUsers = Array.isArray(older?.users) ? older.users : [];
        const olderEvents = Array.isArray(older?.chunk) ? (older.chunk as StateLikeEvent[]) : [];
        const allIds = ghostIds ? Array.from(new Set([...ghostIds, ...olderUsers])) : [];
        const memberEvents = [...(m?.events ?? []), ...olderEvents];
        if (!alive) return;
        setState({
          member:
            userId && ghostIds
              ? extractMemberAvatarHistory(
                  memberEvents,
                  allIds,
                  // tapped an old (retired) ghost: "current" is the live ghost's picture
                  ghostIds
                    .map((id) => room.getMember(id))
                    .find((mem) => mem?.membership === 'join')
                    ?.getMxcAvatarUrl() ?? currentMember
                )
              : [],
          room: includeRoom ? extractRoomAvatarHistory(r?.events ?? [], currentRoom) : [],
          loading: false,
          complete: (m?.complete ?? true) && (r?.complete ?? true),
        });
      } catch (e) {
        if (!alive) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [mx, room, userId, includeRoom, currentMember, currentRoom, initial]);

  return state;
};

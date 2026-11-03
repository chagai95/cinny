import React, { useCallback, useMemo, useState } from 'react';
import { Room } from 'matrix-js-sdk';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { MediaViewer, ViewerItem } from '../media-viewer/MediaViewer';
import { AvatarHistoryEntry, collapseHistory, describeHistoryEntry } from './avatarHistory';
import { useAvatarHistory } from './useAvatarHistory';
import { useContentKeys } from './contentKeys';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';

type AvatarHistoryViewerProps = {
  room: Room;
  userId?: string;
  includeRoom?: boolean;
  onClose: () => void;
};

const itemId = (mxc: string) => `avatar:${mxc}`;

const toItem = (entry: AvatarHistoryEntry, title: string, sender: string): ViewerItem => ({
  // keyed by picture, so the shown one stays put while repeats are folded away
  eventId: itemId(entry.mxc),
  ts: entry.since ?? entry.before ?? 0,
  sender,
  kind: 'image',
  body: title,
  mxc: entry.mxc,
  title,
  subtitle: describeHistoryEntry(entry),
});

/**
 * "Profile pictures" mode of the viewer: the current picture first, then the
 * earlier ones this room has seen, newest to oldest.
 */
export function AvatarHistoryViewer({
  room,
  userId,
  includeRoom,
  onClose,
}: AvatarHistoryViewerProps) {
  const history = useAvatarHistory(room, userId, !!includeRoom);
  const name = userId
    ? getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
    : room.name;

  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const all = useMemo(() => [...history.member, ...history.room], [history.member, history.room]);
  const allMxcs = useMemo(() => all.map((e) => e.mxc), [all]);
  // Each picture once: same mxc, or the same file re-uploaded under a new mxc.
  const { keyOf, pending } = useContentKeys(mx, history.loading ? [] : allMxcs, useAuthentication);
  const { entries, alias } = useMemo(() => collapseHistory(all, keyOf), [all, keyOf]);

  const items = useMemo(
    () =>
      entries.map((e) =>
        e.source === 'member'
          ? toItem(e, `${name} · profile picture`, userId ?? '')
          : toItem(e, userId ? `Chat picture (${room.name})` : `${room.name} · chat picture`, '')
      ),
    [entries, name, userId, room.name]
  );

  const [currentMxc, setCurrentMxc] = useState<string>();
  const index = useMemo(() => {
    if (!currentMxc) return 0;
    const target = alias.get(currentMxc) ?? currentMxc;
    const i = items.findIndex((it) => it.eventId === itemId(target));
    return i >= 0 ? i : 0;
  }, [items, alias, currentMxc]);
  const setIndex = useCallback(
    (i: number) => {
      const it = items[i];
      if (it?.mxc) setCurrentMxc(it.mxc);
    },
    [items]
  );

  const notes: string[] = [];
  if (!history.loading) {
    if (items.length === 1 && pending === 0)
      notes.push('Only the current picture is known in this chat.');
    if (pending > 0) notes.push(`Checking for repeated pictures (${pending} left)…`);
    if (!history.complete) notes.push('Older pictures may exist further back.');
    if (history.error) notes.push(`Could not load the history (${history.error}).`);
  }
  notes.push(
    'Pictures as this chat saw them: Matrix keeps no history of profile pictures outside a chat.'
  );

  return (
    <MediaViewer
      items={items}
      index={index}
      onIndexChange={setIndex}
      onClose={onClose}
      loading={history.loading}
      moreAfter={history.loading}
      label={`Profile pictures of ${name}`}
      banner={<span data-avatar-history-note>{notes.join(' ')}</span>}
      emptyText={history.loading ? undefined : 'No picture is set.'}
      roundThumbs
    />
  );
}

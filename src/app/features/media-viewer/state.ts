import { atom, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getDmPartnerUserId } from '../../utils/dmAvatar';
import { guessDmRoomUserId } from '../../utils/matrix';

/**
 * What the full-screen viewer is showing (mounted once, globally, by
 * <MediaViewerRenderer/> in the client root so it works from the timeline,
 * the room's Media page and the profile popup alike).
 */
export type MediaViewerRequest =
  | {
      mode: 'room';
      roomId: string;
      /** The picture/video that was tapped. */
      eventId: string;
      /** Re-use the walker that a grid already loaded (keeps its items). */
      walkerKey?: string;
    }
  | {
      mode: 'avatars';
      roomId: string;
      /** Whose picture history; undefined = only the room's own picture. */
      userId?: string;
      /** Also include the room picture (m.room.avatar) history, labelled. */
      includeRoom?: boolean;
    };

export const mediaViewerAtom = atom<MediaViewerRequest | undefined>(undefined);

export const useOpenMediaViewer = () => {
  const set = useSetAtom(mediaViewerAtom);
  return useCallback((req: MediaViewerRequest) => set(req), [set]);
};

export const useCloseMediaViewer = () => {
  const set = useSetAtom(mediaViewerAtom);
  return useCallback(() => set(undefined), [set]);
};

/**
 * Open the picture history of the other person in a 1:1 chat (header picture,
 * chat-list picture). In the chat list the members are often not loaded yet
 * (lazy loading), and then only the bridge bot is known: load them first, so
 * the contact is found and never the bot.
 */
export const openDmPictureHistory = async (
  mx: MatrixClient,
  room: Room,
  open: (req: MediaViewerRequest) => void
) => {
  const pick = () => getDmPartnerUserId(room, guessDmRoomUserId(room, mx.getSafeUserId()));
  let userId = pick();
  if (!userId) {
    try {
      await room.loadMembersIfNeeded();
    } catch {
      // offline: open what we know
    }
    userId = pick();
  }
  open({ mode: 'avatars', roomId: room.roomId, userId, includeRoom: true });
};

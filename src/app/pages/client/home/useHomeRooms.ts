import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useSelectedRooms } from '../../../state/hooks/roomList';
import { isRoom } from '../../../utils/room';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const rooms = useSelectedRooms(
    allRoomsAtom,
    useCallback(
      (roomId) => isRoom(mx.getRoom(roomId)) && !mDirects.has(roomId),
      [mx, mDirects]
    )
  );
  return rooms;
};

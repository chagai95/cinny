import { useCallback } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAsyncCallback, AsyncStatus } from '../../hooks/useAsyncCallback';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useAlive } from '../../hooks/useAlive';
import { startWhatsAppChat } from './waBridge';

/**
 * React hook wrapping the client-side WhatsApp-start flow.
 *
 * Returns an async-state machine plus a `start(e164)` trigger. On success it
 * navigates the app to the newly-created WhatsApp DM room (only if the component
 * is still mounted).
 */
export function useStartWhatsAppChat() {
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const alive = useAlive();

  const [state, startCb] = useAsyncCallback<string, Error, [string]>(
    useCallback((e164: string) => startWhatsAppChat(mx, e164), [mx])
  );

  const start = useCallback(
    (e164: string) => {
      startCb(e164).then((roomId) => {
        if (alive() && roomId) {
          navigateRoom(roomId);
        }
      });
    },
    [startCb, alive, navigateRoom]
  );

  return {
    state,
    start,
    loading: state.status === AsyncStatus.Loading,
    error: state.status === AsyncStatus.Error ? state.error : undefined,
  };
}

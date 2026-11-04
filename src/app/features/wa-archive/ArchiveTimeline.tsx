import React, { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Room } from 'matrix-js-sdk';
import { Box, Line, Spinner, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ArchiveEvent, ArchiveProfiles, getArchiveMessages, useArchiveLinks } from './api';
import { ArchiveEventList } from './ArchiveEventList';

const monthYear = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

type ArchiveTimelineProps = {
  room: Room;
  scrollRef: RefObject<HTMLElement>;
};

/**
 * Shown above the first message of a WhatsApp chat once the timeline reached
 * its start: the chat's older history from the linked older rooms, loaded page
 * by page while scrolling up. Read-only.
 */
export function ArchiveTimeline({ room, scrollRef }: ArchiveTimelineProps) {
  const mx = useMatrixClient();
  const links = useArchiveLinks(mx, room.roomId);
  const [events, setEvents] = useState<ArchiveEvent[]>([]); // oldest first
  const [profiles, setProfiles] = useState<ArchiveProfiles>({});
  const [cursor, setCursor] = useState<{ ts: number; id: number } | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const busy = useRef(false);

  const has = !!links && links.length > 0;
  const total = links?.reduce((n, l) => n + l.messages, 0) ?? 0;

  const loadOlder = useCallback(async () => {
    if (busy.current || cursor === null || !has) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await getArchiveMessages(mx, room.roomId, cursor);
      const scroller = scrollRef.current;
      // keep what is on screen in place while older messages are added above it
      if (scroller) anchor.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.event_id));
        const older = (Array.isArray(page.chunk) ? page.chunk : [])
          .filter((e) => !seen.has(e.event_id))
          .reverse();
        return [...older, ...prev];
      });
      setProfiles((prev) => {
        const next = { ...prev };
        Object.entries(page.profiles ?? {}).forEach(([r, p]) => {
          next[r] = { ...(next[r] ?? {}), ...p };
        });
        return next;
      });
      setCursor(page.end ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [mx, room.roomId, cursor, has, scrollRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const a = anchor.current;
    if (!scroller || !a) return;
    anchor.current = null;
    scroller.scrollTop = a.top + (scroller.scrollHeight - a.height);
  }, [events, scrollRef]);

  // first page as soon as the start of the chat is reached, then on scrolling up
  useEffect(() => {
    if (has && cursor === undefined) loadOlder();
  }, [has, cursor, loadOlder]);

  useEffect(() => {
    const el = topRef.current;
    const root = scrollRef.current;
    if (!el || !root || cursor === null || !has) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder();
      },
      { root, rootMargin: '600px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadOlder, cursor, has, scrollRef]);

  if (!has) return null;
  const created = room.currentState.getStateEvents('m.room.create', '')?.getTs();
  const before = created ? monthYear(created) : undefined;

  return (
    <Box direction="Column" data-wa-archive>
      <div ref={topRef} />
      {cursor === null && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }} data-wa-archive-start>
          <Text size="T200" priority="300">
            Start of the earlier messages
          </Text>
        </Box>
      )}
      {(loading || cursor === undefined) && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
          <Spinner variant="Secondary" size="300" />
        </Box>
      )}
      {failed && (
        <Box justifyContent="Center" style={{ padding: config.space.S300 }}>
          <Text size="T200" priority="300">
            Could not load the earlier messages.
          </Text>
        </Box>
      )}
      <ArchiveEventList room={room} events={events} profiles={profiles} />
      <Box
        alignItems="Center"
        gap="300"
        style={{ padding: `${config.space.S400} ${config.space.S400}` }}
        data-wa-archive-divider
      >
        <Line style={{ flexGrow: 1 }} variant="Surface" size="300" />
        <Text size="T200" priority="300" style={{ textAlign: 'center' }}>
          {`Earlier${
            before ? ` (before ${before})` : ''
          } · ${total.toLocaleString()} older messages, read-only`}
        </Text>
        <Line style={{ flexGrow: 1 }} variant="Surface" size="300" />
      </Box>
    </Box>
  );
}

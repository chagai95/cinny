import React, { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Room } from 'matrix-js-sdk';
import { Box, Line, Spinner, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  ArchiveCursor,
  ArchiveEvent,
  ArchivePage,
  ArchiveProfiles,
  archiveJumpAtom,
  getArchiveMessages,
  useArchiveLinks,
} from './api';
import { ArchiveEventList } from './ArchiveEventList';

const monthYear = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

type ArchiveTimelineProps = {
  room: Room;
  scrollRef: RefObject<HTMLElement>;
};

const mergeProfiles = (prev: ArchiveProfiles, page: ArchivePage): ArchiveProfiles => {
  const next = { ...prev };
  Object.entries(page.profiles ?? {}).forEach(([r, p]) => {
    next[r] = { ...(next[r] ?? {}), ...p };
  });
  return next;
};
const chunkOf = (page: ArchivePage) => (Array.isArray(page.chunk) ? page.chunk : []);

/**
 * Shown above the first message of a WhatsApp chat once the timeline reached
 * its start: the chat's older history from the linked older rooms, loaded page
 * by page while scrolling (up for older, down for newer after a Jump to Time).
 * Read-only.
 */
export function ArchiveTimeline({ room, scrollRef }: ArchiveTimelineProps) {
  const mx = useMatrixClient();
  const links = useArchiveLinks(mx, room.roomId);
  const [jump, setJump] = useAtom(archiveJumpAtom);
  const [events, setEvents] = useState<ArchiveEvent[]>([]); // oldest first
  const [profiles, setProfiles] = useState<ArchiveProfiles>({});
  // undefined = not loaded yet; null = no more in that direction
  const [olderCursor, setOlderCursor] = useState<ArchiveCursor | null | undefined>(undefined);
  const [newerCursor, setNewerCursor] = useState<ArchiveCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<number>();
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const busy = useRef(false);

  const has = !!links && links.length > 0;
  const total = links?.reduce((n, l) => n + l.messages, 0) ?? 0;

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      await fn();
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(
    () =>
      run(async () => {
        if (olderCursor === null || !has) return;
        const page = await getArchiveMessages(
          mx,
          room.roomId,
          olderCursor ? { before: olderCursor } : {}
        );
        const scroller = scrollRef.current;
        // keep what is on screen in place while older messages are added above it
        if (scroller) anchor.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.event_id));
          return [
            ...chunkOf(page)
              .filter((e) => !seen.has(e.event_id))
              .reverse(),
            ...prev,
          ];
        });
        setProfiles((prev) => mergeProfiles(prev, page));
        setOlderCursor(page.end ?? null);
      }),
    [run, olderCursor, has, mx, room.roomId, scrollRef]
  );

  const loadNewer = useCallback(
    () =>
      run(async () => {
        if (!newerCursor || !has) return;
        const page = await getArchiveMessages(mx, room.roomId, { after: newerCursor });
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.event_id));
          return [
            ...prev,
            ...chunkOf(page)
              .filter((e) => !seen.has(e.event_id))
              .reverse(),
          ];
        });
        setProfiles((prev) => mergeProfiles(prev, page));
        setNewerCursor(page.start ?? null);
      }),
    [run, newerCursor, has, mx, room.roomId]
  );

  // Jump to Time to a moment before this chat began: open the archive there
  const jumpTs = jump && jump.roomId === room.roomId ? jump.ts : undefined;
  useEffect(() => {
    if (!has || jumpTs === undefined) return;
    setJump(undefined);
    run(async () => {
      const page = await getArchiveMessages(mx, room.roomId, { around: jumpTs });
      setEvents(chunkOf(page).slice().reverse());
      setProfiles((prev) => mergeProfiles(prev, page));
      setOlderCursor(page.end ?? null);
      setNewerCursor(page.start ?? null);
      setTarget(jumpTs);
    });
  }, [has, jumpTs, setJump, run, mx, room.roomId]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const a = anchor.current;
    if (!scroller || !a) return;
    anchor.current = null;
    scroller.scrollTop = a.top + (scroller.scrollHeight - a.height);
  }, [events, scrollRef]);

  // after a jump: bring the first message at/after the chosen moment into view
  useEffect(() => {
    if (target === undefined || events.length === 0) return undefined;
    const ev = events.find((e) => e.origin_server_ts >= target) ?? events[events.length - 1];
    const show = () => {
      const el = scrollRef.current?.querySelector(
        `[data-archive-event-id="${CSS.escape(ev.event_id)}"]`
      );
      el?.scrollIntoView({ block: 'start' });
    };
    show();
    // the timeline may still settle its own scroll position right after opening
    const t1 = setTimeout(show, 400);
    const t2 = setTimeout(() => {
      show();
      setTarget(undefined);
    }, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [target, events, scrollRef]);

  // first page as soon as the start of the chat is reached (unless a jump is pending)
  useEffect(() => {
    if (has && olderCursor === undefined && jumpTs === undefined && events.length === 0)
      loadOlder();
  }, [has, olderCursor, jumpTs, events.length, loadOlder]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !has) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (target !== undefined) return; // let a jump settle first
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          if (e.target === topRef.current && olderCursor) loadOlder();
          if (e.target === bottomRef.current && newerCursor) loadNewer();
        });
      },
      { root, rootMargin: '600px 0px 600px 0px' }
    );
    if (topRef.current) io.observe(topRef.current);
    if (bottomRef.current) io.observe(bottomRef.current);
    return () => io.disconnect();
  }, [loadOlder, loadNewer, olderCursor, newerCursor, has, scrollRef, target]);

  if (!has) return null;
  const created = room.currentState.getStateEvents('m.room.create', '')?.getTs();
  const before = created ? monthYear(created) : undefined;

  return (
    <Box direction="Column" data-wa-archive>
      <div ref={topRef} />
      {olderCursor === null && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }} data-wa-archive-start>
          <Text size="T200" priority="300">
            Start of the earlier messages
          </Text>
        </Box>
      )}
      {(loading || olderCursor === undefined) && !newerCursor && (
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
      <div ref={bottomRef} />
      {newerCursor && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }} data-wa-archive-newer>
          <Spinner variant="Secondary" size="300" />
        </Box>
      )}
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

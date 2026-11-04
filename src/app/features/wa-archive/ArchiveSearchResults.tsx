import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Header, Line, Spinner, Text, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { SequenceCard } from '../../components/sequence-card';
import { ArchiveEvent, searchArchive } from './api';
import { ArchiveEventList } from './ArchiveEventList';

type ArchiveSearchResultsProps = {
  term: string;
  /** undefined = all chats */
  rooms?: string[];
  onCount?: (n: number) => void;
};

/** Search results from the older (linked) WhatsApp history, grouped by the current chat. */
export function ArchiveSearchResults({ term, rooms, onCount }: ArchiveSearchResultsProps) {
  const mx = useMatrixClient();
  const { data, status } = useQuery({
    queryKey: ['archive-search', term, rooms],
    queryFn: () => searchArchive(mx, term, rooms),
    enabled: term.trim().length >= 2,
    staleTime: 60 * 1000,
  });

  const groups = useMemo(() => {
    const out: { roomId: string; events: ArchiveEvent[] }[] = [];
    (Array.isArray(data?.results) ? data?.results ?? [] : []).forEach((e) => {
      const roomId = e.unsigned?.['chagai.current_room'] ?? e.room_id;
      const g = out.find((x) => x.roomId === roomId);
      if (g) g.events.push(e);
      else out.push({ roomId, events: [e] });
    });
    return out;
  }, [data]);

  React.useEffect(() => {
    onCount?.(data?.results?.length ?? 0);
  }, [data, onCount]);

  if (status === 'pending') {
    return (
      <Box gap="200" alignItems="Center" style={{ padding: config.space.S300 }}>
        <Spinner size="200" variant="Secondary" />
        <Text size="T300" priority="300">
          Searching earlier messages…
        </Text>
      </Box>
    );
  }
  if (status === 'error' || groups.length === 0) return null;

  return (
    <Box direction="Column" gap="300" data-archive-search>
      <Box direction="Column" gap="200">
        <Text size="H5">Earlier messages (before Feb 2024)</Text>
        <Line size="300" variant="Surface" />
      </Box>
      {groups.map((g) => {
        const room = mx.getRoom(g.roomId);
        if (!room) return null;
        return (
          <Box key={g.roomId} direction="Column" gap="200">
            <Header size="300">
              <Text size="H4" truncate>
                {room.name}
              </Text>
            </Header>
            <SequenceCard variant="SurfaceVariant" direction="Column">
              <ArchiveEventList
                room={room}
                events={g.events}
                profiles={data?.profiles ?? {}}
                highlights={[term]}
              />
            </SequenceCard>
          </Box>
        );
      })}
    </Box>
  );
}

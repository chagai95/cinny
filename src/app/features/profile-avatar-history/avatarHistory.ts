/**
 * Profile-picture history, reconstructed from a room's state history.
 *
 * Matrix keeps no global history of profile pictures. What it does keep is,
 * per room, one `m.room.member` state event every time a member's profile
 * changes (the homeserver re-sends it into every room when someone changes
 * their picture; the WhatsApp bridge does the same for its `@whatsapp_…`
 * ghosts). Each of those carries the `avatar_url` that was current at that
 * moment, and `unsigned.prev_content` carries the one before. Walking them
 * newest -> oldest gives the sequence of pictures *as this room saw it*.
 *
 * The same works for the room's own picture (`m.room.avatar`), which in
 * bridged WhatsApp DMs can be a stale copy set once by the bridge.
 *
 * Pure functions — unit-tested in scripts/test-media-gallery.mjs.
 */

export type StateLikeEvent = {
  event_id?: string;
  type: string;
  sender?: string;
  state_key?: string;
  origin_server_ts?: number;
  content?: Record<string, any>;
  unsigned?: Record<string, any>;
};

export type AvatarSource = 'member' | 'room';

export type AvatarHistoryEntry = {
  mxc: string;
  source: AvatarSource;
  /** When this picture was set (the oldest event in the run that carried it). */
  since?: number;
  /** Only known to be in use before this time (from `prev_content`). */
  before?: number;
  /** When it was replaced by the next (newer) picture. */
  until?: number;
  eventId?: string;
  current?: boolean;
};

const isMxc = (v: unknown): v is string => typeof v === 'string' && v.startsWith('mxc://');

const byTsDesc = (a: StateLikeEvent, b: StateLikeEvent) =>
  (b.origin_server_ts ?? 0) - (a.origin_server_ts ?? 0);

type Picked = { mxc: string | undefined; ev: StateLikeEvent; prev: string | undefined };

const buildHistory = (
  picked: Picked[],
  source: AvatarSource,
  currentMxc: string | undefined
): AvatarHistoryEntry[] => {
  const out: AvatarHistoryEntry[] = [];
  // picked is newest -> oldest
  picked.forEach(({ mxc, ev }) => {
    if (!isMxc(mxc)) return; // picture removed / not set: not an entry
    const last = out[out.length - 1];
    if (last && last.mxc === mxc) {
      // Same picture again (a display-name change, a re-join…): it was in use
      // since at least this older event.
      last.since = ev.origin_server_ts ?? last.since;
      last.eventId = ev.event_id ?? last.eventId;
      return;
    }
    out.push({ mxc, source, since: ev.origin_server_ts, eventId: ev.event_id });
  });
  // `until` = the moment the next newer picture replaced it.
  for (let i = 1; i < out.length; i += 1) {
    out[i].until = out[i - 1].since;
  }

  // The oldest event also tells us what came before it.
  const oldest = picked[picked.length - 1];
  if (oldest && isMxc(oldest.prev)) {
    const last = out[out.length - 1];
    if (!last || last.mxc !== oldest.prev) {
      out.push({
        mxc: oldest.prev,
        source,
        before: oldest.ev.origin_server_ts,
        until: oldest.ev.origin_server_ts,
      });
    }
  }

  if (isMxc(currentMxc)) {
    if (out.length === 0 || out[0].mxc !== currentMxc) {
      out.unshift({ mxc: currentMxc, source });
    }
  }
  if (out.length > 0 && (!isMxc(currentMxc) || out[0].mxc === currentMxc)) {
    out[0].current = isMxc(currentMxc) ? true : out[0].current;
    out[0].until = undefined;
  }
  return out;
};

/**
 * Picture history of `userId` in one room, newest first. `events` may be in any
 * order and may contain unrelated events; `currentMxc` is the picture the room
 * state says is current now (shown first even if no event was found).
 */
export const extractMemberAvatarHistory = (
  events: StateLikeEvent[],
  userId: string | string[],
  currentMxc?: string
): AvatarHistoryEntry[] => {
  // Several ids = the same person under several bridge ghosts (WhatsApp moved
  // contacts from "@whatsapp_<phone>" to "@whatsapp_lid-<id>" on 2026-10-31:
  // the old pictures sit on the old ghost, the new ghost has only the latest).
  const ids = new Set(Array.isArray(userId) ? userId : [userId]);
  const picked: Picked[] = events
    .filter((e) => e && e.type === 'm.room.member' && !!e.state_key && ids.has(e.state_key))
    .filter((e) => {
      const m = e.content?.membership;
      // leave / ban events carry no profile; they say nothing about the picture
      return m === 'join' || m === 'invite' || m === undefined;
    })
    .sort(byTsDesc)
    .map((ev) => ({
      mxc: ev.content?.avatar_url,
      ev,
      prev:
        ev.unsigned?.prev_content?.membership === 'join' ||
        ev.unsigned?.prev_content?.membership === 'invite'
          ? ev.unsigned?.prev_content?.avatar_url
          : undefined,
    }));
  return buildHistory(picked, 'member', currentMxc);
};

/** History of the room's own picture (`m.room.avatar`), newest first. */
export const extractRoomAvatarHistory = (
  events: StateLikeEvent[],
  currentMxc?: string
): AvatarHistoryEntry[] => {
  const picked: Picked[] = events
    .filter((e) => e && e.type === 'm.room.avatar' && (e.state_key ?? '') === '')
    .sort(byTsDesc)
    .map((ev) => ({
      mxc: ev.content?.url,
      ev,
      prev: ev.unsigned?.prev_content?.url,
    }));
  return buildHistory(picked, 'room', currentMxc);
};

/** Filter for `/rooms/{id}/messages` that returns only these users' own member events. */
export const memberHistoryFilter = (userId: string | string[]) => ({
  types: ['m.room.member'],
  senders: Array.isArray(userId) ? userId : [userId],
  lazy_load_members: false,
});

/**
 * Each picture once, newest first.
 *
 * Bridges re-upload the SAME picture under a new mxc:// again and again (Bea's
 * old WhatsApp ghost: 895 different mxc URLs for 144 different files), and a
 * picture can come back later (A → B → A). `keyOf(mxc)` gives a content key
 * (hash of the server thumbnail) when known; unknown ones are keyed by mxc.
 * A repeat directly after its twin extends that entry's "set" date; a later
 * repeat is dropped. `alias` maps every dropped mxc to the entry kept for it.
 */
export const collapseHistory = (
  entries: AvatarHistoryEntry[],
  keyOf: (mxc: string) => string | undefined = () => undefined
): { entries: AvatarHistoryEntry[]; alias: Map<string, string> } => {
  const out: AvatarHistoryEntry[] = [];
  const alias = new Map<string, string>();
  const keptByKey = new Map<string, AvatarHistoryEntry>();
  entries.forEach((entry) => {
    const key = keyOf(entry.mxc) ?? `mxc:${entry.mxc}`;
    const kept = keptByKey.get(key) ?? keptByKey.get(`mxc:${entry.mxc}`);
    if (!kept) {
      const copy = { ...entry };
      out.push(copy);
      keptByKey.set(key, copy);
      keptByKey.set(`mxc:${entry.mxc}`, copy);
      return;
    }
    if (kept.mxc !== entry.mxc) alias.set(entry.mxc, kept.mxc);
    if (out[out.length - 1] === kept && kept.source === entry.source) {
      // the same picture again right before: it was in use since the older one
      if (entry.since !== undefined) kept.since = entry.since;
      else if (entry.before !== undefined && kept.since === undefined) kept.before = entry.before;
      kept.eventId = entry.eventId ?? kept.eventId;
    }
  });
  return { entries: out, alias };
};

export const roomAvatarHistoryFilter = () => ({ types: ['m.room.avatar'] });

export type HistoryPage = { chunk: StateLikeEvent[]; end?: string };

/**
 * Pages backwards from the newest event collecting everything the filter
 * returns. Bounded (`maxPages`) so a huge room can never stall the viewer;
 * `complete` tells the UI whether older pictures may exist beyond the bound.
 */
export const collectHistoryEvents = async (
  fetchPage: (from: string | undefined) => Promise<HistoryPage>,
  maxPages = 20
): Promise<{ events: StateLikeEvent[]; complete: boolean; requests: number }> => {
  const events: StateLikeEvent[] = [];
  let from: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage(from);
    const chunk = page.chunk ?? [];
    events.push(...chunk);
    if (!page.end || chunk.length === 0 || page.end === from) {
      return { events, complete: true, requests: i + 1 };
    }
    from = page.end;
  }
  return { events, complete: false, requests: maxPages };
};

/** "3 Mar 2026" */
export const formatHistoryDate = (ts: number | undefined, locale?: string): string =>
  typeof ts === 'number'
    ? new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

/** Human label for one entry: "Current picture · since 3 Mar 2026", "Changed 3 Mar 2026"… */
export const describeHistoryEntry = (entry: AvatarHistoryEntry, locale?: string): string => {
  const since = formatHistoryDate(entry.since, locale);
  const before = formatHistoryDate(entry.before, locale);
  const until = formatHistoryDate(entry.until, locale);
  if (entry.current) {
    if (since) return `Current picture · set ${since}`;
    return 'Current picture';
  }
  if (since && until) return `Set ${since} · replaced ${until}`;
  if (since) return `Set ${since}`;
  if (before) return `Used before ${before}`;
  return 'Earlier picture';
};

import { ClientEvent, IContent, MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { getMxIdServer } from '../../utils/matrix';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp bridge configuration.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These constants control how we talk to the mautrix-whatsapp bridge bot.
 *
 * Verified against Chagai's server (2026-07-23, read-only DB check):
 *  - The bridge bot is `@whatsappbot:chagai.website` (joined to each user's
 *    management room).
 *  - `!wa pm <e164>` is the correct command (confirmed from real management-room
 *    history — `!wa pn` returns "Unknown command"; `!wa pm +<number>` works).
 *  - The command is issued **as whoever is logged in** to this Cinny instance,
 *    into that account's WhatsApp bridge **management room**. For the
 *    connect-bern-chat deployment (always logged in as `@stayinginbern`) that
 *    room is `!DXORRePztlYSpKZzwZ:chagai.website` (members: @stayinginbern +
 *    @whatsappbot). So we DEFAULT the management room to that id, but keep it
 *    configurable and fall back to auto-discovery if the fixed room isn't
 *    joined (e.g. when a different account is logged in).
 *
 * Everything the feature needs to be re-pointed is isolated to this object so no
 * other file has to change.
 */
export type WaBridgeConfig = {
  /**
   * Fixed room id of the bridge-bot **management room** to send `!wa pm` into.
   * This is the primary target. If the logged-in user is NOT joined to it, we
   * fall back to discovering the management room by the bot's presence (see
   * `findBridgeBotRoom`).
   */
  managementRoomId?: string;
  /** Localpart of the bridge bot (no @, no :server). Used for discovery + reply matching. */
  bridgeBotLocalpart: string;
  /**
   * Full bot user id override. Leave undefined to derive it as
   * `@<bridgeBotLocalpart>:<logged-in user's server>`.
   */
  bridgeBotUserIdOverride?: string;
  /** Command template; `{number}` → E.164 with leading +. */
  pmCommandTemplate: string;
  /** Max wait for a result (new DM, or the bot's reply) before giving up (ms). */
  newRoomTimeoutMs: number;
};

export const WA_BRIDGE_CONFIG: WaBridgeConfig = {
  // Verified: @stayinginbern's WhatsApp bridge management room on chagai.website.
  // The connect-bern-chat Cinny instance is always logged in as @stayinginbern,
  // so `!wa pm` goes here. Falls back to discovery for any other account.
  managementRoomId: '!DXORRePztlYSpKZzwZ:chagai.website',
  bridgeBotLocalpart: 'whatsappbot',
  bridgeBotUserIdOverride: undefined,
  pmCommandTemplate: '!wa pm {number}',
  // 45s: give the bridge time to resolve the number + create/invite the portal,
  // OR to reply "already have a chat" / "not on WhatsApp".
  newRoomTimeoutMs: 45_000,
};

/** Resolve the bridge-bot user id for the current client/session. */
export function resolveBridgeBotUserId(mx: MatrixClient, cfg = WA_BRIDGE_CONFIG): string {
  if (cfg.bridgeBotUserIdOverride) return cfg.bridgeBotUserIdOverride;
  const myUserId = mx.getUserId() ?? '';
  const server = getMxIdServer(myUserId) ?? 'chagai.website';
  return `@${cfg.bridgeBotLocalpart}:${server}`;
}

/** Build the `!wa pm <number>` command body from an E.164 string. */
export function buildPmCommand(e164: string, cfg = WA_BRIDGE_CONFIG): string {
  return cfg.pmCommandTemplate.replace('{number}', e164);
}

/**
 * Find the management/DM room with the WhatsApp bridge bot. This is the room
 * where `!wa` commands are issued. We PREFER the configured fixed room id (if we
 * are joined to it); otherwise we discover it: a JOINED room that contains the
 * bot as a member and is small (a DM/management room, not a big portal). We
 * deliberately do NOT require encryption here (the bridge management room is
 * typically unencrypted), which is why we can't reuse `getDMRoomFor`.
 *
 * If several candidates exist we prefer:
 *   1) a 2-member room (just me + bot),
 *   2) then the smallest room,
 *   3) then the most recently active.
 */
export function findBridgeBotRoom(mx: MatrixClient, cfg = WA_BRIDGE_CONFIG): Room | undefined {
  // 1) Fixed, verified management room — use it if we're actually joined.
  if (cfg.managementRoomId) {
    const fixed = mx.getRoom(cfg.managementRoomId);
    if (fixed && fixed.getMyMembership() === Membership.Join) return fixed;
  }

  // 2) Fall back to discovery (different logged-in account, or room not synced).
  const botUserId = resolveBridgeBotUserId(mx, cfg);
  const myUserId = mx.getUserId() ?? '';

  const candidates = mx.getRooms().filter((room) => {
    if (room.getMyMembership() !== Membership.Join) return false;
    const botMember = room.getMember(botUserId);
    if (!botMember) return false;
    // Bot must actually be in the room, and it must be a small room
    // (management/DM), not a group portal.
    const joined = room.getJoinedMembers().length;
    return joined <= 3 && room.getMember(myUserId) !== null;
  });

  candidates.sort((a, b) => {
    const aTwo = a.getJoinedMembers().length === 2 ? 0 : 1;
    const bTwo = b.getJoinedMembers().length === 2 ? 0 : 1;
    if (aTwo !== bTwo) return aTwo - bTwo;
    const sizeDiff = a.getJoinedMembers().length - b.getJoinedMembers().length;
    if (sizeDiff !== 0) return sizeDiff;
    return (b.getLastActiveTimestamp() ?? 0) - (a.getLastActiveTimestamp() ?? 0);
  });

  return candidates[0];
}

/** Snapshot of the room ids the client currently knows (joined or invited). */
export function knownRoomIds(mx: MatrixClient): Set<string> {
  const set = new Set<string>();
  mx.getRooms().forEach((room) => {
    const m = room.getMyMembership();
    if (m === Membership.Join || m === Membership.Invite) set.add(room.roomId);
  });
  return set;
}

/**
 * Heuristic: does this room look like the WhatsApp DM the bridge just created
 * for our `!wa pm` command? A freshly-bridged WhatsApp DM:
 *   - we are joined OR invited,
 *   - it is a small (<= 2 real user) room,
 *   - it is NOT the bridge management room itself,
 *   - (best signal) the bridge bot is present, since mautrix invites via the bot.
 * The caller also filters by "not previously known", so this only needs to
 * distinguish a new portal from unrelated new rooms.
 */
export function looksLikeNewWaDm(
  mx: MatrixClient,
  room: Room,
  botRoomId: string | undefined,
  cfg = WA_BRIDGE_CONFIG
): boolean {
  if (room.roomId === botRoomId) return false;
  const membership = room.getMyMembership();
  if (membership !== Membership.Join && membership !== Membership.Invite) return false;

  const botUserId = resolveBridgeBotUserId(mx, cfg);
  const myUserId = mx.getUserId() ?? '';

  // Members excluding me and the bot → the actual WhatsApp contact(s).
  const otherMembers = room
    .getMembers()
    .filter((m) => m.userId !== myUserId && m.userId !== botUserId);

  // A DM portal has exactly one "other" party (the contact). Allow 0 too, because
  // right at creation the contact ghost may not have synced yet.
  return otherMembers.length <= 1;
}

/**
 * Parse a matrix.to room link out of the bridge bot's reply. mautrix formats the
 * "you already have a direct chat" reply with a link like
 *   https://matrix.to/#/!roomid:server   (plain body) OR
 *   https://matrix.to/#/%21roomid%3Aserver   (url-encoded, in formatted_body)
 * Returns the `!roomid:server` or `!roomid` string, or undefined.
 */
export function parseRoomIdFromMatrixTo(text: string): string | undefined {
  if (!text) return undefined;
  // Match both encoded (%21 / %3A) and plain (! / :) forms.
  const m = text.match(/matrix\.to\/#\/(%21|!)([^/\s"<]+)/i);
  if (!m) return undefined;
  let rest = decodeURIComponent(m[2]);
  // rest is the localpart(+:server) after the '!'. Strip any trailing junk.
  rest = rest.replace(/[)>"'].*$/, '');
  return `!${rest}`;
}

/** What the bridge bot's reply to `!wa pm` told us. */
export type BotReply =
  | { kind: 'existing'; roomId: string } // "you already have a direct chat …"
  | { kind: 'notOnWhatsApp'; body: string } // "… is not on WhatsApp"
  | { kind: 'error'; body: string } // any other bot error/notice
  | { kind: 'other'; body: string }; // unrecognized (ignored)

/**
 * Classify a bridge-bot message body/formatted_body posted in the management room
 * in response to our command.
 */
export function classifyBotReply(body: string, formattedBody?: string): BotReply {
  const text = `${body ?? ''}\n${formattedBody ?? ''}`;
  const lower = text.toLowerCase();

  if (lower.includes('already have a direct chat') || lower.includes('already have a chat')) {
    const roomId = parseRoomIdFromMatrixTo(text);
    if (roomId) return { kind: 'existing', roomId };
    // We know a chat exists but couldn't parse the link — treat as a soft error.
    return { kind: 'error', body: body || 'You already have a chat with this number.' };
  }
  if (
    lower.includes('is not on whatsapp') ||
    lower.includes('not on whatsapp') ||
    lower.includes('failed to resolve identifier')
  ) {
    return { kind: 'notOnWhatsApp', body };
  }
  if (
    lower.includes('unknown command') ||
    lower.includes('usage:') ||
    lower.includes('error') ||
    lower.includes('failed')
  ) {
    return { kind: 'error', body };
  }
  return { kind: 'other', body };
}

export type WaitOutcome =
  | { kind: 'room'; roomId: string } // a WhatsApp DM to open (new OR existing)
  | { kind: 'notOnWhatsApp'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

export type WaitForRoomOptions = {
  timeoutMs?: number;
  botRoomId?: string;
  /** room ids that existed BEFORE the command was sent (to ignore). */
  preexisting: Set<string>;
  /** timestamp (ms) the command was sent; only newer bot replies count. */
  sinceTs: number;
  cfg?: WaBridgeConfig;
};

/**
 * Wait for the bridge to respond to our `!wa pm` command. Resolves as soon as ANY
 * of these happens:
 *   - a NEW WhatsApp DM room appears (→ open it),
 *   - the bot replies "you already have a direct chat …" (→ open that room),
 *   - the bot replies "… is not on WhatsApp" (→ friendly message),
 *   - any other bot error notice (→ surface it),
 *   - or the timeout elapses (→ timeout).
 *
 * This is the fix for the old bug where the flow only handled "new room created"
 * and otherwise hung for the full timeout and threw a scary error even though the
 * bot had already answered (the very common "already have a chat" case).
 */
export function waitForWaResult(mx: MatrixClient, opts: WaitForRoomOptions): Promise<WaitOutcome> {
  const cfg = opts.cfg ?? WA_BRIDGE_CONFIG;
  const timeoutMs = opts.timeoutMs ?? cfg.newRoomTimeoutMs;
  const botUserId = resolveBridgeBotUserId(mx, cfg);

  return new Promise((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];

    const finish = (outcome: WaitOutcome) => {
      if (settled) return;
      settled = true;
      cleanups.forEach((fn) => fn());
      resolve(outcome);
    };

    // (a) A brand-new WhatsApp DM room shows up.
    const considerRoom = (room: Room) => {
      if (opts.preexisting.has(room.roomId)) return;
      if (looksLikeNewWaDm(mx, room, opts.botRoomId, cfg)) {
        finish({ kind: 'room', roomId: room.roomId });
      }
    };

    // (b) The bot posts a reply in the management room.
    const considerTimeline = (event: MatrixEvent, room?: Room) => {
      if (settled) return;
      if (opts.botRoomId && room && room.roomId !== opts.botRoomId) return;
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() !== botUserId) return;
      // Ignore replies from before we issued the command.
      if ((event.getTs() ?? 0) < opts.sinceTs - 1000) return;

      const content = event.getContent();
      const reply = classifyBotReply(content.body ?? '', content.formatted_body);
      if (reply.kind === 'existing') {
        finish({ kind: 'room', roomId: reply.roomId });
      } else if (reply.kind === 'notOnWhatsApp') {
        finish({
          kind: 'notOnWhatsApp',
          message: "That number isn't on WhatsApp, so no chat could be started.",
        });
      } else if (reply.kind === 'error') {
        finish({ kind: 'error', message: reply.body });
      }
      // 'other' → ignore (e.g. state/keepalive notices); keep waiting.
    };

    const onRoom = (room: Room) => considerRoom(room);
    const onMembership = (room: Room) => considerRoom(room);
    const onTimeline = (event: MatrixEvent, room?: Room) => considerTimeline(event, room);
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);

    mx.on(ClientEvent.Room, onRoom);
    mx.on(RoomEvent.MyMembership, onMembership);
    mx.on(RoomEvent.Timeline, onTimeline);

    cleanups.push(
      () => clearTimeout(timer),
      () => mx.removeListener(ClientEvent.Room, onRoom),
      () => mx.removeListener(RoomEvent.MyMembership, onMembership),
      () => mx.removeListener(RoomEvent.Timeline, onTimeline)
    );

    // Immediate sweep — the room may already be present.
    mx.getRooms().forEach(considerRoom);
  });
}

/** Error carrying a user-friendly message (dialog shows `.message` verbatim). */
export class StartWhatsAppChatError extends Error {}

/**
 * Full client-side flow:
 *   1. find the bridge-bot management room (fixed id, else discovery),
 *   2. send `!wa pm <e164>` into it,
 *   3. wait for the outcome: a new DM room, an existing DM room, "not on
 *      WhatsApp", another error, or a timeout,
 *   4. auto-join the room if we were only invited,
 *   5. return its room id — or throw a `StartWhatsAppChatError` with a friendly,
 *      user-readable message (never an unhandled crash).
 *
 * This performs NO navigation — the caller (a hook/component) does that so it can
 * use the app's router.
 */
export async function startWhatsAppChat(
  mx: MatrixClient,
  e164: string,
  cfg = WA_BRIDGE_CONFIG
): Promise<string> {
  const botRoom = findBridgeBotRoom(mx, cfg);
  if (!botRoom) {
    throw new StartWhatsAppChatError(
      'Could not find the WhatsApp bridge chat. Make sure you are logged in and the WhatsApp bridge is connected, then try again.'
    );
  }

  const preexisting = knownRoomIds(mx);
  const command = buildPmCommand(e164, cfg);
  const sinceTs = Date.now();

  const content: IContent = { msgtype: 'm.text', body: command };
  try {
    await mx.sendMessage(botRoom.roomId, content);
  } catch (e) {
    throw new StartWhatsAppChatError(
      'Could not send the WhatsApp chat request to the bridge. Please try again in a moment.'
    );
  }

  const outcome = await waitForWaResult(mx, {
    preexisting,
    botRoomId: botRoom.roomId,
    timeoutMs: cfg.newRoomTimeoutMs,
    sinceTs,
    cfg,
  });

  if (outcome.kind === 'notOnWhatsApp') {
    throw new StartWhatsAppChatError(outcome.message);
  }
  if (outcome.kind === 'error') {
    throw new StartWhatsAppChatError(outcome.message);
  }
  if (outcome.kind === 'timeout') {
    throw new StartWhatsAppChatError(
      'The WhatsApp bridge did not respond in time. The chat may still appear in your list shortly — please check in a moment.'
    );
  }

  const newRoomId = outcome.roomId;

  // If the bridge invited us rather than auto-joining, join now so we can open it.
  const newRoom = mx.getRoom(newRoomId);
  if (newRoom && newRoom.getMyMembership() === Membership.Invite) {
    try {
      await mx.joinRoom(newRoomId);
    } catch {
      // Non-fatal: navigation to the invite still works; the room view handles
      // the "accept invite" state.
    }
  }

  return newRoomId;
}

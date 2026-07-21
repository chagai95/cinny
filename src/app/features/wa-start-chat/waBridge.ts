import { ClientEvent, IContent, MatrixClient, Room, RoomEvent } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { getMxIdServer } from '../../utils/matrix';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp bridge configuration — VERIFY-THEN-FILL section.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These constants control how we talk to the mautrix-whatsapp bridge bot. The
 * DEFAULTS below are the standard mautrix-whatsapp conventions, but the EXACT
 * values for Chagai's bridge (the `stayinginbern` login) must be confirmed live
 * and slotted in here. Everything the feature needs to be re-pointed is isolated
 * to this object so no other file has to change.
 *
 * WHAT TO VERIFY / FILL IN (main session confirms via Claude Chrome):
 *  - BRIDGE_BOT_LOCALPART  : the bot user's localpart. mautrix-whatsapp default
 *                            is `whatsappbot` → `@whatsappbot:<server>`. Some
 *                            deployments use `@bridgebot:` or a custom name.
 *  - BRIDGE_BOT_USER_ID    : if the bot lives on a DIFFERENT homeserver than the
 *                            logged-in user, set the FULL user id here and it
 *                            overrides the localpart+server derivation.
 *  - PM_COMMAND            : the exact command template. Chagai's instruction is
 *                            `!wa pm <number>`. `{number}` is replaced with the
 *                            E.164 string (WITH leading +).
 *  - NEW_ROOM_TIMEOUT_MS   : how long to wait for the bridge to create/invite the
 *                            resulting DM room before giving up.
 */
export type WaBridgeConfig = {
  /** Localpart of the bridge bot (no @, no :server). */
  bridgeBotLocalpart: string;
  /**
   * Full bot user id override. Leave undefined to derive it as
   * `@<bridgeBotLocalpart>:<logged-in user's server>`.
   */
  bridgeBotUserIdOverride?: string;
  /** Command template; `{number}` → E.164 with leading +. */
  pmCommandTemplate: string;
  /** Max wait for the resulting DM room to appear (ms). */
  newRoomTimeoutMs: number;
};

export const WA_BRIDGE_CONFIG: WaBridgeConfig = {
  // DEFAULT — mautrix-whatsapp standard. VERIFY for the stayinginbern bridge.
  bridgeBotLocalpart: 'whatsappbot',
  // Leave undefined unless the bot is on another server (then put the full id).
  bridgeBotUserIdOverride: undefined,
  // Chagai's exact instruction. Do not change without his say-so.
  pmCommandTemplate: '!wa pm {number}',
  newRoomTimeoutMs: 30_000,
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
 * where `!wa` commands are issued (the one pinned when logged in). We look for a
 * JOINED room that contains the bot as a member and is small (a DM/management
 * room, not a big portal). We deliberately do NOT require encryption here (the
 * bridge management room is typically unencrypted), which is why we can't reuse
 * `getDMRoomFor` (that helper requires an encryption state event).
 *
 * If several candidates exist we prefer:
 *   1) a 2-member room (just me + bot),
 *   2) then the smallest room,
 *   3) then the most recently active.
 */
export function findBridgeBotRoom(mx: MatrixClient, cfg = WA_BRIDGE_CONFIG): Room | undefined {
  const botUserId = resolveBridgeBotUserId(mx, cfg);
  const myUserId = mx.getUserId() ?? '';

  const candidates = mx.getRooms().filter((room) => {
    if (room.getMyMembership() !== Membership.Join) return false;
    const botMember = room.getMember(botUserId);
    if (!botMember) return false;
    // Bot must actually be in the room (joined/invited), and it must be a small
    // room (management/DM), not a group portal.
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

export type WaitForRoomOptions = {
  timeoutMs?: number;
  botRoomId?: string;
  /** room ids that existed BEFORE the command was sent (to ignore). */
  preexisting: Set<string>;
};

/**
 * Wait for the bridge to surface the resulting WhatsApp DM room after the
 * `!wa pm` command, then resolve with its room id.
 *
 * Strategy: subscribe to new-room + membership-change events on the client and
 * resolve as soon as a room appears that (a) wasn't known before and (b) looks
 * like a fresh WhatsApp DM (see `looksLikeNewWaDm`). We also do an immediate
 * sweep in case the room already arrived between sending and subscribing.
 *
 * Resolves `undefined` on timeout (caller can then fall back to opening the bot
 * room / showing guidance).
 */
export function waitForNewWaDm(
  mx: MatrixClient,
  opts: WaitForRoomOptions
): Promise<string | undefined> {
  const timeoutMs = opts.timeoutMs ?? WA_BRIDGE_CONFIG.newRoomTimeoutMs;

  return new Promise((resolve) => {
    let settled = false;
    // Teardown steps registered after we wire everything up; `finish` runs them
    // all. Using a list avoids referencing the timer/handlers before they exist.
    const cleanups: Array<() => void> = [];

    const finish = (roomId: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanups.forEach((fn) => fn());
      resolve(roomId);
    };

    const consider = (room: Room) => {
      if (opts.preexisting.has(room.roomId)) return;
      if (looksLikeNewWaDm(mx, room, opts.botRoomId)) {
        finish(room.roomId);
      }
    };

    const onRoom = (room: Room) => consider(room);
    const onMembership = (room: Room) => consider(room);
    const timer = setTimeout(() => finish(undefined), timeoutMs);

    mx.on(ClientEvent.Room, onRoom);
    mx.on(RoomEvent.MyMembership, onMembership);

    cleanups.push(
      () => clearTimeout(timer),
      () => mx.removeListener(ClientEvent.Room, onRoom),
      () => mx.removeListener(RoomEvent.MyMembership, onMembership)
    );

    // Immediate sweep — the room may already be present.
    mx.getRooms().forEach(consider);
  });
}

/**
 * Full client-side flow:
 *   1. find the bridge-bot management room,
 *   2. send `!wa pm <e164>` into it,
 *   3. wait for the resulting WhatsApp DM room,
 *   4. auto-join it if we were only invited,
 *   5. return its room id (or throw a descriptive error).
 *
 * This performs NO navigation — the caller (a hook/component) does that so it can
 * use the app's router. Kept as a plain async function so it stays easy to test /
 * reason about.
 */
export async function startWhatsAppChat(
  mx: MatrixClient,
  e164: string,
  cfg = WA_BRIDGE_CONFIG
): Promise<string> {
  const botRoom = findBridgeBotRoom(mx, cfg);
  if (!botRoom) {
    const botId = resolveBridgeBotUserId(mx, cfg);
    throw new Error(
      `Could not find the WhatsApp bridge bot room (${botId}). Make sure you are logged in to WhatsApp and the bot chat exists.`
    );
  }

  const preexisting = knownRoomIds(mx);
  const command = buildPmCommand(e164, cfg);

  const content: IContent = {
    msgtype: 'm.text',
    body: command,
  };
  await mx.sendMessage(botRoom.roomId, content);

  const newRoomId = await waitForNewWaDm(mx, {
    preexisting,
    botRoomId: botRoom.roomId,
    timeoutMs: cfg.newRoomTimeoutMs,
  });

  if (!newRoomId) {
    throw new Error(
      'Sent the WhatsApp chat request, but the new chat did not appear in time. It may still show up in your chat list shortly.'
    );
  }

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

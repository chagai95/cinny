/**
 * Unit tests for the bridge-reply parsing helpers (the pure, testable parts of
 * waBridge.ts). Same dependency-free harness as normalizePhone.test.ts — run via:
 *
 *   node_modules/.bin/esbuild \
 *     src/app/features/wa-start-chat/waBridge.test.ts \
 *     --bundle --platform=node --format=cjs > /tmp/wab.cjs && node /tmp/wab.cjs
 *
 * The strings below are REAL mautrix-whatsapp management-room replies captured
 * from Chagai's server, so this pins the exact wording the fix depends on.
 * Excluded from the production build (nothing imports it).
 */
/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { parseRoomIdFromMatrixTo, classifyBotReply, buildPmCommand } from './waBridge';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn): void => {
  tests.push({ name, fn });
};

// parseRoomIdFromMatrixTo — plain body form (matrix.to/#/!roomid)
test('parse: plain matrix.to link', () => {
  const body =
    'You already have a direct chat with `41762168443` / +41762168443 (W) at ' +
    '+41762168443 (W) (https://matrix.to/#/!EnyMXeMeCExiNTxbTq:chagai.website)';
  assert.equal(parseRoomIdFromMatrixTo(body), '!EnyMXeMeCExiNTxbTq:chagai.website');
});

// parseRoomIdFromMatrixTo — url-encoded form (%21 / %3A) as in formatted_body
test('parse: url-encoded matrix.to link', () => {
  const fb =
    'You already have a direct chat … at ' +
    '<a href="https://matrix.to/#/%21EnyMXeMeCExiNTxbTq%3Achagai.website">+41762168443 (W)</a>';
  assert.equal(parseRoomIdFromMatrixTo(fb), '!EnyMXeMeCExiNTxbTq:chagai.website');
});

// parseRoomIdFromMatrixTo — room id without an explicit server (the newer bot form)
test('parse: matrix.to link with no :server suffix', () => {
  const body =
    'You already have a direct chat with `41762057026` / Johanny (WA) at Johanny (WA) ' +
    '(https://matrix.to/#/!6uU79BY6r5iaR1z3ugGC0KjVAAmY-0FMxEQ_X7OkEN8)';
  assert.equal(parseRoomIdFromMatrixTo(body), '!6uU79BY6r5iaR1z3ugGC0KjVAAmY-0FMxEQ_X7OkEN8');
});

test('parse: no link returns undefined', () => {
  assert.equal(parseRoomIdFromMatrixTo('nothing here'), undefined);
  assert.equal(parseRoomIdFromMatrixTo(''), undefined);
});

// classifyBotReply — the three real outcomes
test('classify: "already have a direct chat" → existing + roomId', () => {
  const r = classifyBotReply(
    'You already have a direct chat with `41793352366` / Love Is In The Hair (W) at ' +
      'Love Is In The Hair (W) (https://matrix.to/#/!u-VpKYnB1AsaJFndlIcvQOgIaVWTlPASW5C-ouZEkWM)'
  );
  assert.equal(r.kind, 'existing');
  if (r.kind === 'existing') {
    assert.equal(r.roomId, '!u-VpKYnB1AsaJFndlIcvQOgIaVWTlPASW5C-ouZEkWM');
  }
});

test('classify: "not on WhatsApp" → notOnWhatsApp', () => {
  const r = classifyBotReply(
    'Failed to resolve identifier: the server said +41792632209 is not on WhatsApp'
  );
  assert.equal(r.kind, 'notOnWhatsApp');
});

test('classify: "Unknown command" → error', () => {
  const r = classifyBotReply('Unknown command, use the `help` command for help.');
  assert.equal(r.kind, 'error');
});

test('classify: unrelated notice → other (ignored)', () => {
  const r = classifyBotReply('State update for +41766524456: `CONNECTED`');
  assert.equal(r.kind, 'other');
});

// buildPmCommand — the verified command shape
test('command: builds "!wa pm <e164>"', () => {
  assert.equal(buildPmCommand('+41791234567'), '!wa pm +41791234567');
});

export function runTests(): void {
  let passed = 0;
  const failures: string[] = [];
  tests.forEach(({ name, fn }) => {
    try {
      fn();
      passed += 1;
    } catch (err) {
      failures.push(`✗ ${name}\n   ${(err as Error).message}`);
    }
  });
  console.log(`waBridge: ${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}

runTests();

/**
 * Unit tests for the pure phone-normalization functions.
 *
 * This project has NO test runner configured (no vitest/jest in package.json),
 * so these tests are written against Node's built-in `node:assert` with a tiny
 * inline test harness and run on load. That keeps them dependency-free and
 * runnable, e.g. after `npm ci` (esbuild ships with vite, so it is present):
 *
 *   node_modules/.bin/esbuild \
 *     src/app/features/wa-start-chat/normalizePhone.test.ts \
 *     --bundle --platform=node --format=cjs > /tmp/wa.cjs && node /tmp/wa.cjs
 *
 * Prints "normalizePhone: N/N passed" and exits non-zero on any failure. This
 * file is excluded from the production build because nothing imports it.
 */
/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { stripToDigitsPlus, normalizePhone, e164Digits } from './normalizePhone';

type TestFn = () => void;
const tests: Array<{ name: string; fn: TestFn }> = [];
const test = (name: string, fn: TestFn): void => {
  tests.push({ name, fn });
};

// stripToDigitsPlus
test('strip: removes spaces, dashes, dots, brackets, slashes', () => {
  assert.equal(stripToDigitsPlus('079 123 45 67'), '0791234567');
  assert.equal(stripToDigitsPlus('(079) 123-45.67'), '0791234567');
  assert.equal(stripToDigitsPlus('079/123/45/67'), '0791234567');
});
test('strip: keeps a single leading + only, drops inner +', () => {
  assert.equal(stripToDigitsPlus('+41 79 123 45 67'), '+41791234567');
  assert.equal(stripToDigitsPlus('++41 79'), '+4179');
});
test('strip: a + not at the start is dropped', () => {
  assert.equal(stripToDigitsPlus('0041+79'), '004179');
});
test('strip: strips letters and misc symbols; empty stays empty', () => {
  assert.equal(stripToDigitsPlus('  +41 79 '), '+4179');
  assert.equal(stripToDigitsPlus(''), '');
  assert.equal(stripToDigitsPlus('abc'), '');
});

// normalizePhone — already international
test('intl: leading + kept as-is', () => {
  const r = normalizePhone('+49 151 23456789');
  assert.equal(r.e164, '+4915123456789');
  assert.deepEqual(r.candidates, ['+4915123456789']);
  assert.equal(r.wasInternational, true);
});
test('intl: leading 00 becomes +', () => {
  const r = normalizePhone('0041 79 123 45 67');
  assert.equal(r.e164, '+41791234567');
  assert.deepEqual(r.candidates, ['+41791234567']);
  assert.equal(r.wasInternational, true);
});
test('intl: messy international with brackets and dashes', () => {
  const r = normalizePhone('+1 (415) 555-2671');
  assert.equal(r.e164, '+14155552671');
  assert.equal(r.wasInternational, true);
});

// normalizePhone — bare/local
test('local: Swiss trunk 0 dropped, +41 first; full ordered list', () => {
  const r = normalizePhone('079 123 45 67');
  assert.equal(r.wasInternational, false);
  assert.equal(r.e164, '+41791234567');
  assert.deepEqual(r.candidates, [
    '+41791234567', // CH: drop trunk 0
    '+4979123 4567'.replace(/\s/g, ''), // DE: drop 0
    '+3379123 4567'.replace(/\s/g, ''), // FR: drop 0
    '+390791234567', // IT: KEEP leading 0
    '+4379123 4567'.replace(/\s/g, ''), // AT: drop 0
    '+42379123 4567'.replace(/\s/g, ''), // LI: drop 0
  ]);
});
test('local: Italy keeps the leading 0 while others drop it', () => {
  const r = normalizePhone('0791234567');
  assert.ok(r.candidates.includes('+390791234567'));
  assert.ok(r.candidates.includes('+41791234567'));
});
test('local: bare number with no leading zero', () => {
  const r = normalizePhone('791234567');
  assert.equal(r.e164, '+41791234567');
  assert.ok(r.candidates.includes('+39791234567'));
});
test('local: candidate list is deduped and CH-first', () => {
  const r = normalizePhone('44 123');
  assert.ok(r.candidates[0]?.startsWith('+41'));
  assert.equal(new Set(r.candidates).size, r.candidates.length);
});

// empty / junk
test('junk: no digits yields empty result', () => {
  const r = normalizePhone('no numbers here');
  assert.equal(r.e164, '');
  assert.deepEqual(r.candidates, []);
  assert.equal(r.wasInternational, false);
});

// e164Digits
test('e164Digits: drops the + and stray non-digits', () => {
  assert.equal(e164Digits('+41791234567'), '41791234567');
  assert.equal(e164Digits('+1 (415) 555-2671'), '14155552671');
});

/** Minimal runner — prints a summary and exits non-zero on any failure. */
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
  console.log(`normalizePhone: ${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}

// Run on load. This file is a standalone test entry that the app never imports
// (and it is excluded from the production build), so executing here is safe.
runTests();

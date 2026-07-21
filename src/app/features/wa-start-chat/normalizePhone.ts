/**
 * Phone-number normalization for the "Start WhatsApp chat" feature.
 *
 * The goal: take ANY human-typed phone number (however messy) and turn it into a
 * clean E.164 string (digits only, single leading `+`) suitable for the mautrix
 * WhatsApp bridge command `!wa pm <number>`.
 *
 * These are all PURE functions (no React, no side effects) so they are trivially
 * unit-testable — see normalizePhone.test.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NORMALIZATION RULES (exact)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Strip EVERYTHING that is not a digit, EXCEPT a single leading `+`.
 *    Removed: spaces (incl. non-breaking space U+00A0 / narrow no-break U+202F),
 *    brackets ( ) [ ], dashes - – —, dots ., slashes / \, and any other symbol
 *    or letter. A `+` only counts if it is the very first non-whitespace char.
 *
 * 2. Decide the country code:
 *    a. If the cleaned value starts with `+`  → it is ALREADY international.
 *       Keep the country code as-is → E.164 = `+` followed by all the digits.
 *    b. If it starts with `00`               → international prefix. Replace the
 *       leading `00` with `+` → E.164 as in (a). (e.g. `0041 79…` → `+4179…`.)
 *    c. Otherwise it is a BARE / LOCAL number (may have a trunk `0`, or none):
 *       we do NOT know the country, so we produce an ORDERED CANDIDATE LIST by
 *       trying likely country codes in a fixed preference order (see below). For
 *       each candidate country code we DROP one leading national trunk `0` (the
 *       digit used inside a country before the subscriber number) when that
 *       country uses a trunk 0, then prefix the country's dial code.
 *
 * 3. CANDIDATE COUNTRY ORDER (for bare/local numbers) — Switzerland FIRST, then
 *    geographically nearby countries:
 *       +41  Switzerland   (trunk 0)      ← primary / default
 *       +49  Germany       (trunk 0)
 *       +33  France        (trunk 0)
 *       +39  Italy         (NO trunk 0 — the leading 0 is part of the number)
 *       +43  Austria       (trunk 0)
 *       +423 Liechtenstein (trunk 0)
 *    The FIRST entry (+41) is the primary suggestion; the rest are fallbacks the
 *    user can pick if +41 is wrong.
 *
 * 4. Output for EVERY input:
 *      - `e164`       : the single best/primary E.164 candidate (string) or ''.
 *      - `candidates` : the ordered list of ALL viable E.164 candidates. For an
 *                       already-international number this is a single entry; for a
 *                       bare number it is one entry per country tried.
 *      - `wasInternational` : true if the input already carried +/00.
 *
 * Notes / edge cases:
 *   - Italy (+39) keeps a leading 0 (Italian landlines include it), so we do NOT
 *     strip the trunk 0 for +39. Every other country in the list strips one
 *     leading 0.
 *   - We never invent digits; if the input has no digits at all, everything is
 *     empty and the caller shows a validation error.
 *   - We keep only ONE leading `+`; extra `+` inside the string are dropped as
 *     non-digits (e.g. `++41` → `+41`).
 */

export type CountryDial = {
  /** ISO-ish label for display. */
  name: string;
  /** Dial code digits WITHOUT the leading + (e.g. '41', '423'). */
  code: string;
  /** Whether this country uses a national trunk '0' that must be dropped. */
  trunkZero: boolean;
};

/**
 * Ordered list of country codes to try for a bare/local number.
 * Switzerland is intentionally FIRST (Chagai's default), then nearby countries.
 * Adjust here if the preference order ever changes.
 */
export const CANDIDATE_COUNTRIES: readonly CountryDial[] = [
  { name: 'Switzerland', code: '41', trunkZero: true },
  { name: 'Germany', code: '49', trunkZero: true },
  { name: 'France', code: '33', trunkZero: true },
  { name: 'Italy', code: '39', trunkZero: false },
  { name: 'Austria', code: '43', trunkZero: true },
  { name: 'Liechtenstein', code: '423', trunkZero: true },
] as const;

export type NormalizedPhone = {
  /** Primary E.164 candidate (best guess). Empty string if no digits. */
  e164: string;
  /** Ordered list of all E.164 candidates (deduped). */
  candidates: string[];
  /** True when the raw input already had a + or 00 international prefix. */
  wasInternational: boolean;
};

/**
 * Rule 1: strip everything except digits, preserving a single leading `+`.
 * A `+` is only honored when it is the first non-whitespace character.
 */
export function stripToDigitsPlus(raw: string): string {
  if (typeof raw !== 'string') return '';
  // Trim leading/trailing whitespace. JS `\s` already covers NBSP (U+00A0) and
  // the narrow no-break space (U+202F), so this handles pasted numbers with them.
  const trimmed = raw.replace(/^\s+|\s+$/g, '');
  const hasLeadingPlus = trimmed.startsWith('+');
  // Remove every non-digit character (this also drops any inner '+').
  const digits = trimmed.replace(/\D+/g, '');
  return hasLeadingPlus ? `+${digits}` : digits;
}

/**
 * Build the E.164 candidate for a BARE local number under a given country.
 * Drops one leading trunk '0' when the country uses one.
 */
function localToE164(localDigits: string, country: CountryDial): string {
  let subscriber = localDigits;
  if (country.trunkZero && subscriber.startsWith('0')) {
    subscriber = subscriber.replace(/^0+/, ''); // drop leading trunk zero(es)
  }
  if (!subscriber) return '';
  return `+${country.code}${subscriber}`;
}

/**
 * The main entry point. Accepts any messy input and returns the normalized
 * E.164 + ordered candidate list per the rules documented at the top of the file.
 */
export function normalizePhone(raw: string): NormalizedPhone {
  const cleaned = stripToDigitsPlus(raw);

  // No usable digits at all.
  const digitCount = cleaned.replace(/\D+/g, '').length;
  if (digitCount === 0) {
    return { e164: '', candidates: [], wasInternational: false };
  }

  // Rule 2a: already has a leading '+'.
  if (cleaned.startsWith('+')) {
    const e164 = cleaned; // already digits-only after the '+'
    return { e164, candidates: [e164], wasInternational: true };
  }

  // Rule 2b: leading '00' international prefix → replace with '+'.
  if (cleaned.startsWith('00')) {
    const e164 = `+${cleaned.slice(2)}`;
    return { e164, candidates: [e164], wasInternational: true };
  }

  // Rule 2c: bare/local number → ordered candidate list across countries.
  const candidates: string[] = [];
  CANDIDATE_COUNTRIES.forEach((country) => {
    const candidate = localToE164(cleaned, country);
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  });

  return {
    e164: candidates[0] ?? '',
    candidates,
    wasInternational: false,
  };
}

/**
 * The bare digits (no +) of an E.164 string — what mautrix `!wa pm` wants after
 * the leading +. mautrix-whatsapp accepts the number with or without the +, but
 * we pass it WITH the + for clarity/robustness. This helper is exposed in case a
 * caller needs the plain digits.
 */
export function e164Digits(e164: string): string {
  return e164.replace(/\D+/g, '');
}

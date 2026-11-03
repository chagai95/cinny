import { useEffect, useMemo, useRef, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { downloadMedia, mxcUrlToHttp } from '../../utils/matrix';

/**
 * Content keys for profile pictures: a hash of the server's 32×32 thumbnail.
 * The same file always yields byte-identical thumbnails, so two mxc:// URLs
 * with the same key are the same picture uploaded twice (bridges do that a
 * lot). Keys are remembered in this browser, so each picture is checked once.
 */

const STORE = 'cinny_avatar_content_keys_v1';
const MAX_KEPT = 6000;
const PARALLEL = 4;

/** Two independent 32-bit hashes + length: plenty to tell ~1 KB thumbnails apart. */
/* eslint-disable no-bitwise */
export const hashBytes = (bytes: Uint8Array): string => {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < bytes.length; i += 1) {
    fnv = Math.imul(fnv ^ bytes[i], 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + bytes[i]) >>> 0;
  }
  return `${fnv.toString(16)}${djb.toString(16)}-${bytes.length}`;
};
/* eslint-enable no-bitwise */

let memory: Map<string, string> | undefined;
const load = (): Map<string, string> => {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = localStorage.getItem(STORE);
    if (raw)
      Object.entries(JSON.parse(raw) as Record<string, string>).forEach(([k, v]) =>
        memory?.set(k, v)
      );
  } catch {
    // storage unavailable or corrupt: start empty
  }
  return memory;
};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const save = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const m = load();
    while (m.size > MAX_KEPT) m.delete(m.keys().next().value as string);
    try {
      localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(m)));
    } catch {
      // full / blocked: keys stay in memory for this session
    }
  }, 1000);
};

const inFlight = new Map<string, Promise<string | undefined>>();
const fetchKey = (mx: MatrixClient, mxc: string, useAuth: boolean) => {
  const known = load().get(mxc);
  if (known) return Promise.resolve(known);
  let p = inFlight.get(mxc);
  if (!p) {
    p = (async () => {
      const url = mxcUrlToHttp(mx, mxc, useAuth, 32, 32, 'crop');
      if (!url) return undefined;
      try {
        const blob = await downloadMedia(url);
        const key = hashBytes(new Uint8Array(await blob.arrayBuffer()));
        load().set(mxc, key);
        save();
        return key;
      } catch {
        return undefined; // gone from the server etc.: simply not merged
      } finally {
        inFlight.delete(mxc);
      }
    })();
    inFlight.set(mxc, p);
  }
  return p;
};

/**
 * Looks up content keys for `mxcs` (newest first, in that order, a few at a
 * time) and re-renders as they arrive. `pending` = how many are still unknown.
 */
export const useContentKeys = (mx: MatrixClient, mxcs: string[], useAuth: boolean) => {
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(0);
  const listKey = mxcs.join('\n');
  const bump = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let alive = true;
    const todo = Array.from(new Set(mxcs)).filter((m) => !load().has(m));
    setPending(todo.length);
    if (todo.length === 0) return undefined;
    let next = 0;
    let left = todo.length;
    const refresh = () => {
      if (bump.current) return;
      bump.current = setTimeout(() => {
        bump.current = undefined;
        if (!alive) return;
        setVersion((v) => v + 1);
        setPending(left);
      }, 250);
    };
    const worker = async () => {
      while (alive && next < todo.length) {
        const mxc = todo[next];
        next += 1;
        // eslint-disable-next-line no-await-in-loop
        await fetchKey(mx, mxc, useAuth);
        left -= 1;
        refresh();
      }
    };
    for (let i = 0; i < PARALLEL; i += 1) worker();
    return () => {
      alive = false;
    };
    // listKey stands for mxcs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, listKey, useAuth]);

  const keyOf = useMemo(() => {
    const m = load();
    return (mxc: string) => m.get(mxc);
    // version: re-create so consumers recompute when keys arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { keyOf, pending };
};

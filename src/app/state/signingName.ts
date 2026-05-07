import { atom } from 'jotai';

const STORAGE_KEY = 'cbern_signing_name';

const baseAtom = atom<string>(localStorage.getItem(STORAGE_KEY) ?? '');

export const signingNameAtom = atom<string, [string], undefined>(
  (get) => get(baseAtom),
  (get, set, value) => {
    set(baseAtom, value);
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  }
);

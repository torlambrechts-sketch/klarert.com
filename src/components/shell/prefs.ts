'use client';

import { useCallback, useEffect, useState } from 'react';
import { PREFS } from './prefs-keys';

export { PREFS };

// Shell preferences remembered per browser (docs/05 §2.1, §2.2). localStorage can throw (private mode, blocked
// storage), so every access is guarded; the page still works with the defaults.

type Pref = (typeof PREFS)[keyof typeof PREFS];

export function readPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writePref(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // not remembered; the toggle still works for this page view
  }
}

export function usePref(pref: Pref): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(readPref(pref.key)), [pref.key]);
  const toggle = useCallback(() => {
    setOn((was) => {
      const next = !was;
      writePref(pref.key, next);
      if (next) document.documentElement.dataset[pref.attr] = pref.value;
      else delete document.documentElement.dataset[pref.attr];
      return next;
    });
  }, [pref]);
  return [on, toggle];
}

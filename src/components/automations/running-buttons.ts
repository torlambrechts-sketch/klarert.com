'use client';

import { create } from 'zustand';

// Button fields whose automations are running (UI state only): the cell shows a spinner until the command answers.

interface RunningButtons {
  running: ReadonlySet<string>;
  start(key: string): void;
  stop(key: string): void;
}

export const buttonKey = (itemId: string, fieldId: string) => `${itemId}:${fieldId}`;

export const useRunningButtons = create<RunningButtons>((set) => ({
  running: new Set(),
  start: (key) => set((s) => ({ running: new Set(s.running).add(key) })),
  stop: (key) =>
    set((s) => {
      const running = new Set(s.running);
      running.delete(key);
      return { running };
    }),
}));

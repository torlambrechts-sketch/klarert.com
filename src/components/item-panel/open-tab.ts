'use client';

// A tab the next item panel opens on, asked for by something outside the panel (the Table's paperclip marker opens
// the Files tab). The panel takes it once when it mounts, or at once when it is already open for that item.

let pending: { itemId: string; tab: string } | null = null;
const EVENT = 'item-panel:tab';

export function requestPanelTab(itemId: string, tab: string) {
  pending = { itemId, tab };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { itemId, tab } }));
}

/** The tab asked for this item, once. */
export function takePanelTab(itemId: string): string | null {
  if (!pending || pending.itemId !== itemId) return null;
  const tab = pending.tab;
  pending = null;
  return tab;
}

/** Listen for requests while the panel is open; returns the unsubscribe. */
export function onPanelTab(itemId: string, run: (tab: string) => void): () => void {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ itemId: string; tab: string }>).detail;
    if (d.itemId !== itemId) return;
    pending = null;
    run(d.tab);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

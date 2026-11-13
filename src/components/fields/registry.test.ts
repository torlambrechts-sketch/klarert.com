import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FIELD_TYPE_IDS } from '@/engine/fields/registry';

// The link editor calls the item search server action; in tests the action module is a stub (it imports
// server-only code). The files UI and others import the browser Supabase client, which reads its env at import time.
vi.mock('@/app/[org]/s/panel-actions', () => ({ searchItemsAction: vi.fn() }));
let FIELD_UI: Record<string, { Cell: unknown; Editor: unknown; icon: unknown }>;
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key-test-anon-key');
  ({ FIELD_UI } = await import('./registry'));
});

describe('UI field registry', () => {
  it('has a Cell, an Editor and an icon for each of the 58 types', () => {
    expect(Object.keys(FIELD_UI).sort()).toEqual([...FIELD_TYPE_IDS].sort());
    expect(FIELD_TYPE_IDS).toHaveLength(58);
    for (const id of FIELD_TYPE_IDS) {
      const ui = FIELD_UI[id]!;
      expect(typeof ui.Cell, id).toBe('function');
      expect(typeof ui.Editor, id).toBe('function');
      expect(ui.icon, id).toBeTruthy();
    }
  });
});

// Pack planning reads every page past the API's 1000-row cap (supabase/config.toml max_rows, security review 9.1
// item 4): a plan made from a cut list would put a new item where another already is, miss a member a pack names, or
// add again what an install already made. The fake answers as PostgREST does, cap included.
import { describe, expect, it, vi } from 'vitest';
import type { PackManifest } from '@/engine/packs/types';
import { fakeDb, many, MAX_ROWS, seqId } from '@/lib/fake-db.testing';
import { loadRequirementItems, loadSnapshot, readCatalogue } from './install';
import { loadInstalledState, readPackVersions } from './upgrade';

const ORG = 'o1';
const pos = (i: number) => `a${String(i).padStart(5, '0')}`;
const paged = (requests: { range: [number, number] | null }[]) =>
  requests.every((r) => r.range !== null && r.range[1] - r.range[0] + 1 <= MAX_ROWS);

const member = (i: number) => ({
  org_id: ORG,
  user_id: seqId('u', i),
  profiles: { id: seqId('u', i), display_name: `Person ${i}`, initials: 'PP', color: 'blue' },
});

describe('loadSnapshot (install planning)', () => {
  it('reads every member, email, sheet and folder of a large workspace', async () => {
    const { db, requests } = fakeDb(
      {
        orgs: [{ id: ORG, time_zone: 'Europe/Oslo' }],
        memberships: many(1500, member),
        sheets: many(1300, (i) => ({
          id: seqId('s', i),
          org_id: ORG,
          id_prefix: `S${i}-`,
          position: pos(i),
          parent_sheet_id: null,
          is_library: false,
          archived_at: null,
        })),
        folders: many(1100, (i) => ({
          id: seqId('f', i),
          org_id: ORG,
          name: `Folder ${i}`,
          position: pos(i),
          archived_at: null,
        })),
      },
      {
        pack_member_emails: () =>
          many(1500, (i) => ({ user_id: seqId('u', i), email: `p${i}@a.test` })),
      },
    );
    const { snapshot, timeZone } = await loadSnapshot(db, ORG);
    expect(timeZone).toBe('Europe/Oslo');
    expect(snapshot.members).toHaveLength(1500);
    expect(snapshot.members.find((m) => m.id === seqId('u', 1499))?.email).toBe('p1499@a.test');
    expect(snapshot.prefixes).toHaveLength(1300);
    expect(snapshot.prefixes).toContain('S1299-');
    expect(snapshot.lastSheetPosition).toBe(pos(1299));
    expect(snapshot.folders).toHaveLength(1100);
    expect(snapshot.lastFolderPosition).toBe(pos(1099));
    expect(paged(requests.filter((r) => r.source !== 'orgs'))).toBe(true);
  });

  it('places a required pack sheet’s new items after its last item, past the first 1000', async () => {
    const manifest = {
      key: 'addon',
      version: '1.0.0',
      requires: [{ pack: 'core', range: '^1.0.0' }],
      extends: [{ pack: 'core', sheet: 'risks', fields: [] }],
      sheets: [],
      automations: [],
      dashboards: [],
    } as unknown as PackManifest;
    const { db } = fakeDb(
      {
        orgs: [{ id: ORG, time_zone: 'UTC' }],
        pack_installs: [
          {
            id: 'i-core',
            org_id: ORG,
            pack_key: 'core',
            version: '1.0.0',
            status: 'installed',
            level: null,
            ref_map: {},
          },
        ],
        sheets: [
          {
            id: 's-risks',
            org_id: ORG,
            pack_ref: 'risks',
            pack_install_id: 'i-core',
            name: 'Risks',
            item_label: 'Risk',
            id_prefix: 'R-',
            settings: {},
            position: 'a0',
            parent_sheet_id: null,
            is_library: false,
            archived_at: null,
          },
        ],
        groups: [
          {
            id: 'g1',
            sheet_id: 's-risks',
            pack_ref: 'risks.open',
            pack_install_id: 'i-core',
            name: 'Open',
            color: 'grey',
            position: 'a0',
          },
        ],
        fields: many(1200, (i) => ({
          id: seqId('fd', i),
          sheet_id: 's-risks',
          key: `f${i}`,
          name: `Field ${i}`,
          type: 'text',
          config: {},
          required: false,
          locked: false,
          description: null,
          position: pos(i),
          pack_install_id: 'i-core',
          archived_at: null,
        })),
        // 2500 items; ids in reverse order of position so the last position is on the last page by id
        items: many(2500, (i) => ({
          id: seqId('it', 2499 - i),
          sheet_id: 's-risks',
          group_id: 'g1',
          position: pos(i),
          archived_at: null,
        })),
      },
      { pack_member_emails: () => [] },
    );
    const { snapshot } = await loadSnapshot(db, ORG, manifest);
    const risks = snapshot.foreign?.['core:risks'];
    expect(risks?.fields).toHaveLength(1200);
    expect(risks?.lastFieldPosition).toBe(pos(1199));
    expect(risks?.lastItemPosition).toEqual({ g1: pos(2499) });
  });

  it('loadRequirementItems finds every library item past 1000', async () => {
    const { db, requests } = fakeDb({
      items: many(1800, (i) => ({
        id: seqId('it', i),
        org_id: ORG,
        sheet_id: 'lib',
        requirement_ref: `R${i}`,
        archived_at: null,
      })),
    });
    const keys = many(1800, (i) => `R${i}`);
    const got = await loadRequirementItems(db, ORG, [{ library: 'iso@1', sheetId: 'lib' }], keys);
    expect(Object.keys(got)).toHaveLength(1800);
    expect(got.R1799).toBe(seqId('it', 1799));
    expect(paged(requests)).toBe(true);
  });
});

describe('loadInstalledState (upgrade planning)', () => {
  it('reads every item, field and creation entry of an install past 1000', async () => {
    const item = (i: number) => ({
      id: seqId('it', i),
      pack_ref: i < 3 ? `risks.r${i}` : null,
      pack_install_id: i < 3 ? 'inst' : null,
      sheet_id: 's1',
      group_id: 'g1',
      name: `Risk ${i}`,
      values: {},
      archived_at: null,
      requirement_ref: null,
      position: pos(i),
    });
    const { db, requests } = fakeDb({
      sheets: [
        {
          id: 's1',
          org_id: ORG,
          pack_install_id: 'inst',
          pack_ref: 'risks',
          name: 'Risks',
          description: null,
          item_label: 'Risk',
          folder_id: null,
          parent_sheet_id: null,
          archived_at: null,
          settings: {},
        },
      ],
      groups: [
        {
          id: 'g1',
          pack_ref: 'risks.open',
          pack_install_id: 'inst',
          sheet_id: 's1',
          name: 'Open',
          color: 'grey',
          position: 'a0',
        },
      ],
      fields: many(1100, (i) => ({
        id: seqId('fd', i),
        pack_ref: `risks.f${i}`,
        pack_install_id: 'inst',
        sheet_id: 's1',
        key: `f${i}`,
        name: `F${i}`,
        type: 'text',
        description: null,
        required: false,
        locked: false,
        config: {},
        archived_at: null,
        position: pos(i),
      })),
      items: [...many(2600, item)],
      activity_log: many(2600, (i) => ({
        id: i + 1,
        org_id: ORG,
        sheet_id: 's1',
        item_id: seqId('it', i),
        action: 'item.created',
        new_value: { name: `Risk ${i}`, group_id: 'g1', values: {} },
      })),
    });
    const state = await loadInstalledState(db, ORG, {
      id: 'inst',
      version: '1.0.0',
      level: null,
      ref_map: {},
    });
    expect(state.fields).toHaveLength(1100);
    expect(state.items).toHaveLength(3);
    // the client's own items count, all 2597 of them, and the last position is the 2600th item's
    expect(state.sheets[0]!.clientItems).toBe(2597);
    expect(state.lastPosition.items).toEqual({ g1: pos(2599) });
    expect(state.lastPosition.fields).toEqual({ s1: pos(1099) });
    expect(state.items.every((i) => i.installed !== null)).toBe(true);
    expect(paged(requests)).toBe(true);
  });

  it('the catalogue and its versions are read past 1000 rows', async () => {
    const packs = many(1200, (i) => ({
      key: i < 1199 ? `p${String(i).padStart(4, '0')}` : 'zz',
      version: '1.0.0',
      title: `Pack ${i}`,
      description: '',
      hash: 'h',
      manifest: {},
    }));
    const { db, requests } = fakeDb({ packs });
    expect(await readPackVersions(db)).toHaveLength(1200);
    // manifests that do not parse are left out of the catalogue (with a warning), but every row was read
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readCatalogue(db);
    expect(warn).toHaveBeenCalledTimes(1200);
    warn.mockRestore();
    expect(requests.filter((r) => r.source === 'packs')).toHaveLength(4);
    expect(paged(requests)).toBe(true);
  });
});

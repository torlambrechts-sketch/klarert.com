import 'server-only';
import { randomUUID } from 'node:crypto';
import { isFrameworkPack } from '@/engine/frameworks/pack';
import { levelSummaries, manifestAtLevel, defaultLevel } from '@/engine/packs/levels';
import {
  appNeeds,
  appsAfter,
  bundleParts,
  canChooseFolder,
  selectManifest,
  type AppNeeds,
  type BundlePart,
} from '@/engine/packs/select';
import type { Json } from '@/engine/types';
import {
  bundleDetailsInput,
  createBundleInput,
  createOptionsInput,
  markReviewedInput,
} from '@/lib/schemas/bundles';
import { RECIPES } from '@/lib/recipes';
import { STARTS } from '@/lib/starts';
import { isAdminRole, isEditorRole } from '@/server/auth';
import { planInstall, readCatalogue, readPack, requiredFirst } from '@/server/packs/install';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';
import { adoptForPack } from './frameworks';
import { installRequired } from './packs';

// The Create wizard (docs/05 §4 Create, docs/11 Bundles). A ready-made app ("Solve a problem") is a pack install made
// from the same manifest and planner as Workspace admin › Packs, with the parts the person left out removed
// (src/engine/packs/select.ts), a name, a named owner and a review date. Nothing is written before Create: the
// options and details are reads, and createBundle plans again on the server from the catalogue as it is now (the
// browser sends only the key, the hash it saw, its choices and the bundle's name, owner and date). Installing is for
// owners and admins, as for packs; members see the same cards with "Ask an admin".

export interface CreatePack {
  key: string;
  version: string;
  title: string;
  description: string;
  hash: string;
  /** "1 sheet · 1 form · 1 automation · 1 dashboard · 1 app" */
  inside: string;
  levels: { key: string; name: string; description: string }[];
  /** The live install of this pack here (one per workspace): open it instead of creating it again. */
  installed: { installId: string; sheetId: string | null; name: string } | null;
  /** App keys the pack carries (intents may name an app). */
  apps: string[];
}

export interface CreateOptions {
  canInstall: boolean;
  canEdit: boolean;
  me: string;
  packs: CreatePack[];
  starts: { id: string; title: string; description: string }[];
  recipes: { id: string; title: string }[];
  /** Sheets the person can open, the ones with the latest item changes first. */
  sheets: { id: string; name: string; itemLabel: string; folder: string | null }[];
  folders: string[];
  members: { id: string; name: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function insideText(parts: BundlePart[], apps: number): string {
  const n = (k: BundlePart['kind']) => parts.filter((p) => p.kind === k).length;
  return [
    n('sheet') && plural(n('sheet'), 'sheet'),
    n('form') && plural(n('form'), 'form'),
    n('automation') && plural(n('automation'), 'automation'),
    n('dashboard') && plural(n('dashboard'), 'dashboard'),
    apps && plural(apps, 'app'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the wizard offers in this workspace. Every member may read it. */
export async function createOptions(input: unknown): Promise<Result<CreateOptions>> {
  const p = createOptionsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      try {
        const [catalogue, installs, firstSheets, sheets, recent, folders, members] =
          await Promise.all([
            readCatalogue(supabase),
            supabase
              .from('pack_installs')
              .select('id, pack_key, bundle_name')
              .eq('org_id', orgId)
              .eq('status', 'installed'),
            supabase
              .from('sheets')
              .select('id, pack_install_id')
              .eq('org_id', orgId)
              .not('pack_install_id', 'is', null)
              .is('parent_sheet_id', null)
              .is('archived_at', null)
              .order('position'),
            supabase
              .from('sheets')
              .select('id, name, item_label, is_library, folders(name)')
              .eq('org_id', orgId)
              .is('archived_at', null)
              .is('parent_sheet_id', null)
              .order('position'),
            supabase
              .from('items')
              .select('sheet_id, updated_at')
              .eq('org_id', orgId)
              .is('archived_at', null)
              .order('updated_at', { ascending: false })
              .limit(300),
            supabase
              .from('folders')
              .select('name')
              .eq('org_id', orgId)
              .is('archived_at', null)
              .order('position'),
            supabase
              .from('memberships')
              .select('user_id, role, profiles!inner(display_name)')
              .eq('org_id', orgId),
          ]);
        for (const r of [installs, firstSheets, sheets, recent, folders, members])
          if (r.error) return fromDbError(r.error);
        const live = new Map((installs.data ?? []).map((i) => [i.pack_key, i]));
        const rank = new Map<string, number>();
        for (const r of recent.data ?? [])
          if (!rank.has(r.sheet_id)) rank.set(r.sheet_id, rank.size);
        const sheetRows = (sheets.data ?? []).filter((s) => !s.is_library);
        return ok({
          canInstall: isAdminRole(role),
          canEdit: isEditorRole(role),
          me: user.id,
          packs: catalogue
            .filter((c) => !isFrameworkPack(c.manifest))
            .map((c) => {
              const at = manifestAtLevel(c.manifest, defaultLevel(c.manifest));
              const install = live.get(c.key);
              return {
                key: c.key,
                version: c.version,
                title: c.title,
                description: c.description,
                hash: c.hash,
                inside: insideText(bundleParts(at), appsAfter(at, []).length),
                levels: (c.manifest.levels ?? []).map((l) => ({
                  key: l.key,
                  name: l.name,
                  description: l.description,
                })),
                installed: install
                  ? {
                      installId: install.id,
                      name: install.bundle_name ?? c.title,
                      sheetId:
                        (firstSheets.data ?? []).find((s) => s.pack_install_id === install.id)
                          ?.id ?? null,
                    }
                  : null,
                apps: (c.manifest.apps ?? []).map((a) => a.key),
              };
            }),
          starts: STARTS.filter((s) => s.fields).map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
          })),
          recipes: RECIPES.map((r) => ({ id: r.id, title: r.title })),
          sheets: sheetRows
            .map((s, i) => ({ s, i }))
            .sort((a, b) => (rank.get(a.s.id) ?? 1e6 + a.i) - (rank.get(b.s.id) ?? 1e6 + b.i))
            .map(({ s }) => ({
              id: s.id,
              name: s.name,
              itemLabel: s.item_label,
              folder: (s.folders as { name: string } | null)?.name ?? null,
            })),
          folders: (folders.data ?? []).map((f) => f.name),
          members: (members.data ?? [])
            .filter((m) => m.role !== 'auditor')
            .map((m) => ({ id: m.user_id, name: m.profiles.display_name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'create', error: String(e) }));
        return fail('failed', 'The starting points could not be loaded. Try again.');
      }
    },
    'createOptions',
  );
}

export interface BundleDetails {
  key: string;
  title: string;
  version: string;
  hash: string;
  level: { key: string; name: string } | null;
  levels: { key: string; name: string; description: string; sheets: string[] }[];
  parts: BundlePart[];
  /** The pack's apps and what each screen needs (the preview counts the screens that stay). */
  apps: AppNeeds[];
  /** False when the pack keeps its own (restricted) folders. */
  canChooseFolder: boolean;
  /** The pack's own folders at this level. */
  packFolders: string[];
  /** Frameworks the pack builds on: their requirement libraries are adopted first when missing. */
  frameworks: string[];
  /** Owners and admins: the planner's check against this workspace (renamed prefixes, warnings, blockers). */
  check: {
    state: 'ready' | 'installed' | 'blocked';
    conflicts: string[];
    warnings: string[];
    renamedPrefixes: { sheet: string; from: string; to: string }[];
  } | null;
}

/** The parts of a bundle at a level, with what each needs and its safety flags. Read only. */
export async function bundleDetails(input: unknown): Promise<Result<BundleDetails>> {
  const p = bundleDetailsInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      const pack = await readPack(supabase, p.data.key);
      if (!pack || isFrameworkPack(pack.manifest))
        return fail('not_found', 'This starting point is no longer available.');
      const m = pack.manifest;
      const levelKey = m.levels?.some((l) => l.key === p.data.level)
        ? p.data.level!
        : defaultLevel(m);
      const at = manifestAtLevel(m, levelKey);
      try {
        let check: BundleDetails['check'] = null;
        if (isAdminRole(role)) {
          const plan = await planInstall(supabase, orgId, pack, {
            userId: user.id,
            now: new Date(),
            newId: randomUUID,
            level: levelKey,
            installFirst: await requiredFirst(supabase, orgId, pack.manifest, undefined, levelKey),
          });
          check = {
            state: plan.state,
            conflicts: plan.preview.conflicts,
            warnings: plan.preview.warnings,
            renamedPrefixes: plan.preview.renamedPrefixes,
          };
        }
        const level = m.levels?.find((l) => l.key === levelKey);
        return ok({
          key: pack.key,
          title: pack.title,
          version: pack.version,
          hash: pack.hash,
          level: level ? { key: level.key, name: level.name } : null,
          levels: levelSummaries(m).map((l) => ({
            key: l.key,
            name: l.name,
            description: l.description,
            sheets: l.sheets,
          })),
          parts: bundleParts(at),
          apps: appNeeds(at),
          canChooseFolder: canChooseFolder(at),
          packFolders: at.folders.map((f) => f.name),
          frameworks: (m.frameworks ?? []).map((f) => `${f.key} ${f.version}`),
          check,
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'create', error: String(e) }));
        return fail('failed', 'The preview could not be made. Try again.');
      }
    },
    'bundleDetails',
  );
}

export interface CreatedBundle {
  installId: string;
  name: string;
  /** The first sheet the bundle made: the wizard lands there. */
  sheetId: string | null;
  itemLabel: string | null;
  /** "1 sheet, 9 fields, 1 form and 1 automation" for the toast. */
  made: string[];
  warnings: string[];
}

const BUNDLE_ERRORS: [RegExp, string][] = [
  [/bundle: a name is required/, 'Give it a name.'],
  [/bundle: the owner must be a member/, 'Choose an owner from the workspace.'],
  [
    /only owners and admins create/,
    'Only owners and admins can create ready-made apps. Ask an admin.',
  ],
  [/only the named owner marks it reviewed/, 'Only the named owner can mark it reviewed.'],
  [/bundle: already reviewed/, 'It is already marked reviewed.'],
  [/bundle: archived/, 'This set is archived.'],
  [/bundle not found/, 'This set no longer exists.'],
];

function bundleError(error: { message: string; code?: string }): Result<never> {
  for (const [re, text] of BUNDLE_ERRORS) if (re.test(error.message)) return fail('conflict', text);
  return fromDbError(error);
}

/** Create a ready-made app: planned again here with the person's choices, written by create_bundle in one go. */
export async function createBundle(input: unknown): Promise<Result<CreatedBundle>> {
  const p = createBundleInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId, user }) => {
      const pack = await readPack(supabase, p.data.key);
      if (!pack || isFrameworkPack(pack.manifest))
        return fail('not_found', 'This starting point is no longer available.');
      if (pack.hash !== p.data.hash)
        return fail('conflict', 'This starting point changed since you looked at it. Look again.');
      const levelKey = pack.manifest.levels?.some((l) => l.key === p.data.level)
        ? p.data.level!
        : defaultLevel(pack.manifest);
      const chosen = {
        ...pack,
        manifest: selectManifest(
          manifestAtLevel(pack.manifest, levelKey),
          p.data.exclude,
          p.data.folder,
        ),
      };
      if (!chosen.manifest.sheets.length) return fail('invalid', 'Keep at least one sheet.');
      const env = { userId: user.id, now: new Date(), newId: randomUUID, level: levelKey };
      // the packs it requires (the Core registers) are installed first (docs/11 Extends)
      const firsts = await requiredFirst(supabase, orgId, chosen.manifest, undefined, levelKey);
      let plan = await planInstall(supabase, orgId, chosen, { ...env, installFirst: firsts });
      if (plan.state === 'ready' && firsts.length) {
        const r = await installRequired(supabase, orgId, user.id, firsts);
        if (!r.ok) return r;
        plan = await planInstall(supabase, orgId, chosen, env);
      }
      if (plan.state === 'installed' || plan.preview.extendsLevel)
        return fail(
          'conflict',
          `${pack.title} is already set up in this workspace. Open it instead.`,
        );
      if (plan.state === 'blocked')
        return fail('conflict', plan.preview.conflicts[0] ?? 'This cannot be created here.');
      // the frameworks it builds on are adopted first (each its own transaction), as installPack does
      let adopted = false;
      for (const f of plan.preview.frameworks.filter((x) => !x.adopted)) {
        const [key, version] = f.library.split('@') as [string, string];
        const r = await adoptForPack(supabase, orgId, user.id, { key, version });
        if (!r.ok)
          return fail(r.error.code, `${pack.title} needs ${f.library}: ${r.error.message}`);
        adopted = adopted || r.data.adopted;
      }
      if (adopted) {
        plan = await planInstall(supabase, orgId, chosen, env);
        if (plan.state !== 'ready')
          return fail('conflict', plan.preview.conflicts[0] ?? 'This cannot be created here.');
      }
      const { data, error } = await supabase.rpc('create_bundle', {
        p_org: orgId,
        p_plan: plan.payload as unknown as Json,
        p_bundle: { name: p.data.name, owner_id: p.data.ownerId, review_by: p.data.reviewBy },
      });
      if (error) return bundleError(error);
      const out = data as { install_id: string; ref_map: Record<string, string> };
      const first = chosen.manifest.sheets[0]!;
      const c = plan.preview.counts;
      const made = [
        c.sheets && plural(c.sheets, 'sheet'),
        c.fields && plural(c.fields, 'field'),
        c.forms && plural(c.forms, 'draft form'),
        c.automations && plural(c.automations, 'automation'),
        c.dashboards && plural(c.dashboards, 'dashboard'),
        c.items && plural(c.items, 'example item'),
      ].filter((x): x is string => !!x);
      return ok({
        installId: out.install_id,
        name: p.data.name,
        sheetId: out.ref_map[`sheet:${first.ref}`] ?? null,
        itemLabel: first.itemLabel ?? null,
        made,
        warnings: plan.preview.warnings,
      });
    },
    'createBundle',
  );
}

/** The named owner signs off a generated set ("Generated from template, not yet reviewed" goes away). */
export async function markBundleReviewed(
  input: unknown,
): Promise<Result<{ installId: string; reviewedAt: string }>> {
  const p = markReviewedInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId }) => {
      const { data: row } = await supabase
        .from('pack_installs')
        .select('id')
        .eq('id', p.data.installId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!row) return fail('not_found', 'This set no longer exists.');
      const { data, error } = await supabase.rpc('mark_bundle_reviewed', { p_install: row.id });
      if (error) return bundleError(error);
      return ok({ installId: row.id, reviewedAt: (data as { reviewed_at: string }).reviewed_at });
    },
    'markBundleReviewed',
  );
}

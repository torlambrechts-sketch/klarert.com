import 'server-only';
import {
  captureManifest,
  leftOutReport,
  privatePackKey,
  suggestVersion,
  versionProblem,
  type LeftOutKind,
  type VersionKind,
} from '@/engine/packs/capture';
import { countsText, manifestCounts, type PackCounts } from '@/engine/packs/plan';
import type { BundlePart } from '@/engine/packs/select';
import type { PackManifest } from '@/engine/packs/types';
import { packTitle } from '@/engine/packs/words';
import type { Json } from '@/engine/types';
import { packHash } from '@/lib/packs/hash';
import { parsePack } from '@/lib/packs/manifest';
import { packQualityProblems } from '@/lib/packs/quality';
import {
  listYourPacksInput,
  previewPublishInput,
  publishPackInput,
  withdrawPackInput,
} from '@/lib/schemas/packs';
import { isAdminRole } from '@/server/auth';
import { readCatalogue, every } from '@/server/packs/install';
import { loadWorkspaceSnapshot, readOwnPacks, type OwnPackVersion } from '@/server/packs/capture';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// "Save your setup" (docs/11 Your own packs, P9). Owners and admins of a workspace capture its setup as a private
// pack (captureManifest, pure) and publish versions of it with publish_pack, which re-checks the safety rules and
// logs pack.published; withdraw_pack stops new installs. The workspace is read with the person's own client, so they
// capture only what they can read. Installing elsewhere uses previewPack and installPack (src/server/commands/packs.ts).

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The capture's content, without the name, version and wording the person edits: what a preview promised. */
const contentHashOf = (m: PackManifest) =>
  packHash({ ...m, key: '', version: '', title: '', description: '' });

const latestOf = (versions: OwnPackVersion[], key: string) =>
  versions.filter((v) => v.key === key).at(-1) ?? null;

export interface PublishPreview {
  /** The workspace that publishes (and owns) the pack. */
  publisher: string;
  /** Packs this workspace published already: a new version of one of them, or a new pack. */
  packs: { key: string; title: string; version: string; withdrawn: boolean }[];
  /** The pack this preview is for: null for a new pack. */
  previous: { key: string; title: string; description: string; version: string } | null;
  parts: BundlePart[];
  excluded: string[];
  /** What the chosen parts add up to: "2 sheets, 14 fields and 3 automations". */
  inside: string;
  counts: PackCounts;
  /** "Shared registers ^1.3.0": the packs of ours it builds on (installed first where missing). */
  requires: string[];
  /** What it adds to sheets of our packs: "Shared registers › Risk register: 1 column, 1 view and 1 automation". */
  adds: string[];
  leftOut: { kind: LeftOutKind; heading: string; lines: string[] }[];
  suggested: { version: string; kind: VersionKind; reason: string };
  /** The quality bar, as advice (owner decision 3): never a blocker for a workspace's own pack. */
  advice: string[];
  /** Problems that block publishing (the manifest schema). */
  problems: string[];
  contentHash: string;
}

async function capture(
  ctx: Parameters<Parameters<typeof withOrg>[2]>[0],
  key: string | undefined,
  excluded: string[],
  over: { title?: string; description?: string; version?: string } = {},
) {
  const { supabase, orgId } = ctx;
  const [snap, own] = await Promise.all([
    loadWorkspaceSnapshot(supabase, orgId),
    readOwnPacks(supabase, orgId),
  ]);
  const prev = key ? latestOf(own, key) : null;
  if (key && !prev)
    return { error: fail('not_found', 'This pack is no longer available.') } as const;
  const title = over.title ?? prev?.title ?? `${snap.org.name} setup`;
  const packKey =
    key ??
    privatePackKey(
      orgId,
      title,
      own.map((o) => o.key),
    );
  const cap = captureManifest(snap, {
    key: packKey,
    version: over.version ?? prev?.version ?? '1.0.0',
    title,
    description: over.description ?? prev?.description ?? '',
    excluded,
  });
  let parsed: PackManifest | null = null;
  const problems: string[] = [];
  try {
    parsed = parsePack(cap.manifest);
  } catch (e) {
    problems.push(
      ...String(e instanceof Error ? e.message : e)
        .split('\n')
        .slice(1, 8)
        .map((l) => l.trim()),
    );
  }
  return { snap, own, prev, cap, parsed, problems, packKey } as const;
}

/** What publishing would capture now, with the "Left out" report and the version to suggest. Owners and admins. */
export async function previewPublish(input: unknown): Promise<Result<PublishPreview>> {
  const p = previewPublishInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async (ctx) => {
      try {
        const r = await capture(ctx, p.data.key, p.data.excluded);
        if ('error' in r) return r.error!;
        const { snap, own, prev, cap, parsed, problems } = r;
        const m = parsed ?? cap.manifest;
        const catalogue = await readCatalogue(ctx.supabase);
        const titleOf = (k: string) => catalogue.find((c) => c.key === k)?.title ?? k;
        const counts = manifestCounts(m);
        const sheetName = (pack: string, ref: string) =>
          catalogue.find((c) => c.key === pack)?.manifest.sheets.find((s) => s.ref === ref)?.name ??
          ref;
        const adds = (m.extends ?? []).map((e) => {
          const bits = [
            e.fields?.length ? plural(e.fields.length, 'column') : '',
            e.groups?.length ? plural(e.groups.length, 'group') : '',
            e.views?.length ? plural(e.views.length, 'view') : '',
            e.forms?.length ? plural(e.forms.length, 'form') : '',
            Object.values(e.options ?? {}).flat().length
              ? plural(Object.values(e.options ?? {}).flat().length, 'option')
              : '',
            e.automations?.length ? plural(e.automations.length, 'automation') : '',
            e.workflows?.length ? plural(e.workflows.length, 'approval workflow') : '',
          ].filter(Boolean);
          const list =
            bits.length <= 1 ? bits.join('') : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
          return `${titleOf(e.pack)} › ${sheetName(e.pack, e.sheet)}: ${list}`;
        });
        const advice = [
          'You are responsible for any licensed text in your pack, such as the wording of a standard: Klarert does not review it.',
          ...(parsed ? packQualityProblems(parsed).map((q) => q.message) : []),
        ];
        return ok({
          publisher: snap.org.name,
          packs: [...new Set(own.map((o) => o.key))].map((k) => {
            const l = latestOf(own, k)!;
            return { key: k, title: l.title, version: l.version, withdrawn: !!l.withdrawnAt };
          }),
          previous: prev
            ? {
                key: prev.key,
                title: prev.title,
                description: prev.description,
                version: prev.version,
              }
            : null,
          parts: cap.parts,
          excluded: cap.excluded,
          inside: countsText(counts) || 'Nothing yet',
          counts,
          requires: m.requires.map((x) => `${packTitle(titleOf(x.pack))} ${x.range}`),
          adds,
          leftOut: leftOutReport(cap.leftOut),
          suggested: suggestVersion(
            prev ? { version: prev.version, manifest: prev.manifest } : null,
            {
              ...m,
              title: prev?.title ?? m.title,
              description: prev?.description ?? m.description,
            },
          ),
          advice,
          problems,
          contentHash: contentHashOf(m),
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'pack-publish', error: String(e) }));
        return fail('failed', 'Your setup could not be read. Try again.');
      }
    },
    'previewPublish',
  );
}

export interface PublishResult {
  key: string;
  version: string;
  title: string;
  /** "2 sheets, 14 fields and 3 automations" */
  inside: string;
  withdrawn: boolean;
}

/** Publish a version of the workspace's own pack: captured again now, written once by publish_pack. */
export async function publishPack(input: unknown): Promise<Result<PublishResult>> {
  const p = publishPackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async (ctx) => {
      const r = await capture(ctx, p.data.key, p.data.excluded, {
        title: p.data.title,
        description: p.data.description,
        version: p.data.version,
      });
      if ('error' in r) return r.error!;
      const { prev, cap, parsed, problems, packKey } = r;
      if (!parsed)
        return fail('invalid', problems[0] ?? 'This setup cannot be published as it is.');
      if (contentHashOf(parsed) !== p.data.contentHash)
        return fail('conflict', 'Your setup changed since the preview. Look at it again.');
      const vp = versionProblem(prev?.version ?? null, p.data.version);
      if (vp) return fail('invalid', vp);
      if (
        prev &&
        suggestVersion({ version: prev.version, manifest: prev.manifest }, parsed).kind === 'same'
      )
        return fail('conflict', `Nothing changed since ${prev.version}.`);
      const { data, error } = await ctx.supabase.rpc('publish_pack', {
        p_org: ctx.orgId,
        p_pack: {
          key: packKey,
          version: p.data.version,
          title: p.data.title,
          description: p.data.description,
          manifest: parsed as unknown as Json,
          hash: packHash(parsed),
          counts: manifestCounts(parsed) as unknown as Json,
          left_out: cap.leftOut.map((e) => ({ kind: e.kind, where: e.where, text: e.text })),
        },
      });
      if (error) return fromDbError(error);
      return ok({
        key: packKey,
        version: p.data.version,
        title: p.data.title,
        inside: countsText(manifestCounts(parsed)),
        withdrawn: !!(data as { withdrawn?: boolean } | null)?.withdrawn,
      });
    },
    'publishPack',
  );
}

/** Withdraw a workspace's own pack: no new installs; installed copies keep working and taking updates. */
export async function withdrawPack(
  input: unknown,
): Promise<Result<{ key: string; sharedWith: number }>> {
  const p = withdrawPackInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase.rpc('withdraw_pack', {
        p_org: orgId,
        p_key: p.data.key,
      });
      if (error) return fromDbError(error);
      return ok({
        key: p.data.key,
        sharedWith: Number((data as { shared_with?: number } | null)?.shared_with ?? 0),
      });
    },
    'withdrawPack',
  );
}

export interface YourPack {
  key: string;
  title: string;
  description: string;
  version: string;
  versions: { version: string; publishedAt: string | null; publishedBy: string }[];
  withdrawnAt: string | null;
  /** Workspaces it was installed into (its shares). */
  sharedWith: number;
}

export interface InstallablePack {
  key: string;
  title: string;
  description: string;
  version: string;
  hash: string;
  /** The workspace that published it, where the person is an owner or admin. */
  publisher: string;
  withdrawn: boolean;
  /** The version installed in this workspace, if any. */
  installedVersion: string | null;
  inside: string;
}

export interface YourPacks {
  canPublish: boolean;
  workspace: string;
  /** Packs this workspace published. */
  published: YourPack[];
  /** Private packs of the other workspaces where the person is an owner or admin: they may install them here. */
  installable: InstallablePack[];
}

/** Workspace admin › Packs › Your packs. Every member may read it; only owners and admins act on it. */
export async function listYourPacks(input: unknown): Promise<Result<YourPacks>> {
  const p = listYourPacksInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'member',
    async ({ supabase, orgId, role, user }) => {
      try {
        const [own, catalogue, org, shares, mine, installs, members] = await Promise.all([
          readOwnPacks(supabase, orgId),
          readCatalogue(supabase),
          supabase.from('orgs').select('name').eq('id', orgId).single(),
          every('shares', (a, b) =>
            supabase
              .from('pack_shares')
              .select('pack_key, org_id')
              .order('pack_key')
              .order('org_id')
              .range(a, b),
          ),
          supabase
            .from('memberships')
            .select('org_id, role, orgs!inner(name)')
            .eq('user_id', user.id)
            .in('role', ['owner', 'admin']),
          supabase
            .from('pack_installs')
            .select('pack_key, version')
            .eq('org_id', orgId)
            .eq('status', 'installed'),
          every('members', (a, b) =>
            supabase
              .from('memberships')
              .select('user_id, profiles!inner(display_name)')
              .eq('org_id', orgId)
              .order('user_id')
              .range(a, b),
          ),
        ]);
        if (org.error) return fromDbError(org.error);
        const names = new Map(members.map((m) => [m.user_id, m.profiles.display_name]));
        const adminOf = new Map(
          (mine.data ?? []).filter((m) => m.org_id !== orgId).map((m) => [m.org_id, m.orgs.name]),
        );
        const live = new Map((installs.data ?? []).map((i) => [i.pack_key, i.version]));
        const published: YourPack[] = [...new Set(own.map((o) => o.key))].map((k) => {
          const versions = own.filter((o) => o.key === k);
          const last = versions.at(-1)!;
          return {
            key: k,
            title: last.title,
            description: last.description,
            version: last.version,
            versions: versions
              .map((v) => ({
                version: v.version,
                publishedAt: v.publishedAt,
                publishedBy: v.publishedBy
                  ? (names.get(v.publishedBy) ?? 'Former member')
                  : 'Someone',
              }))
              .reverse(),
            withdrawnAt: last.withdrawnAt,
            sharedWith: shares.filter((s) => s.pack_key === k).length,
          };
        });
        const installable: InstallablePack[] = catalogue
          .filter((c) => c.ownerOrgId && c.ownerOrgId !== orgId && adminOf.has(c.ownerOrgId))
          .filter((c) => !c.key.startsWith('framework-'))
          .map((c) => ({
            key: c.key,
            title: c.title,
            description: c.description,
            version: c.version,
            hash: c.hash,
            publisher: adminOf.get(c.ownerOrgId!)!,
            withdrawn: !!c.withdrawnAt,
            installedVersion: live.get(c.key) ?? null,
            inside: countsText(manifestCounts(c.manifest)),
          }));
        return ok({
          canPublish: isAdminRole(role),
          workspace: org.data.name,
          published,
          installable,
        });
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', source: 'pack-publish', error: String(e) }));
        return fail('failed', 'Your packs could not be loaded. Try again.');
      }
    },
    'listYourPacks',
  );
}

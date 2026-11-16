// The catalogue as the public site shows it (/frameworks, the landing page's teaser): every native pack and every
// framework edition, in the words people read (words.ts), grouped for the site. Pure: manifests, frameworks and the
// site's own copy in, plain data out. Names, levels, sheets, shared registers, libraries and apps all come from the
// manifests; only the one-line summary and the group are the site's copy (keyed by pack key, so a new pack fails the
// site test until it has both). Only titles are shown, never requirement text (docs/12 Licensing).
import { editionBadge, EDITION_STATUS_LABEL, type BadgeTone } from '../frameworks/status';
import type { Framework, FrameworkKind } from '../frameworks/types';
import type { PackManifest } from './types';
import { levelName, packTitle } from './words';

export const SITE_CATEGORIES = [
  { id: 'security-privacy', title: 'Information security and privacy' },
  { id: 'quality-environment-safety', title: 'Quality, environment and safety' },
  { id: 'supply-chain-improvement', title: 'Supply chain and improvement' },
] as const;

export type SiteCategoryId = (typeof SITE_CATEGORIES)[number]['id'] | 'foundation';

/** The site's own words for one pack: the group it is listed in and a one-line summary. */
export interface SiteSetCopy {
  category: SiteCategoryId;
  line: string;
}

export interface SiteLibraryRef {
  title: string;
  requirements: number;
  /** "Withdrawn · replaced by …", "Revision in progress (DIS) · expected 2027"; null for a current edition. */
  badge: string | null;
  /** Soft: linked to when the workspace has adopted it, never adopted for you. */
  optional: boolean;
}

export interface SiteSet {
  key: string;
  /** The manifest's title in plain words: "ISO/IEC 27001:2022 ISMS", "Shared registers". */
  title: string;
  line: string;
  category: SiteCategoryId;
  /** Level names lowest first (Basic, Recommended, Everything); empty when the pack installs whole. */
  levels: string[];
  /** The pack's own sheets, with the level that adds them when it is not the lowest. */
  sheets: { name: string; level: string | null }[];
  /** The shared registers the pack adds its columns and views to (names, in the shared registers' order). */
  sharedRegisters: string[];
  /** Other sets that build on at least one of the same shared registers. */
  sharedWith: string[];
  libraries: SiteLibraryRef[];
  apps: string[];
}

export interface SiteLibrary {
  key: string;
  version: string;
  title: string;
  publisher: string;
  kind: string;
  requirements: number;
  status: string;
  badge: string | null;
  /** current (no badge), replaced (withdrawn or superseded) or revision (a new edition on the way). */
  tone: BadgeTone;
  /** Sets that build on this edition. */
  usedBy: string[];
}

export interface SiteCatalogue {
  /** The shared registers every standard builds on (the system pack), shown before the groups. */
  foundation: SiteSet | null;
  groups: { id: SiteCategoryId; title: string; sets: SiteSet[] }[];
  libraries: SiteLibrary[];
  counts: { sets: number; frameworks: number; editions: number };
}

const KIND_LABEL: Record<FrameworkKind, string> = {
  standard: 'Standard',
  law: 'EU law',
  regulation: 'Regulation',
  internal: 'Internal rules',
};

/** The manifest description up to its first ": " or sentence end: a fallback when the site has no line yet. */
function firstClause(text: string): string {
  const cut = text.search(/:\s|\.\s/);
  return (cut < 0 ? text : text.slice(0, cut)).replace(/\.$/, '') + '.';
}

const requirementCount = (f: Framework) => f.requirements.filter((r) => r.kind !== 'theme').length;

export function siteCatalogue(
  packs: PackManifest[],
  frameworks: Framework[],
  copy: Record<string, SiteSetCopy>,
): SiteCatalogue {
  const system = packs.find((p) => p.system);
  const registerName = new Map((system?.sheets ?? []).map((s) => [s.ref, s.name]));
  const registerOrder = (system?.sheets ?? []).map((s) => s.ref);
  const extended = (p: PackManifest) =>
    new Set((p.extends ?? []).filter((e) => e.pack === system?.key).map((e) => e.sheet));

  const fw = (key: string, version: string) =>
    frameworks.find((f) => f.key === key && f.version === version);
  const fullBadge = (f: Framework) => {
    const next = f.supersededBy ? f.supersededBy.split('@') : null;
    const successor = next ? fw(next[0]!, next[1]!) : undefined;
    return editionBadge(f, successor?.title ?? null);
  };
  const badgeOf = (f: Framework) => fullBadge(f)?.text ?? null;

  const sets: SiteSet[] = packs.map((p) => {
    const levelNames = new Map((p.levels ?? []).map((l) => [l.key, levelName(l.name)]));
    const lowest = p.levels?.[0]?.key;
    const mine = extended(p);
    const sharedWith = p.system
      ? packs.filter((o) => !o.system && extended(o).size > 0).map((o) => packTitle(o.title))
      : packs
          .filter((o) => o !== p && !o.system && [...extended(o)].some((s) => mine.has(s)))
          .map((o) => packTitle(o.title));
    return {
      key: p.key,
      title: packTitle(p.title),
      line: copy[p.key]?.line ?? firstClause(p.description),
      category: copy[p.key]?.category ?? (p.system ? 'foundation' : 'supply-chain-improvement'),
      levels: (p.levels ?? []).map((l) => levelName(l.name)),
      sheets: p.sheets.map((s) => ({
        name: s.name,
        level: s.level && s.level !== lowest ? (levelNames.get(s.level) ?? s.level) : null,
      })),
      sharedRegisters: registerOrder
        .filter((ref) => mine.has(ref))
        .map((ref) => registerName.get(ref)!),
      sharedWith,
      libraries: (p.frameworks ?? []).flatMap((ref) => {
        const f = fw(ref.key, ref.version);
        return f
          ? [
              {
                title: f.title,
                requirements: requirementCount(f),
                badge: badgeOf(f),
                optional: !!ref.optional,
              },
            ]
          : [];
      }),
      apps: (p.apps ?? []).map((a) => a.title),
    };
  });

  const libraries: SiteLibrary[] = frameworks.map((f) => ({
    key: f.key,
    version: f.version,
    title: f.title,
    publisher: f.publisher,
    kind: KIND_LABEL[f.kind],
    requirements: requirementCount(f),
    status: EDITION_STATUS_LABEL[f.status],
    badge: badgeOf(f),
    tone: fullBadge(f)?.tone ?? 'current',
    usedBy: packs
      .filter((p) => (p.frameworks ?? []).some((r) => r.key === f.key && r.version === f.version))
      .map((p) => packTitle(p.title)),
  }));

  return {
    foundation: sets.find((s) => s.category === 'foundation') ?? null,
    groups: SITE_CATEGORIES.map((c) => ({
      id: c.id,
      title: c.title,
      sets: sets.filter((s) => s.category === c.id),
    })),
    libraries,
    counts: {
      sets: sets.length,
      frameworks: new Set(frameworks.map((f) => f.key)).size,
      editions: frameworks.length,
    },
  };
}

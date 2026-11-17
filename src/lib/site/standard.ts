// A standard's page on the public site (/standards/iso-9001), read from the repository at build time like the rest of
// the site (catalogue.ts): what the standard installs (the pack manifest), its requirement libraries with their edition
// status, the clauses each library has, the edition mapping between two editions, and which other standards use the
// same shared registers. Numbers and names come from the code, so the page cannot drift from the product.
import { dayMonthYear, editionBadge } from '@/engine/frameworks/status';
import type { Framework } from '@/engine/frameworks/types';
import { standardInstall, type StandardInstall } from '@/engine/packs/site-standard';
import { packTitle } from '@/engine/packs/words';
import { repoCrosswalks, repoFrameworks } from '@/lib/frameworks/catalogue';
import { repoPacks } from '@/lib/packs/catalogue';

export interface EditionFact {
  title: string;
  requirements: number;
  /** The badge words, null for a current edition with nothing on the way. */
  badge: string | null;
  note: string | null;
  checkedOn: string;
  /** Requirements per top-level clause ("4" → 4). */
  byClause: Record<string, number>;
}

export interface StandardPage {
  install: StandardInstall;
  /** The edition the standard installs, then the others of the same framework, newest first. */
  editions: EditionFact[];
  /** Requirements of the older edition that map one to one (equivalent) onto the newer one, and how many it has. */
  move: { from: string; to: string; equivalent: number; of: number } | null;
  /** The shared registers the standard adds to, with the other standards that add to them too. */
  shared: { name: string; usedBy: string[] }[];
}

const requirements = (f: Framework) => f.requirements.filter((r) => r.kind !== 'theme');

/** Requirements per top-level clause: the first number of the ref ("7.1.5" → "7"). */
function byClause(f: Framework): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of requirements(f)) {
    const top = r.ref.split('.')[0]!;
    out[top] = (out[top] ?? 0) + 1;
  }
  return out;
}

const STANDARD_NAME = /^(ISO(?:\/IEC)? \d+|GDPR|NIS2)/;

export function readStandardPage(key: string): StandardPage {
  const packs = repoPacks();
  const pack = packs.find((p) => p.key === key);
  if (!pack) throw new Error(`No standard ${key} in the catalogue.`);
  const frameworks = repoFrameworks();
  const own = pack.frameworks?.find((f) => !f.optional);
  const editions = own
    ? frameworks
        .filter((f) => f.key === own.key)
        .sort((a, b) =>
          a.version === own.version
            ? -1
            : b.version === own.version
              ? 1
              : b.version.localeCompare(a.version),
        )
    : [];
  const title = (f: Framework) => f.title;
  const facts: EditionFact[] = editions.map((f) => {
    const next = f.supersededBy?.split('@');
    const successor = next
      ? frameworks.find((x) => x.key === next[0] && x.version === next[1])
      : null;
    return {
      title: title(f),
      requirements: requirements(f).length,
      badge: editionBadge(f, successor ? title(successor) : null)?.text ?? null,
      note: f.statusNote,
      checkedOn: dayMonthYear(f.statusCheckedOn),
      byClause: byClause(f),
    };
  });

  // the edition mapping: an older edition's requirements that copy one to one when a workspace moves (docs/12)
  let move: StandardPage['move'] = null;
  const newer = editions[0];
  const older = editions.find((f) => f.supersededBy === `${newer?.key}@${newer?.version}`);
  if (newer && older) {
    const equivalent = new Set(
      repoCrosswalks()
        .filter(
          (c) =>
            c.relation === 'equivalent' &&
            c.from.framework === older.key &&
            c.from.version === older.version &&
            c.to.framework === newer.key &&
            c.to.version === newer.version,
        )
        .map((c) => c.from.ref),
    );
    move = {
      from: older.title,
      to: newer.title,
      equivalent: equivalent.size,
      of: requirements(older).length,
    };
  }

  const system = packs.find((p) => p.system);
  const shortName = (t: string) => t.match(STANDARD_NAME)?.[1] ?? packTitle(t);
  const shared = (pack.extends ?? [])
    .filter((e) => e.pack === system?.key)
    .map((e) => ({
      name: system!.sheets.find((s) => s.ref === e.sheet)?.name ?? e.sheet,
      usedBy: packs
        .filter(
          (p) =>
            p.key !== pack.key &&
            !p.system &&
            (p.extends ?? []).some((x) => x.pack === system!.key && x.sheet === e.sheet),
        )
        .map((p) => shortName(p.title)),
    }));

  return { install: standardInstall(pack, packs), editions: facts, move, shared };
}

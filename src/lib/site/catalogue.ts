// The catalogue and the product facts the public site shows, read from the repository at build time (the site's
// pages are static). Packs are the native pack files (templates/packs/*.json): the wizard starts and the first-sheet
// template that repoPacks() also wraps are not sets people choose on the site. Frameworks are every edition in
// templates/frameworks. Numbers come from the code, so the site cannot drift from the product.
import { MAX_DEPTH } from '@/engine/automations/chain';
import { FIELD_TYPE_IDS } from '@/engine/fields/registry';
import { siteCatalogue, type SiteCatalogue } from '@/engine/packs/site-catalogue';
import { SET_COPY } from '@/components/landing/content';
import { repoFrameworks } from '@/lib/frameworks/catalogue';
import { repoPacks } from '@/lib/packs/catalogue';

/** Packs repoPacks() wraps from a template or a wizard start, not from templates/packs. */
const isWrapped = (key: string) => key.startsWith('start-') || key.startsWith('first-sheet');

let cached: SiteCatalogue | null = null;

export function readSiteCatalogue(): SiteCatalogue {
  cached ??= siteCatalogue(
    repoPacks().filter((p) => !isWrapped(p.key)),
    repoFrameworks(),
    SET_COPY,
  );
  return cached;
}

export interface SiteFacts {
  fieldTypes: string;
  frameworks: string;
  region: string;
  loopGuard: string;
}

/** The hero's stats, each a fact of the product: the registries, the catalogue and the hosting region. */
export function siteFacts(): SiteFacts {
  return {
    fieldTypes: String(FIELD_TYPE_IDS.length),
    frameworks: String(readSiteCatalogue().counts.frameworks),
    region: 'Frankfurt, EU',
    loopGuard: `${MAX_DEPTH} levels`,
  };
}

/**
 * The hero's statement of applicability card: the first framework whose library names a statement of applicability
 * (ISO/IEC 27001 today) and how many of its requirements the statement lists.
 */
export function soaExample(): { title: string; controls: number } | null {
  const f = repoFrameworks().find((x) => x.library.soa);
  if (!f?.library.soa) return null;
  const prefix = f.library.soa.refStartsWith;
  return {
    title: f.title,
    controls: f.requirements.filter((r) => r.kind !== 'theme' && r.ref.startsWith(prefix)).length,
  };
}

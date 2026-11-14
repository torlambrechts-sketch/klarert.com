// The frameworks this repository ships (docs/12): templates/frameworks/*.json and the cross-walk file. The seed
// writes them into the global catalogue (frameworks, requirements, crosswalks) and each framework's library into
// the packs catalogue (frameworkToPack); the app reads the tables.
import iso27001 from '../../../templates/frameworks/iso-27001-2022.json';
import iso9001 from '../../../templates/frameworks/iso-9001-2015.json';
import iso9001v2026 from '../../../templates/frameworks/iso-9001-2026.json';
import iso14001 from '../../../templates/frameworks/iso-14001-2015.json';
import iso14001v2026 from '../../../templates/frameworks/iso-14001-2026.json';
import iso45001 from '../../../templates/frameworks/iso-45001-2018.json';
import gdpr from '../../../templates/frameworks/gdpr-2016.json';
import nis2 from '../../../templates/frameworks/nis2-2022.json';
import crosswalkFile from '../../../templates/frameworks/crosswalks.json';
import { expandCrosswalks } from '@/engine/frameworks/crosswalks';
import { frameworkToPack } from '@/engine/frameworks/pack';
import type { Crosswalk, Framework } from '@/engine/frameworks/types';
import type { PackManifest } from '@/engine/packs/types';
import { parsePack } from '@/lib/packs/manifest';
import { parseCrosswalkFile, parseFramework } from './schema';

export function repoFrameworks(): Framework[] {
  return [iso27001, iso9001, iso9001v2026, iso14001, iso14001v2026, iso45001, gdpr, nis2].map(
    parseFramework,
  );
}

export function repoCrosswalks(): Crosswalk[] {
  return expandCrosswalks(parseCrosswalkFile(crosswalkFile));
}

/** Each framework's library as a pack, checked like any pack manifest. */
export function frameworkPacks(frameworks: Framework[] = repoFrameworks()): PackManifest[] {
  return frameworks.map((f) => parsePack(frameworkToPack(f)));
}

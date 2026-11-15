// The words people see for packs (docs/05 Words, docs/11, owner decision 15 Nov 2026). The catalogue keeps its
// manifests as written (keys, titles and versions do not change): this maps the pack vocabulary to plain words at
// display time. "Add-on" becomes "standard", "Core registers" becomes "Shared registers" and the levels Foundations,
// Starter and Full become Basic, Standard and Everything. Pure: text in, text out.
import type { PackManifest } from './types';

/** The level names people see, by the name a manifest gives. */
const LEVEL_NAMES: Record<string, string> = {
  Foundations: 'Basic',
  Starter: 'Standard',
  Full: 'Everything',
};

/** The Core registers pack's title in the catalogue and its plain name. */
const CORE_TITLE = 'Core registers';
const SHARED_TITLE = 'Shared registers';

/** A pack title as people see it: "GDPR privacy (add-on)" → "GDPR privacy", "Core registers" → "Shared registers". */
export function packTitle(title: string): string {
  const t = title.replace(/\s*\(add-on\)\s*$/i, '').trim();
  return t === CORE_TITLE ? SHARED_TITLE : t;
}

/** A level name as people see it: Foundations → Basic, Starter → Standard, Full → Everything; others unchanged. */
export function levelName(name: string): string {
  return LEVEL_NAMES[name] ?? name;
}

/**
 * Whole phrases first, in order, then single words. Each pair is [what the manifest says, what people read]. The
 * level names in running text read "the Standard level" so they are not taken for a standard such as ISO 9001.
 */
const PHRASES: [RegExp, string][] = [
  [/\s*\(add-on\)/g, ''],
  [
    /Standards are added as add-ons that extend these registers/g,
    'Standards extend these registers',
  ],
  [/\badd-ons\b/g, 'standards'],
  [/\badd-on\b/g, 'standard'],
  [/\bAdd-ons\b/g, 'Standards'],
  [/\bAdd-on\b/g, 'Standard'],
  [/\bthe Core registers\b/g, 'the shared registers'],
  [/\bCore registers\b/g, SHARED_TITLE],
  [/\bEverything in Foundations plus\b/g, 'Everything in Basic plus'],
  [/\bEverything in Starter plus\b/g, 'Everything in Standard plus'],
  [/\bStarter has no\b/g, 'The Standard level has no'],
  [/\badd Full for\b/g, 'add the Everything level for'],
  [/\bFull adds\b/g, 'The Everything level adds'],
  [/\bin Full\b/g, 'at the Everything level'],
  [/\(Full\b/g, '(Everything'],
  [/\(Starter\b/g, '(Standard'],
  [/\(Foundations\b/g, '(Basic'],
];

/** A pack's running text (description, level and setup text) in the words people see. */
export function packProse(text: string): string {
  return PHRASES.reduce((t, [from, to]) => t.replace(from, to), text);
}

/**
 * A manifest with the text people see in plain words: title, description, level names and descriptions, and the
 * setup checklist's title, description and steps. Keys, refs, sheets and everything an install writes stay as they
 * are, so planning and hashes do not change.
 */
export function manifestForPeople<
  M extends Pick<PackManifest, 'title' | 'description'> & {
    levels?: PackManifest['levels'];
    setup?: PackManifest['setup'];
  },
>(m: M): M {
  return {
    ...m,
    title: packTitle(m.title),
    description: packProse(m.description),
    ...(m.levels
      ? {
          levels: m.levels.map((l) => ({
            ...l,
            name: levelName(l.name),
            description: packProse(l.description),
          })),
        }
      : {}),
    ...(m.setup
      ? {
          setup: {
            ...m.setup,
            title: packProse(m.setup.title),
            description: packProse(m.setup.description),
            steps: m.setup.steps.map((s) => ({
              ...s,
              title: packProse(s.title),
              body: packProse(s.body),
              ...(s.levels
                ? {
                    levels: Object.fromEntries(
                      Object.entries(s.levels).map(([k, v]) => [
                        k,
                        {
                          ...v,
                          ...(v.title !== undefined ? { title: packProse(v.title) } : {}),
                          ...(v.body !== undefined ? { body: packProse(v.body) } : {}),
                        },
                      ]),
                    ),
                  }
                : {}),
            })),
          },
        }
      : {}),
  };
}

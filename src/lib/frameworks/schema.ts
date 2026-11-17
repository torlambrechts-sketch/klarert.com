// The framework files (templates/frameworks/*.json, docs/12) and the cross-walk file, checked with Zod at load. A
// framework is reference data: reference numbers, short titles, and our own purpose, guidance, questions and
// evidence; never the framework's text.
import { z } from 'zod';
import type { CrosswalkFile } from '@/engine/frameworks/crosswalks';
import { isRequirementKey } from '@/engine/frameworks/refs';
import {
  EDITION_STATUSES,
  FRAMEWORK_KINDS,
  RELATIONS,
  REQUIREMENT_KINDS,
  TITLES_POLICIES,
  type Framework,
} from '@/engine/frameworks/types';
import { ID_PREFIX } from '@/engine/labels';

/** Longest title we ship: a short heading, never a sentence of the standard. */
export const MAX_TITLE = 80;

/** A calendar date, "2026-11-14". */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const requirementSchema = z.object({
  ref: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^#@]+$/, 'A ref cannot hold "#" or "@".'),
  parent: z.string().min(1).max(40).nullable().default(null),
  kind: z.enum(REQUIREMENT_KINDS),
  title: z.string().trim().min(1).max(MAX_TITLE),
  purpose: z.string().trim().min(1).max(300).nullable().default(null),
  guidance: z.string().trim().min(1).max(2000).nullable().default(null),
  questions: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  evidence: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
  tags: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/))
    .max(10)
    .default([]),
});

export const frameworkSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lower-case letters, digits and "-".'),
    version: z.string().regex(/^\d{1,4}$/, 'Use the edition year, like 2022.'),
    revision: z.number().int().min(1).max(999),
    title: z.string().trim().min(1).max(120),
    shortTitle: z.string().trim().min(1).max(12),
    publisher: z.string().trim().min(1).max(120),
    kind: z.enum(FRAMEWORK_KINDS),
    source: z.string().trim().min(1).max(500),
    licence: z.string().trim().min(1).max(500),
    url: z.url(),
    titles: z.enum(TITLES_POLICIES),
    library: z.object({
      name: z.string().trim().min(1).max(120),
      itemLabel: z.string().trim().min(1).max(60),
      idPrefix: z.string().regex(ID_PREFIX),
      folder: z.string().trim().min(1).max(80),
      packKey: z
        .string()
        .regex(/^framework-[a-z0-9][a-z0-9-]{0,60}$/, 'Use framework-<key>-<version>.')
        .optional(),
      soa: z
        .object({
          name: z.string().trim().min(1).max(80),
          refStartsWith: z.string().min(1).max(20),
        })
        .optional(),
    }),
    // edition status (docs/12 Standards watch): catalogue metadata, not library content
    status: z.enum(EDITION_STATUSES),
    supersededBy: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}@\d{1,4}$/, 'Use <key>@<version>.')
      .nullable()
      .default(null),
    transitionEnds: isoDate.nullable().default(null),
    revisionStage: z.string().trim().min(1).max(20).nullable().default(null),
    revisionExpected: z.string().trim().min(1).max(20).nullable().default(null),
    statusNote: z.string().trim().min(1).max(500).nullable().default(null),
    statusCheckedOn: isoDate,
    requirements: z
      .array(requirementSchema)
      .min(1)
      .max(490)
      .transform((list) => list.map((r, position) => ({ ...r, position }))),
  })
  .superRefine((f, ctx) => {
    const problem = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const refs = new Map<string, number>();
    f.requirements.forEach((r, i) => {
      if (refs.has(r.ref)) problem(['requirements', i], `Duplicate ref "${r.ref}".`);
      refs.set(r.ref, i);
    });
    f.requirements.forEach((r, i) => {
      if (r.parent && !refs.has(r.parent))
        problem(['requirements', i], `Unknown parent "${r.parent}".`);
      if (r.parent && refs.get(r.parent)! > i)
        problem(['requirements', i], `List "${r.parent}" before "${r.ref}".`);
      if (r.kind === 'theme' && r.parent) problem(['requirements', i], 'A theme has no parent.');
      if (r.kind !== 'theme' && !r.parent)
        problem(['requirements', i], `"${r.ref}" needs a parent theme.`);
    });
    if (!f.requirements.some((r) => r.kind === 'theme'))
      problem(['requirements'], 'A framework needs at least one theme.');
    const replaced = f.status === 'withdrawn' || f.status === 'superseded-in-transition';
    if (replaced && !f.supersededBy)
      problem(
        ['supersededBy'],
        'A withdrawn or superseded edition names the edition that replaces it.',
      );
    if (!replaced && (f.supersededBy || f.transitionEnds))
      problem(
        ['status'],
        'Only a withdrawn or superseded edition has supersededBy or transitionEnds.',
      );
    if (f.supersededBy === `${f.key}@${f.version}`)
      problem(['supersededBy'], 'An edition cannot replace itself.');
    if (f.status === 'revision-in-progress' && !f.revisionStage)
      problem(['revisionStage'], 'Say the stage of the revision (DIS, FDIS).');
  });

/** Parse a framework file; throws with every problem listed. */
export function parseFramework(raw: unknown): Framework {
  const r = frameworkSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(
    `Framework is not valid:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
}

const reqKey = z.string().refine(isRequirementKey, 'Use <framework>@<version>#<ref>.');

export const crosswalkFileSchema = z.object({
  source: z.string().trim().min(1).max(80),
  reviewed: z.string().optional(),
  about: z.string().optional(),
  sets: z
    .array(
      z.object({
        relation: z.enum(RELATIONS),
        note: z.string().max(300).optional(),
        members: z.array(reqKey).min(2).max(10),
        partial: z.array(reqKey).max(10).optional(),
      }),
    )
    .default([]),
  pairs: z
    .array(
      z.object({
        from: reqKey,
        to: reqKey,
        relation: z.enum(RELATIONS),
        note: z.string().max(300).optional(),
      }),
    )
    .default([]),
});

export function parseCrosswalkFile(raw: unknown): CrosswalkFile {
  const r = crosswalkFileSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(
    `Cross-walks are not valid:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
}

/**
 * The engine's type is the schema's output (a compile-time check that the two stay the same), except that a file in
 * the repository can never say `titles: "customer"` (a workspace's own framework, docs/12) and never carries a
 * requirement's text.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type RepoFramework = Omit<Framework, 'titles'> & { titles: (typeof TITLES_POLICIES)[number] };
const sameType: Same<z.output<typeof frameworkSchema>, RepoFramework> = true;
void sameType;

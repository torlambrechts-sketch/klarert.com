// Writes the demo content (content/*.ts) into the workspace through the app's commands: items, their history,
// links between registers, files, comments, approvals and the library decisions. Every change is made as the person
// the content names (scripts/demo/writer.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import type { DemoClock } from './clock';
import type { LibraryPlan } from './content/library';
import type { DemoFile, DemoItem, DemoSheet, Ref } from './content/types';
import { makePdf, makeText } from './pdf';
import { person, type PersonRef } from './people';
import type { SheetInfo, Writer } from './writer';

type Db = SupabaseClient<Database>;
type Cmd = (
  input: unknown,
) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>;

export interface BuildCommands {
  bulkSetValues: Cmd;
  submitForApproval: Cmd;
  decideApproval: Cmd;
}

export interface Built {
  /** `<sheet>#<name>` → item id */
  items: Map<string, string>;
  /** `<key>@<version>` → library sheet and its items by ref */
  libraries: Map<string, { sheet: SheetInfo; byRef: Map<string, string> }>;
}

export async function readLibraries(admin: Db, w: Writer): Promise<Built['libraries']> {
  const { data } = await admin
    .from('sheets')
    .select('id, name, settings')
    .eq('org_id', w.orgId)
    .eq('is_library', true)
    .is('archived_at', null);
  const out: Built['libraries'] = new Map();
  for (const s of data ?? []) {
    const fw = (s.settings as { framework?: { key: string; version: string } }).framework;
    if (!fw) continue;
    const sheet = await w.sheet(s.name);
    const { data: rows } = await admin
      .from('items')
      .select('id, requirement_ref')
      .eq('sheet_id', s.id)
      .is('archived_at', null);
    const byRef = new Map<string, string>();
    for (const r of rows ?? []) {
      const ref = r.requirement_ref?.split('#')[1];
      if (ref) byRef.set(ref, r.id);
    }
    out.set(`${fw.key}@${fw.version}`, { sheet, byRef });
  }
  return out;
}

function resolver(built: Built) {
  return (ref: Ref): string => {
    if (ref.startsWith('req:')) {
      const [fw, r] = ref.slice(4).split('#') as [string, string];
      const id = built.libraries.get(fw)?.byRef.get(r);
      if (!id) throw new Error(`No requirement ${r} in ${fw}.`);
      return id;
    }
    const key = ref.slice(5);
    const id = built.items.get(key);
    if (!id) throw new Error(`No item ${key} (create it before linking to it).`);
    return id;
  };
}

const email = (ref: PersonRef) => person(ref).email;

async function upload(w: Writer, s: SheetInfo, itemId: string, f: DemoFile) {
  const pdf = f.name.endsWith('.pdf');
  await w.file(s, itemId, f.field, {
    name: f.name,
    body: pdf ? makePdf(f.lines) : makeText(f.lines),
    mime: pdf ? 'application/pdf' : 'text/plain',
    validUntil: f.validUntil,
    description: f.description,
  });
}

/** Write every sheet's items in order; links to other items are made once everything exists. */
export async function writeContent(
  w: Writer,
  built: Built,
  sheets: DemoSheet[],
  commands: BuildCommands,
  later: { from: Ref; field: string; to: Ref[] }[] = [],
) {
  const resolve = resolver(built);
  const deferred: { sheet: SheetInfo; itemId: string; field: string; to: Ref[] }[] = [];
  const approvals: { sheet: SheetInfo; itemId: string; spec: NonNullable<DemoItem['approval']> }[] =
    [];
  const verbose = process.env.DEMO_VERBOSE === '1';
  for (const block of sheets) {
    const s = await w.sheet(block.sheet);
    if (verbose) console.log(`  · ${block.sheet}`);
    for (const it of block.items) {
      if (verbose) console.log(`    - ${it.name}`);
      await w.as(email(it.by));
      const id = await w.create(s, { name: it.name, group: it.group, values: it.values });
      built.items.set(`${block.sheet}#${it.name}`, id);
      for (const [field, refs] of Object.entries(it.links ?? {})) {
        if (refs.every((r) => r.startsWith('req:'))) await w.link(s, id, field, refs.map(resolve));
        else deferred.push({ sheet: s, itemId: id, field, to: refs });
      }
      for (const f of it.files ?? []) await upload(w, s, id, f);
      for (const step of it.steps ?? []) {
        await w.as(email(step.by));
        await w.update(s, id, step.values, step.note);
      }
      for (const cm of it.comments ?? []) {
        await w.as(email(cm.by));
        await w.comment(id, cm.body);
      }
      if (it.approval) approvals.push({ sheet: s, itemId: id, spec: it.approval });
    }
  }
  for (const d of deferred) {
    await w.as(email('priya'));
    await w.link(d.sheet, d.itemId, d.field, d.to.map(resolve));
  }
  for (const l of later) {
    const [sheetName] = l.from.slice(5).split('#') as [string];
    const s = await w.sheet(sheetName);
    await w.as(email('priya'));
    await w.link(s, resolve(l.from), l.field, l.to.map(resolve));
  }
  for (const a of approvals) {
    await w.as(email(a.spec.by));
    const sub = w.must(
      (await commands.submitForApproval({
        org: w.org,
        sheetId: a.sheet.id,
        itemId: a.itemId,
        workflowId: a.spec.workflow,
      })) as { ok: boolean; data?: { instanceId: string }; error?: { message: string } },
      'submit for approval',
    );
    for (const d of a.spec.decisions ?? []) {
      await w.as(email(d.by));
      w.must(
        await commands.decideApproval({
          org: w.org,
          instanceId: sub.instanceId,
          decision: d.decision,
          ...(d.comment ? { comment: d.comment } : {}),
        }),
        'approval decision',
      );
    }
  }
}

/** Applicability, justification, status, owner and review date on a library, then its evidence files. */
export async function writeLibrary(
  w: Writer,
  built: Built,
  plan: LibraryPlan,
  c: DemoClock,
  commands: BuildCommands,
) {
  const lib = built.libraries.get(plan.framework);
  if (!lib) throw new Error(`The library ${plan.framework} is not adopted.`);
  const { sheet, byRef } = lib;
  const decided = plan.applicable === '*' ? [...byRef.keys()] : plan.applicable;
  const refs = new Set([...decided, ...Object.keys(plan.notApplicable)]);
  const status = (ref: string) =>
    plan.implemented.includes(ref)
      ? 'Implemented'
      : plan.partial.includes(ref)
        ? 'Partially'
        : plan.planned.includes(ref)
          ? 'Planned'
          : undefined;
  const field = (key: string) => {
    const f = sheet.fields.get(key);
    if (!f) throw new Error(`${sheet.name} has no field ${key}.`);
    return f.id;
  };
  const items = [...refs].map((ref) => {
    const itemId = byRef.get(ref);
    if (!itemId) throw new Error(`No requirement ${ref} in ${plan.framework}.`);
    const na = plan.notApplicable[ref];
    const values: Record<string, unknown> = {
      [field('applicable')]: na
        ? { applicable: false, reason: na }
        : { applicable: true, reason: '' },
      [field('owner')]: person(plan.owner).name,
      [field('last_reviewed')]: c.day(-plan.reviewedDaysAgo - (ref.length % 9)),
    };
    if (na) values[field('justification')] = na;
    const st = na ? undefined : status(ref);
    if (st) values[field('status')] = st;
    return { itemId, values };
  });
  await w.as(email(plan.owner));
  for (let i = 0; i < items.length; i += 200) {
    w.must(
      await commands.bulkSetValues({
        org: w.org,
        sheetId: sheet.id,
        items: items.slice(i, i + 200),
      }),
      `decisions in ${sheet.name}`,
    );
  }
  for (const e of plan.evidence) {
    await upload(w, sheet, byRef.get(e.ref)!, {
      field: 'evidence',
      name: e.name,
      lines: e.lines,
      validUntil:
        e.validInDays === undefined || e.validInDays === null ? null : c.day(e.validInDays),
    });
  }
  for (const e of plan.expired ?? []) {
    await upload(w, sheet, byRef.get(e.ref)!, {
      field: 'evidence',
      name: e.name,
      lines: e.lines,
      validUntil: c.day(-e.expiredDaysAgo),
    });
  }
}

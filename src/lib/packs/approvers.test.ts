import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalRecordProblems, type ApprovalWorkflow } from '@/engine/approvals/definition';
import { approvalRecordKeys } from '@/engine/documents';
import type { PackManifest, PackSheet } from '@/engine/packs/types';
import { packs } from './addon.fixture';
import { parsePack } from './manifest';

// Every approval workflow a pack ships can be submitted (docs/04 §13): the people field a step takes its approvers
// from, and every field it requires, can be filled in by people before submitting. A documents register's Approver
// and Approved on are the record of an approval, filled in when it finishes and refused from anyone else
// (`_document_transition`), so they can never be either (owner decision, Core registers 1.2.0: "Approve by").

type Field = PackSheet['fields'][number];

/** Each workflow of a manifest with the fields of the sheet it runs on (an extended sheet: its own and the entry's). */
function workflowsOf(
  m: PackManifest,
  all: PackManifest[],
): { where: string; w: ApprovalWorkflow; fields: Field[]; recordKeys: readonly string[] }[] {
  const out: ReturnType<typeof workflowsOf> = [];
  for (const s of m.sheets)
    for (const w of s.workflows ?? [])
      out.push({
        where: `${m.key}@${m.version} ${s.ref} › ${w.id}`,
        w: w as ApprovalWorkflow,
        fields: s.fields,
        recordKeys: approvalRecordKeys(s),
      });
  for (const e of m.extends ?? []) {
    const base = all.find((p) => p.key === e.pack)?.sheets.find((s) => s.ref === e.sheet);
    for (const w of e.workflows ?? [])
      out.push({
        where: `${m.key}@${m.version} ${e.pack}:${e.sheet} › ${w.id}`,
        w: w as ApprovalWorkflow,
        fields: [...(base?.fields ?? []), ...(e.fields ?? [])],
        recordKeys: approvalRecordKeys(base),
      });
  }
  return out;
}

/** What stops people from submitting the workflow: approvers or required fields they cannot fill in first. */
function submitProblems(x: ReturnType<typeof workflowsOf>[number]): string[] {
  const out = approvalRecordProblems(x.w, x.fields, x.recordKeys);
  const byKey = new Map(x.fields.map((f) => [f.key, f]));
  for (const s of x.w.steps) {
    if (s.approvers.kind !== 'field') continue;
    const f = byKey.get(s.approvers.fieldKey);
    if (!f) out.push(`${s.name}: no field "${s.approvers.fieldKey}".`);
    else if (f.type !== 'people') out.push(`${s.name}: ${f.name} is a ${f.type} field.`);
  }
  // a field people cannot type into: worked out, looked up or written by the workflow itself
  const computed = new Set(['formula', 'lookup', 'rollup', 'workflowstep', 'autonumber']);
  for (const k of x.w.requiredFields) {
    const f = byKey.get(k);
    if (!f) out.push(`Required: no field "${k}".`);
    else if (computed.has(f.type)) out.push(`Required: ${f.name} is a ${f.type} field.`);
  }
  return out;
}

describe('approval workflows can be submitted', () => {
  const all = packs.flatMap((p) => workflowsOf(p, packs));

  it('ships workflows in Core and the add-ons', () => {
    expect(all.length).toBeGreaterThan(15);
    expect(all.map((x) => x.where)).toContain('core@1.3.0 documents › document-approval');
  });

  it.each(all.map((x) => [x.where, x] as const))(
    '%s: approvers and required fields are filled in before submitting',
    (_, x) => {
      expect(submitProblems(x)).toEqual([]);
    },
  );

  it('Document approval goes to the people in Approve by; Approver and Approved on stay the record', () => {
    const docs = packs.find((p) => p.key === 'core')!.sheets.find((s) => s.ref === 'documents')!;
    const w = docs.workflows![0]!;
    expect(w.steps.map((s) => s.approvers)).toEqual([{ kind: 'field', fieldKey: 'approve_by' }]);
    expect(w.requiredFields).toEqual(['owner', 'approve_by']);
    expect(docs.fields.find((f) => f.key === 'approve_by')).toMatchObject({
      name: 'Approve by',
      type: 'people',
    });
    for (const k of ['approver', 'approved_on'])
      expect(docs.fields.find((f) => f.key === k)?.description).toMatch(
        /Filled in when the approval finishes/,
      );
  });

  it('catches Core 1.1.0, whose approvers came from the locked Approver', () => {
    const core110 = parsePack(
      JSON.parse(
        readFileSync(join(process.cwd(), 'src/lib/packs/fixtures/core-1.1.0.json'), 'utf8'),
      ) as unknown,
    );
    const docs = workflowsOf(core110, [core110]).find((x) => x.where.includes('documents'))!;
    expect(submitProblems(docs)).toEqual([
      'Step 1, Approval: Approver is filled in only when the approval finishes. Choose a people field that is filled in before submitting.',
      'Approver is filled in only when the approval finishes, so it cannot be required before submitting.',
    ]);
  });
});

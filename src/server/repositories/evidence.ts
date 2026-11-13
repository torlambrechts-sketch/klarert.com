import 'server-only';
import type { EvidenceRow } from '@/engine/evidence-library';
import { fetchDirectory, type Db } from '@/lib/sheet-query';

// Reads for the evidence library and the evidence widgets (docs/05 §4). Run under the person's session and RLS:
// the current, live file versions (replaced_by and archived_at null) of the workspace, on items and fields that are
// not archived, in sheets that are not archived. Files of an item's Files tab (no field) are listed as "Item file".

const PAGE = 1000;
/** Files of an item's Files tab are not in a field: the library names them like this. */
const ITEM_FILE = { id: '', name: 'Item file' };
const ID_CHUNK = 150;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

async function chunked<T>(ids: string[], run: (ids: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK)
    out.push(...(await run(ids.slice(i, i + ID_CHUNK))));
  return out;
}

type FileDb = {
  id: string;
  item_id: string;
  field_id: string | null;
  filename: string;
  source: string;
  collected_at: string;
  valid_until: string | null;
  uploaded_by: string | null;
};

async function currentFiles(db: Db, orgId: string): Promise<FileDb[]> {
  const out: FileDb[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(
      await db
        .from('files')
        .select('id, item_id, field_id, filename, source, collected_at, valid_until, uploaded_by')
        .eq('org_id', orgId)
        .is('replaced_by', null)
        .is('archived_at', null)
        .order('id')
        .range(from, from + PAGE - 1),
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Every current file of the workspace the person can read, with its item, sheet, field and uploader. */
export async function fetchEvidence(db: Db, orgId: string): Promise<EvidenceRow[]> {
  const files = await currentFiles(db, orgId);
  if (files.length === 0) return [];
  const itemIds = [...new Set(files.map((f) => f.item_id))];
  const fieldIds = [...new Set(files.flatMap((f) => (f.field_id ? [f.field_id] : [])))];
  const [items, fields, sheets, directory] = await Promise.all([
    chunked(itemIds, async (part) =>
      must(
        await db
          .from('items')
          .select('id, sheet_id, display_id, name')
          .in('id', part)
          .is('archived_at', null),
      ),
    ),
    chunked(fieldIds, async (part) =>
      must(await db.from('fields').select('id, name').in('id', part).is('archived_at', null)),
    ),
    db.from('sheets').select('id, name').eq('org_id', orgId).is('archived_at', null).then(must),
    fetchDirectory(db, orgId),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const personName = new Map(directory.people.map((p) => [p.id, p.name]));
  const out: EvidenceRow[] = [];
  for (const f of files) {
    const item = itemById.get(f.item_id);
    const field = f.field_id ? fieldById.get(f.field_id) : ITEM_FILE;
    const sheet = item ? sheetById.get(item.sheet_id) : undefined;
    if (!item || !field || !sheet) continue;
    out.push({
      fileId: f.id,
      filename: f.filename,
      source: f.source,
      collectedAt: f.collected_at,
      validUntil: f.valid_until,
      uploadedBy: f.uploaded_by ? (personName.get(f.uploaded_by) ?? 'Former member') : null,
      item: { id: item.id, displayId: item.display_id, name: item.name },
      sheet: { id: sheet.id, name: sheet.name },
      field: { id: field.id, name: field.name },
    });
  }
  return out;
}

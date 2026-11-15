import { describe, expect, it } from 'vitest';
import { fetchAllPages } from './sheet-query';

// fetchAllPages reads a list past the API's 1000-row cap (supabase/config.toml max_rows): a page at a time until a
// short page, so a workspace with more than 1000 sheets still offers every one of them in a sheet picker.

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

function source(all: { id: string }[]) {
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  };
  return { asked, page };
}

describe('fetchAllPages', () => {
  it('reads one short page once', async () => {
    const s = source(rows(3));
    expect(await fetchAllPages(s.page)).toHaveLength(3);
    expect(s.asked).toEqual([[0, 999]]);
  });

  it('reads past 1000 rows, page by page, until a short page', async () => {
    const s = source(rows(2345));
    const got = await fetchAllPages(s.page);
    expect(got).toHaveLength(2345);
    expect(got.at(-1)).toEqual({ id: 's2344' });
    expect(s.asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more after a full last page and stops at the empty one', async () => {
    const s = source(rows(2000));
    expect(await fetchAllPages(s.page)).toHaveLength(2000);
    expect(s.asked).toHaveLength(3);
  });

  it('throws the error of a page', async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: 'permission denied' } })),
    ).rejects.toThrow('permission denied');
  });
});

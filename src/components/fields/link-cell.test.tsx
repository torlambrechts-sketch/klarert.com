import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Ctx, Field, Item } from '@/engine/types';
import { LinkCell, linkSummary } from './link-cell';

const item = (id: string, displayId: string, name: string) =>
  ({ id, displayId, name, values: {} }) as unknown as Item;

const items = new Map([
  ['a', item('a', 'ACT-001', 'Replace the fire door')],
  ['b', item('b', 'ACT-002', 'Train the night shift')],
  ['c', item('c', 'ACT-003', 'Update the risk register')],
]);

const ctxWith = (links: string[]) =>
  ({ links: () => links, item: (id: string) => items.get(id) }) as unknown as Ctx;

const field = { id: 'f1', key: 'actions', name: 'Actions', type: 'link', config: {} } as Field;
const row = item('r', 'CA-001', 'Fire door');

const render = (links: string[]) =>
  renderToStaticMarkup(
    <LinkCell value={null} field={field} item={row} ctx={ctxWith(links)} density="table" />,
  );

// markup without the screen-reader-only list: what a sighted person sees in the row
const visible = (html: string) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, '');

describe('link cell', () => {
  it('summarises the links: the first one, how many more, and all of them in order', () => {
    const s = linkSummary(['a', 'gone', 'c'], { item: (id) => items.get(id) });
    expect(s.first?.item?.displayId).toBe('ACT-001');
    expect(s.more).toBe(2);
    expect(s.label).toBe(
      'ACT-001 Replace the fire door, Archived or hidden item, ACT-003 Update the risk register',
    );
  });

  it('shows the first linked item and a +N badge, never a second chip', () => {
    const html = render(['a', 'b', 'c']);
    const seen = visible(html);
    expect(seen).toContain('ACT-001');
    expect(seen).toContain('+2');
    expect(seen).not.toContain('ACT-002');
    expect(seen).not.toContain('ACT-003');
  });

  it('names every linked item for screen readers', () => {
    expect(render(['a', 'b', 'c'])).toContain(
      '<span class="sr-only">3 linked items: ACT-001 Replace the fire door, ACT-002 Train the night shift, ACT-003 Update the risk register</span>',
    );
  });

  it('shows one link as a chip with no badge', () => {
    const html = render(['b']);
    expect(visible(html)).toContain('ACT-002');
    expect(html).not.toContain('link-more');
    expect(html).toContain('<span class="sr-only">ACT-002 Train the night shift</span>');
  });

  it('reads as empty with no links', () => {
    expect(render([])).toBe('<span class="sr-only">Empty</span>');
  });
});

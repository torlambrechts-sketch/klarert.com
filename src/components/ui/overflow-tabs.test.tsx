import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverflowTabs, splitTabs } from './overflow-tabs';

const tabs = ['Table', 'Insights', 'Board', 'Calendar', 'Form'].map((label) => ({
  id: label.toLowerCase(),
  label,
}));

const render = (active: string, list = tabs) =>
  renderToStaticMarkup(
    <OverflowTabs
      label="Views"
      tabs={list}
      active={active}
      onSelect={() => {}}
      renderTab={(t, on) => (
        <a href={`?view=${t.id}`} aria-current={on ? 'page' : undefined}>
          {t.label}
        </a>
      )}
    />,
  );

describe('splitTabs', () => {
  it('shows every tab while they fit in three controls', () => {
    const r = splitTabs(tabs.slice(0, 3), 'board');
    expect(r.visible.map((t) => t.id)).toEqual(['table', 'insights', 'board']);
    expect(r.overflow).toEqual([]);
    expect(r.activeInMenu).toBeNull();
  });

  it('keeps two tabs and moves the rest into More from four tabs on', () => {
    const r = splitTabs(tabs.slice(0, 4), 'table');
    expect(r.visible.map((t) => t.id)).toEqual(['table', 'insights']);
    expect(r.overflow.map((t) => t.id)).toEqual(['board', 'calendar']);
    expect(r.activeInMenu).toBeNull();
  });

  it('names the active tab when it sits in the menu', () => {
    expect(splitTabs(tabs, 'calendar').activeInMenu?.label).toBe('Calendar');
  });

  it('can force the menu for extra items', () => {
    const r = splitTabs(tabs.slice(0, 2), 'table', { forceMenu: true });
    expect(r.visible.map((t) => t.id)).toEqual(['table', 'insights']);
    expect(r.overflow).toEqual([]);
  });
});

describe('OverflowTabs', () => {
  it('renders two tabs and a More trigger', () => {
    const html = render('table');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('>Table</a>');
    expect(html).toContain('>Insights</a>');
    expect(html).not.toContain('>Board</a>');
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>.*More/);
  });

  it('shows the active overflow tab on the trigger with the active underline', () => {
    const html = render('form');
    const trigger = html.slice(html.indexOf('<button'));
    expect(trigger).toContain('Form');
    expect(trigger).not.toContain('More');
    expect(trigger).toContain('after:bg-[var(--ink)]');
  });

  it('has no menu when three tabs fit', () => {
    expect(render('table', tabs.slice(0, 3))).not.toContain('<button');
  });
});

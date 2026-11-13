import { describe, expect, it } from 'vitest';
import { RECIPES, recipeById } from './recipes';

describe('automation recipes', () => {
  it('loads every recipe of templates/automation-recipes.json', () => {
    expect(RECIPES.length).toBe(15);
    expect(recipeById('done-lock')?.title).toBe('When status is done, lock the item');
  });

  it('uses only roles the recipe declares', () => {
    for (const r of RECIPES) {
      const text = JSON.stringify([r.trigger, r.conditions ?? [], r.actions]);
      const used = [...text.matchAll(/\{\{?([a-z_]+)\}\}?/g)]
        .map((m) => m[1]!)
        .filter((k) => !['id', 'name', 'sheet', 'group', 'link', 'actor'].includes(k));
      for (const role of used) expect(Object.keys(r.roles), `${r.id}: ${role}`).toContain(role);
    }
  });
});

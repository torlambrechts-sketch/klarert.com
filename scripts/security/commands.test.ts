import { describe, expect, it } from 'vitest';
import { inventory, PUBLIC_COMMANDS } from './commands';

// M10 security review: every command validates its input with Zod before doing anything and checks the caller's role
// (docs/09-security-review.md). A new command without either fails here.

const rows = inventory();

describe('server commands', () => {
  it('finds the commands', () => {
    expect(rows.length).toBeGreaterThan(60);
    expect(rows.map((r) => r.name)).toContain('setValues');
  });

  it.each(rows.map((r) => [r.name, r] as const))('%s parses its input with Zod first', (_, r) => {
    expect(r.schema, `${r.file}: ${r.name} has no safeParse`).not.toBeNull();
    expect(r.parsesFirst, `${r.file}: ${r.name} awaits before validating`).toBe(true);
  });

  it.each(rows.map((r) => [r.name, r] as const))('%s checks who is calling', (_, r) => {
    expect(r.role, `${r.file}: ${r.name} has no role check`).not.toBeNull();
    if (r.role === 'public (token)') expect(PUBLIC_COMMANDS[r.name]).toBeTruthy();
  });

  it('only the public form is public', () => {
    expect(rows.filter((r) => r.role === 'public (token)').map((r) => r.name)).toEqual([
      'submitPublicForm',
    ]);
  });
});

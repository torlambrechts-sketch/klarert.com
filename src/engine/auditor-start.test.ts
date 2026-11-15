import { describe, expect, it } from 'vitest';
import { auditorStartLinks } from './auditor-start';

describe('auditorStartLinks', () => {
  it('links Audit outputs, the SoA, the Evidence library and the activity log, in that order', () => {
    const links = auditorStartLinks('acme', []);
    expect(links.map((l) => [l.label, l.href])).toEqual([
      ['Audit outputs', '/acme/audit'],
      ['Statement of applicability', '/acme/audit#audit-soa'],
      ['Evidence library', '/acme/evidence'],
      ['Activity log', '/acme/audit#audit-pack'],
    ]);
  });

  it('opens the one adopted library’s SoA directly', () => {
    const soa = auditorStartLinks('acme', [{ sheetId: 's1', name: 'ISO 27001 requirements' }])[1]!;
    expect(soa.href).toBe('/acme/audit/soa/s1');
    expect(soa.description).toMatch(/^ISO 27001 requirements: /);
  });

  it('lists several libraries on Audit outputs', () => {
    const soa = auditorStartLinks('acme', [
      { sheetId: 's1', name: 'A' },
      { sheetId: 's2', name: 'B' },
    ])[1]!;
    expect(soa.href).toBe('/acme/audit#audit-soa');
    expect(soa.description).toContain('2 adopted frameworks');
  });
});

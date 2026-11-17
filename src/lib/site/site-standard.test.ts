import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import { standardInstall } from '@/engine/packs/site-standard';

const packs = repoPacks();
const iso9001 = standardInstall(
  packs.find((p) => p.key === 'iso-9001')!,
  packs,
);

describe('what a standard installs, for its page on the site', () => {
  it('lists the standard’s own sheets with the level that adds them', () => {
    expect(iso9001.title).toBe('ISO 9001 quality');
    expect(iso9001.levels.map((l) => l.name)).toEqual(['Recommended', 'Everything']);
    expect(iso9001.sheets.map((s) => s.name)).toEqual([
      'Processes',
      'Customer feedback and complaints',
      'External providers',
      'Measuring equipment',
      'Release records',
      'Design and development',
    ]);
    expect(iso9001.sheets.find((s) => s.name === 'Processes')?.level).toBeNull();
    expect(iso9001.sheets.find((s) => s.name === 'Measuring equipment')?.level).toBe('Everything');
  });

  it('names the shared registers it adds columns, forms or automations to, by their names', () => {
    const names = iso9001.registers.map((r) => r.name);
    expect(names).toContain('Nonconformities and CAPA');
    expect(names).toContain('Risk register');
    const nc = iso9001.registers.find((r) => r.name === 'Nonconformities and CAPA')!;
    expect(nc.columns).toBeGreaterThan(0);
    expect(nc.forms).toEqual(['Report a quality problem']);
  });

  it('collects forms, approval workflows, automations, dashboards and the setup checklist', () => {
    expect(iso9001.forms).toContain('Report a complaint');
    expect(iso9001.forms).toContain('Report a quality problem');
    expect(iso9001.workflows.map((w) => w.name)).toContain('Provider approval');
    expect(iso9001.workflows.find((w) => w.name === 'Provider approval')?.steps).toEqual([
      'Owner evaluation',
      'Quality approval',
    ]);
    expect(iso9001.automations).toContain('Calibration due in 30 days → tell the owner');
    expect(iso9001.automations.length).toBeGreaterThan(10);
    expect(iso9001.dashboards).toEqual(['ISO 9001 audit readiness']);
    expect(iso9001.setup?.steps[0]).toBe('Decide what applies');
  });

  it('uses the words people read, never the pack vocabulary', () => {
    const text = JSON.stringify(iso9001);
    expect(text).not.toMatch(/\bStarter\b|\bFoundations\b|Core registers|\(add-on\)/);
  });
});

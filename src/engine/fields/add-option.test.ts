import { describe, expect, it } from 'vitest';
import { classification } from './classification';
import { dropdown } from './dropdown';
import { finding } from './finding';
import { COLORS } from './helpers';
import { multiselect } from './multiselect';
import { FIELD_TYPE_IDS, fieldType } from './registry';
import { severity } from './severity';
import { status } from './status';
import { workflowstep } from './workflowstep';

const ids = () => {
  let n = 0;
  return (prefix: string) => `${prefix}${(++n).toString(36).padStart(3, '0')}`;
};

describe('addOption', () => {
  it.each([status, dropdown, severity, classification, multiselect])(
    '%s adds a trimmed option with an unused colour and a fresh id',
    (def) => {
      const cfg = def.defaultConfig() as { options: { id: string; color: string }[] };
      const r = def.addOption!(cfg as never, '  Hardware  ', ids())!;
      expect(r.option.label).toBe('Hardware');
      expect(r.option.id).toBe('opt_001');
      expect(cfg.options.map((o) => o.color)).not.toContain(r.option.color);
      expect(COLORS).toContain(r.option.color as (typeof COLORS)[number]);
      const next = r.config as { options: { id: string }[] };
      expect(next.options.at(-1)).toEqual(r.option);
      expect(next.options).toHaveLength(cfg.options.length + 1);
      // the input config is left as it was
      expect(cfg.options.some((o) => o.id === r.option.id)).toBe(false);
      // the new option is a valid value straight away
      expect(def.configSchema.safeParse(r.config).success).toBe(true);
    },
  );

  it('takes the first colour no option uses, in palette order', () => {
    const cfg = { options: [{ id: 'opt_a', label: 'A', color: 'grey' }] };
    expect(dropdown.addOption!(cfg, 'B', ids())!.option.color).toBe(COLORS[1]);
  });

  it('cycles the palette once every colour is used', () => {
    const cfg = {
      options: COLORS.map((color, i) => ({ id: `opt_${i}`, label: `L${i}`, color })),
    };
    const r = multiselect.addOption!(cfg, 'One more', ids())!;
    expect(r.option.color).toBe(COLORS[COLORS.length % COLORS.length]);
  });

  it('refuses a label that is already an option, ignoring case and spaces', () => {
    const cfg = dropdown.defaultConfig();
    expect(dropdown.addOption!(cfg, 'option 1', ids())).toBeNull();
    expect(dropdown.addOption!(cfg, ' OPTION 2 ', ids())).toBeNull();
    expect(multiselect.addOption!(multiselect.defaultConfig(), 'Option 3', ids())).toBeNull();
  });

  it('refuses empty and over-long labels', () => {
    const cfg = status.defaultConfig();
    expect(status.addOption!(cfg, '   ', ids())).toBeNull();
    expect(status.addOption!(cfg, 'x'.repeat(81), ids())).toBeNull();
    expect(status.addOption!(cfg, 'x'.repeat(80), ids())).not.toBeNull();
  });

  it('never reuses an option id', () => {
    const cfg = { options: [{ id: 'opt_001', label: 'Taken', color: 'blue' }] };
    expect(dropdown.addOption!(cfg, 'New', ids())!.option.id).toBe('opt_002');
  });

  it('fixed lists and lists only automations set have no hook', () => {
    expect(finding.addOption).toBeUndefined();
    expect(workflowstep.addOption).toBeUndefined();
    const withHook = FIELD_TYPE_IDS.filter((id) => !!fieldType(id)!.addOption).sort();
    expect(withHook).toEqual(
      ['classification', 'dropdown', 'multiselect', 'severity', 'status'].sort(),
    );
  });
});

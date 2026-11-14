// Pack settings (docs/11 Pack settings): choices a workspace makes for a pack, at install or later on Workspace admin ›
// Packs, that set defaults in the pack's own sheets. The choices are data shipped with the pack (e.g. NIS2's country
// rules: one choice per EU/EEA country with its competent authority, CSIRT and registration route); a field default or
// an example value names a choice's value with the token `$setting:<setting key>.<value key>`. Pure.
import type { Json } from '../types';
import type { PackManifest, PackSetting, PackSettingChoice } from './types';

/** `$setting:country.csirt` */
export const SETTING_TOKEN = /^\$setting:([a-z][a-z0-9_]{0,39})\.([a-z][a-z0-9_]{0,39})$/;

/** The workspace's choices: setting key → choice id. */
export type PackSettingValues = Record<string, string>;

const isObj = (v: unknown): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The choice a workspace made for a setting (or the setting's default), if any. */
export function chosen(s: PackSetting, values: PackSettingValues): PackSettingChoice | null {
  const id = values[s.key] ?? s.default;
  return (id && s.choices.find((c) => c.id === id)) || null;
}

/** Only the known settings and choices of a manifest: anything else is dropped. */
export function cleanSettings(m: PackManifest, values: PackSettingValues): PackSettingValues {
  const out: PackSettingValues = {};
  for (const s of m.settings ?? []) {
    const v = values[s.key];
    if (v && s.choices.some((c) => c.id === v)) out[s.key] = v;
  }
  return out;
}

/** What a token stands for with these choices: the choice's value, or undefined (left out). */
function resolve(
  m: PackManifest,
  values: PackSettingValues,
  raw: string,
): { token: true; value: string | undefined } | { token: false } {
  const t = raw.match(SETTING_TOKEN);
  if (!t) return { token: false };
  const s = (m.settings ?? []).find((x) => x.key === t[1]);
  const c = s ? chosen(s, values) : null;
  const v = c?.values[t[2]!];
  return { token: true, value: v && v.trim() ? v : undefined };
}

/**
 * The manifest with every `$setting:` token of its own sheets resolved: field defaults (`config.default`) and example
 * item values. A token whose setting has no choice (or whose choice has no such value) is left out: no default, no
 * value. A manifest without settings is returned as it is.
 */
export function applyPackSettings(m: PackManifest, values: PackSettingValues = {}): PackManifest {
  if (!m.settings?.length && !hasTokens(m)) return m;
  return {
    ...m,
    sheets: m.sheets.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        const cfg = f.config as Record<string, Json> | undefined;
        if (!isObj(cfg) || typeof cfg.default !== 'string') return f;
        const r = resolve(m, values, cfg.default);
        if (!r.token) return f;
        const { default: _drop, ...rest } = cfg;
        void _drop;
        return { ...f, config: r.value === undefined ? rest : { ...rest, default: r.value } };
      }),
      items: s.items.map((i) => {
        let changed = false;
        const next: Record<string, Json> = {};
        for (const [k, v] of Object.entries(i.values ?? {})) {
          if (typeof v === 'string') {
            const r = resolve(m, values, v);
            if (r.token) {
              changed = true;
              if (r.value !== undefined) next[k] = r.value;
              continue;
            }
          }
          next[k] = v as Json;
        }
        return changed ? { ...i, values: next } : i;
      }),
    })),
  };
}

const hasTokens = (m: PackManifest) =>
  m.sheets.some(
    (s) =>
      s.fields.some((f) => {
        const d = (f.config as Record<string, Json> | undefined)?.default;
        return typeof d === 'string' && SETTING_TOKEN.test(d);
      }) ||
      s.items.some((i) =>
        Object.values(i.values ?? {}).some((v) => typeof v === 'string' && SETTING_TOKEN.test(v)),
      ),
  );

/** A field whose default a setting sets: its ref in the install's ref map (`field:<sheet>.<key>`) and the token. */
export interface SettingField {
  ref: string;
  sheetRef: string;
  fieldKey: string;
  fieldName: string;
  sheetName: string;
  setting: string;
  value: string;
}

/** The fields of the pack's own sheets whose default names a setting. */
export function settingFields(m: PackManifest): SettingField[] {
  const out: SettingField[] = [];
  for (const s of m.sheets)
    for (const f of s.fields) {
      const d = (f.config as Record<string, Json> | undefined)?.default;
      const t = typeof d === 'string' ? d.match(SETTING_TOKEN) : null;
      if (t)
        out.push({
          ref: `field:${s.ref}.${f.key}`,
          sheetRef: s.ref,
          fieldKey: f.key,
          fieldName: f.name,
          sheetName: s.name,
          setting: t[1]!,
          value: t[2]!,
        });
    }
  return out;
}

/**
 * The new defaults of an install's setting fields for these choices (field ref → default, null = no default), and
 * the sentences that say what changes ("Report to on NIS2 incident reports: CERT-Bund").
 */
export function settingDefaults(
  m: PackManifest,
  values: PackSettingValues,
): { ref: string; default: string | null; line: string }[] {
  return settingFields(m).map((f) => {
    const s = (m.settings ?? []).find((x) => x.key === f.setting);
    const c = s ? chosen(s, values) : null;
    const v = c?.values[f.value]?.trim() || null;
    return {
      ref: f.ref,
      default: v,
      line: `${f.fieldName} on ${f.sheetName}: ${v ?? 'no default'}`,
    };
  });
}

/** Problems with a manifest's settings (manifest.ts reports them). */
export function settingProblems(m: PackManifest): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const settings = m.settings ?? [];
  const keys = new Set<string>();
  for (const [si, s] of settings.entries()) {
    if (keys.has(s.key))
      out.push({ path: ['settings', si], message: `Duplicate setting "${s.key}".` });
    keys.add(s.key);
    const ids = new Set<string>();
    const valueKeys = new Set(s.values.map((v) => v.key));
    for (const [ci, c] of s.choices.entries()) {
      if (ids.has(c.id))
        out.push({ path: ['settings', si, 'choices', ci], message: `Duplicate choice "${c.id}".` });
      ids.add(c.id);
      for (const k of Object.keys(c.values))
        if (!valueKeys.has(k))
          out.push({
            path: ['settings', si, 'choices', ci, 'values'],
            message: `"${k}" is not one of the setting's values.`,
          });
    }
    if (s.default && !ids.has(s.default))
      out.push({ path: ['settings', si, 'default'], message: `Unknown choice "${s.default}".` });
  }
  const known = (setting: string, value: string) =>
    settings.some((s) => s.key === setting && s.values.some((v) => v.key === value));
  for (const [si, s] of m.sheets.entries()) {
    for (const [fi, f] of s.fields.entries()) {
      const d = (f.config as Record<string, Json> | undefined)?.default;
      const t = typeof d === 'string' ? d.match(SETTING_TOKEN) : null;
      if (t && !known(t[1]!, t[2]!))
        out.push({
          path: ['sheets', si, 'fields', fi, 'config', 'default'],
          message: `"${d}" names no setting value of the pack.`,
        });
      if (t && !TEXT_TYPES.has(f.type))
        out.push({
          path: ['sheets', si, 'fields', fi, 'config', 'default'],
          message: 'A setting can only set the default of a text field.',
        });
    }
    for (const [ii, i] of s.items.entries())
      for (const [k, v] of Object.entries(i.values ?? {})) {
        const t = typeof v === 'string' ? v.match(SETTING_TOKEN) : null;
        if (t && !known(t[1]!, t[2]!))
          out.push({
            path: ['sheets', si, 'items', ii, 'values', k],
            message: `"${v}" names no setting value of the pack.`,
          });
      }
  }
  // a token anywhere else (extends, automations) is not resolved: say so
  const elsewhere = JSON.stringify({ extends: m.extends ?? [], automations: m.automations });
  if (/\$setting:/.test(elsewhere))
    out.push({
      path: ['extends'],
      message: 'Settings set defaults and example values on the pack’s own sheets only.',
    });
  return out;
}

const TEXT_TYPES = new Set(['text', 'longtext']);

/** The choices of a setting, grouped (EU member states, then EEA countries) in the manifest's order. */
export function choiceGroups(s: PackSetting): { group: string; choices: PackSettingChoice[] }[] {
  const out: { group: string; choices: PackSettingChoice[] }[] = [];
  for (const c of s.choices) {
    const g = c.group ?? '';
    const at = out.find((x) => x.group === g);
    if (at) at.choices.push(c);
    else out.push({ group: g, choices: [c] });
  }
  return out;
}

/** "Country: Norway" for each setting chosen, in the manifest's order. */
export function settingsSummary(m: PackManifest, values: PackSettingValues): string[] {
  return (m.settings ?? []).flatMap((s) => {
    const c = chosen(s, values);
    return c ? [`${s.label}: ${c.label}`] : [];
  });
}

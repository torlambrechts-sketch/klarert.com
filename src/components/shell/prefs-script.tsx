import { PREFS_SCRIPT } from './prefs-keys';

/** Applies the remembered rail and panel widths before the first paint (no layout shift). */
export function ShellPrefsScript() {
  return <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />;
}

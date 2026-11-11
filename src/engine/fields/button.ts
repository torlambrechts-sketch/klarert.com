import { z } from 'zod';
import { base } from './helpers';
import type { FieldTypeDef } from './types';

export interface ButtonConfig {
  label: string;
  /** Question shown before running; null runs straight away. */
  confirm: string | null;
}

// A button holds no value: a click emits the button_clicked trigger (docs/04 §3).
export const button: FieldTypeDef<null, ButtonConfig> = base<null, ButtonConfig>({
  id: 'button',
  label: 'Button',
  family: 'computed',
  description: 'A button on each item that runs an automation when clicked.',
  storage: 'none',
  kind: 'none',
  valueSchema: z.null(),
  configSchema: z.object({ label: z.string().trim().min(1).max(40), confirm: z.string().trim().min(1).max(200).nullable() }),
  defaultConfig: () => ({ label: 'Run', confirm: null }),
  defaultWidth: 140,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['button_clicked'],
  normalize: () => null,
  parseText: () => null,
  isEmpty: () => true,
  toText: () => '',
  compare: () => 0,
});

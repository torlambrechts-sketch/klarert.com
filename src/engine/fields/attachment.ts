import { z } from 'zod';
import { fileType } from './evidence';

export interface AttachmentConfig {
  multiple: boolean;
  accept: string[];
}

export const attachment = fileType<AttachmentConfig>({
  id: 'attachment',
  label: 'Attachment',
  description: 'Files attached to the item, with no expiry.',
  defaultWidth: 120,
  expiry: false,
  configSchema: z.object({ multiple: z.boolean(), accept: z.array(z.string()) }),
  defaultConfig: () => ({ multiple: true, accept: [] }),
});

import {
  ClipboardCheck,
  FileText,
  FolderKanban,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AppIcon as AppIconId } from '@/engine/apps/types';

// The icons an app manifest may name (APP_ICONS), as lucide components.
const ICONS: Record<AppIconId, LucideIcon> = {
  'shield-alert': ShieldAlert,
  'clipboard-check': ClipboardCheck,
  wrench: Wrench,
  'triangle-alert': TriangleAlert,
  'list-checks': ListChecks,
  'folder-kanban': FolderKanban,
  'shield-check': ShieldCheck,
  'file-text': FileText,
};

export function AppIcon({ icon, className }: { icon: AppIconId; className?: string }) {
  const Icon = ICONS[icon] ?? FolderKanban;
  return <Icon className={className} aria-hidden />;
}

/** An app in the side menu: its link opens the first screen the person may see. */
export type MenuApp = { key: string; title: string; icon: AppIconId; screen: string };

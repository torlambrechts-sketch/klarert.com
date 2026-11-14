import { AlertTriangle, Clock } from 'lucide-react';
import type { EditionBadge as Badge } from '@/engine/frameworks/status';

// The edition status of a framework (docs/12 Standards watch): "Withdrawn · replaced by ISO 14001:2026 · transition
// ends Apr 2029" or "Revision in progress (DIS) · expected 2027". The words come from the engine; a symbol says the
// same as the colour.
export function EditionBadge({ badge }: { badge: Badge | null }) {
  if (!badge) return null;
  const replaced = badge.tone === 'replaced';
  const Icon = replaced ? AlertTriangle : Clock;
  return (
    <span
      data-testid="edition-badge"
      className={`text-label-12 inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 ${
        replaced ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info'
      }`}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0">{badge.text}</span>
    </span>
  );
}

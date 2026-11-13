import { MessageSquare } from 'lucide-react';
import type { Ctx } from '@/engine/types';
import { cn } from '@/lib/utils';
import type { UpdateSummary } from './use-update-counts';

// The comment marker on a row or card (docs/05 §3.1): a speech-bubble icon and the number of comments, read as
// "3 comments"; its tooltip quotes the latest comment's first line and names its author.

export const commentsLabel = (n: number) => `${n} ${n === 1 ? 'comment' : 'comments'}`;

export function commentTooltip(s: UpdateSummary, ctx: Ctx): string {
  const label = commentsLabel(s.count);
  const line = s.lastBody
    ?.split('\n')
    .find((l) => l.trim())
    ?.trim();
  if (!line) return label;
  const who = s.lastAuthor ? ctx.people.get(s.lastAuthor)?.name : undefined;
  const quote = line.length > 80 ? `${line.slice(0, 79)}…` : line;
  return `${label}. Latest${who ? ` from ${who}` : ''}: “${quote}”`;
}

export function CommentBubble({
  summary,
  ctx,
  className,
}: {
  summary: UpdateSummary | undefined;
  ctx: Ctx;
  className?: string;
}) {
  if (!summary || summary.count <= 0) return null;
  return (
    <span
      data-comments={summary.count}
      title={commentTooltip(summary, ctx)}
      className={cn(
        'text-ink bg-background-100 text-label-11-mono border-gray-alpha-500 inline-flex h-[22px] min-w-[28px] shrink-0 items-center justify-center gap-[3px] rounded-full border px-1.5 font-semibold',
        className,
      )}
    >
      <MessageSquare className="size-3 shrink-0" aria-hidden />
      <span aria-hidden>{summary.count}</span>
      <span className="sr-only">{commentsLabel(summary.count)}</span>
    </span>
  );
}

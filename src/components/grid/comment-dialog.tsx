'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { inputClass } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

/**
 * Comment on value (docs/03 §6): a status rule asks for a comment before the change is saved. The comment is posted
 * as an update on the item and copied into the activity log entry.
 */
export function CommentDialog({
  open,
  message,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  message: string;
  onSubmit(note: string): Promise<void> | void;
  onCancel(): void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    await onSubmit(note.trim());
    setBusy(false);
    setNote('');
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogTitle className="text-heading-16">Add a comment</DialogTitle>
        <DialogDescription className="text-muted-foreground text-label-13">
          {message}
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={id} className="text-label-13 font-semibold">
            Comment
          </label>
          <textarea
            id={id}
            autoFocus
            rows={4}
            maxLength={10000}
            className={cn(inputClass, 'h-auto py-1.5')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <p className="text-muted-foreground text-label-12">
            It is posted as an update on the item and kept in the activity log.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !note.trim()}>
              Save with comment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

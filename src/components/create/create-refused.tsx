'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

// Create is for editors, admins and owners (owner decision 15 Nov 2026): viewers and auditors have no Create button
// and Ctrl/Cmd+K does nothing for them. If they reach Create anyway, it says so and leads back to Home.

export const CREATE_REFUSED =
  'Only editors, admins and owners can create sheets, automations, forms and dashboards. Ask one of them to create what you need.';

export function CreateRefusedDialog({ org, onClose }: { org: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent data-testid="create-refused">
        <DialogTitle className="text-heading-20 pr-8">Create</DialogTitle>
        <DialogDescription className="text-copy-14 text-muted-foreground m-0">
          {CREATE_REFUSED}
        </DialogDescription>
        <div>
          <Button asChild variant="outline">
            <Link href={`/${org}/home`} onClick={onClose}>
              Back to Home
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

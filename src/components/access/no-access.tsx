import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** A restricted sheet the person cannot open (docs/02 §16): its name, and who to ask. Nothing of its content. */
export function NoAccess({ org, name }: { org: string; name: string }) {
  return (
    <main className="flex w-full flex-col items-start gap-3 px-4 pt-8 pb-8 sm:px-[28px]">
      <span className="bg-soft text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Lock className="size-5" aria-hidden />
      </span>
      <h1 className="m-0">{name}</h1>
      <p className="text-muted-foreground m-0 max-w-[60ch]">
        This sheet is restricted. Only the people listed on it and the workspace owners can open it.
        Ask an owner, or an admin who has access, to add you.
      </p>
      <Button asChild variant="outline">
        <Link href={`/${org}/home`}>Back to Home</Link>
      </Button>
    </main>
  );
}

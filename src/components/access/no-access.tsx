import Link from 'next/link';
import { Lock } from 'lucide-react';
import { HeadCard, PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';

/** A restricted sheet the person cannot open (docs/02 §16): its name, and who to ask. Nothing of its content. */
export function NoAccess({ org, name }: { org: string; name: string }) {
  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
      <PageHeader title={name} />
      <HeadCard className="items-start">
        <span className="bg-brand-soft text-navy flex size-10 items-center justify-center rounded-full">
          <Lock className="size-5" aria-hidden />
        </span>
        <p className="text-muted-foreground m-0 max-w-[60ch]">
          This sheet is restricted. Only the people listed on it and the workspace owners can open
          it. Ask an owner, or an admin who has access, to add you.
        </p>
        <Button asChild variant="outline">
          <Link href={`/${org}/home`}>Back to Home</Link>
        </Button>
      </HeadCard>
    </main>
  );
}

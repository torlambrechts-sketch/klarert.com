import Link from 'next/link';
import { HeadCard, PageHeader } from '@/components/shell/page-header';

export default function SheetNotFound() {
  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
      <PageHeader title="Sheet not found" />
      <HeadCard>
        <p className="text-muted-foreground m-0">
          It may have been deleted, or the link is wrong.{' '}
          <Link href=".." className="text-info underline">
            Go back
          </Link>
        </p>
      </HeadCard>
    </main>
  );
}

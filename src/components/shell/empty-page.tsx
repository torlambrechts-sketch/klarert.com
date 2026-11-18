import { HeadCard, PageHeader } from './page-header';

/** A page whose content is not built yet: the heading and an honest empty state, no controls. */
export function EmptyPage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-12 sm:pt-[26px]">
      <PageHeader title={title} />
      <HeadCard>
        <p className="text-muted-foreground m-0">{message}</p>
      </HeadCard>
    </main>
  );
}

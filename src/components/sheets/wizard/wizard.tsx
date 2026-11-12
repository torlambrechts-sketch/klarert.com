import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STARTS, startById } from '@/lib/starts';
import type { WizardContext } from './basics';
import { ColumnsStart } from './columns-start';
import { CopyStart } from './copy-start';
import { CsvStart } from './csv-start';

/** New sheet wizard (docs/05 §4): step 1 choose a start, step 2 the details. The start is in the URL. */
export function NewSheetWizard({ ctx, startId }: { ctx: WizardContext; startId: string | null }) {
  const start = startId ? startById(startId) : undefined;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="wizard-step-1" className="flex flex-col gap-3">
        <h2 id="wizard-step-1" className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="bg-brand text-primary-foreground flex size-6 items-center justify-center rounded-full font-mono text-xs">
            1
          </span>
          Start from
        </h2>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STARTS.map((s) => {
            const selected = s.id === start?.id;
            return (
              <li key={s.id}>
                <Link
                  href={`?start=${s.id}`}
                  scroll={false}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'flex h-full flex-col gap-1.5 rounded-xl border bg-white px-4 py-3.5 shadow-xs',
                    selected ? 'border-brand ring-brand ring-1' : 'border-line hover:border-faint',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                    {selected ? <Check className="size-4" aria-hidden /> : null}
                    {s.title}
                  </span>
                  <span className="text-muted-foreground text-[13px] leading-snug">
                    {s.description}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      {start ? (
        <section
          aria-labelledby="wizard-step-2"
          className="border-line flex flex-col gap-4 rounded-xl border bg-white p-5 shadow-xs sm:px-[22px]"
        >
          <h2 id="wizard-step-2" className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="bg-brand text-primary-foreground flex size-6 items-center justify-center rounded-full font-mono text-xs">
              2
            </span>
            {start.title}
          </h2>
          {start.id === 'csv' ? (
            <CsvStart key="csv" ctx={ctx} />
          ) : start.id === 'copy' ? (
            <CopyStart key="copy" ctx={ctx} />
          ) : (
            <ColumnsStart
              key={start.id}
              ctx={ctx}
              start={{
                itemLabel: start.itemLabel ?? 'Item',
                groups: start.groups ?? [],
                fields: (start.fields ?? []) as [string, string][],
              }}
            />
          )}
        </section>
      ) : (
        <p className="text-muted-foreground">Choose a start to continue.</p>
      )}
    </div>
  );
}

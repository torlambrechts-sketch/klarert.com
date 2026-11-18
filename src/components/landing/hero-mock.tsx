// The hero's picture: a browser window with an example Risk register and three floating cards built from real
// product concepts (the activity log's chain check, an automation run, the statement of applicability). Static HTML
// and CSS in the app's tokens, hidden from assistive technology: the hero's words say what it shows. Clearly an
// example ("Example workspace"), never customer data. The statement card's total is the catalogue's own count.
import { Check } from 'lucide-react';
import { RiskRows } from './illustrations';
import { Bar, BrowserFrame, Dot, Panel, Tag } from './mock-kit';

const IMPLEMENTED = 61;

export function HeroMock({ soa }: { soa: { title: string; controls: number } | null }) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-xl select-none lg:pt-6 lg:pb-16"
    >
      <BrowserFrame address="Example workspace · Risk register">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <span className="text-card-title">Risk register</span>
          <Dot tone="good">Live</Dot>
        </div>
        <div className="border-line border-t">
          <RiskRows />
          <div className="border-line flex items-center gap-2 border-t px-3 py-2">
            <span className="text-muted-foreground text-12 w-11 shrink-0 font-mono">R-004</span>
            <span className="text-13 min-w-0 flex-1 truncate">Backups not tested</span>
            <Tag tint="grey">Not started</Tag>
          </div>
        </div>
        <div className="hidden h-28 lg:block" />
      </BrowserFrame>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:contents">
        <Panel
          float
          className="flex flex-col gap-2 p-3 lg:absolute lg:top-0 lg:-right-4 lg:w-64 lg:rotate-2"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-13 font-semibold">Activity log</span>
            <Dot tone="good">✓ Chain intact</Dot>
          </span>
          <span className="text-12 flex items-center justify-between gap-2">
            <span className="truncate">Status · In treatment → Done</span>
          </span>
          <span className="text-muted-foreground text-12 font-mono">sha256 3f9a…c21e</span>
        </Panel>

        <Panel
          float
          className="flex flex-col gap-2 p-3 lg:absolute lg:bottom-4 lg:-left-6 lg:w-64 lg:-rotate-2"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-13 font-semibold">Automation run</span>
            <Tag tint="green" mark="✓">
              Done
            </Tag>
          </span>
          <span className="text-muted-foreground text-12">3 steps</span>
          {['Notify the owner', 'Create an item in Actions', 'Post an update'].map((s) => (
            <span key={s} className="text-12 flex items-center gap-1.5">
              <Check className="text-good size-3.5 shrink-0" />
              {s}
            </span>
          ))}
        </Panel>

        {soa ? (
          <Panel
            float
            className="hidden flex-col gap-2 p-3 sm:col-span-2 sm:flex lg:absolute lg:right-2 lg:bottom-0 lg:w-60 lg:rotate-1"
          >
            <span className="text-13 font-semibold">Statement of applicability</span>
            <span className="text-muted-foreground text-12">{soa.title}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-kpi">
                {IMPLEMENTED}
                <span className="text-muted-foreground text-13 font-normal">
                  {' '}
                  of {soa.controls}
                </span>
              </span>
              <span className="text-12">implemented</span>
            </span>
            <Bar percent={Math.round((IMPLEMENTED / soa.controls) * 100)} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

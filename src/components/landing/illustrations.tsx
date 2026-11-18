// The public site's illustrations, keyed by the feature or problem they show (content.ts keys). Each is a small,
// static picture of real product concepts built from mock-kit.tsx, hidden from assistive technology by its Stage.
// Names and dates are examples, never customer data.
import {
  FileText,
  Fingerprint,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Paperclip,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Dot, Initials, Panel, Stage, Tag } from './mock-kit';

const row = 'border-line flex items-center gap-2 border-b px-3 py-2 last:border-b-0';
const mono = 'text-muted-foreground font-mono text-12';
const small = 'text-12';

// ── the problem ──

function Scattered() {
  const files = [
    { name: 'risks_2025_final.xlsx', status: 'Open', rotate: '-rotate-3' },
    { name: 'risks_ISO9001.xlsx', status: 'Closed', rotate: 'rotate-2' },
    { name: 'risks (copy).xlsx', status: 'In review', rotate: '-rotate-1' },
  ];
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      {files.map((f) => (
        <Panel key={f.name} float className={`${f.rotate} flex flex-col gap-1 px-3 py-2`}>
          <span className={mono}>{f.name}</span>
          <span className={`${small} flex items-center justify-between gap-2`}>
            <span className="truncate">Supplier outage</span>
            <span className="text-muted-foreground">{f.status}</span>
          </span>
        </Panel>
      ))}
    </div>
  );
}

function Inbox() {
  const mails = [
    'RE: certificate for the audit',
    'Fwd: pen test report v2',
    'Fwd: Fwd: policy (final)',
  ];
  return (
    <Panel className="w-full max-w-sm">
      {mails.map((m) => (
        <div key={m} className={row}>
          <Mail className="text-faint size-3.5 shrink-0" />
          <span className={`${small} min-w-0 flex-1 truncate`}>{m}</span>
          <Paperclip className="text-faint size-3.5 shrink-0" />
        </div>
      ))}
      <div className="bg-subtle text-muted-foreground text-12 rounded-b-lg px-3 py-2">
        Which one is current? When does it expire?
      </div>
    </Panel>
  );
}

function AuditRebuild() {
  return (
    <Panel className="flex w-full max-w-sm flex-col gap-2 p-3">
      <span className="flex items-center justify-between">
        <span className="text-13 font-semibold">Before the audit</span>
        <Dot tone="warn">2 weeks left</Dot>
      </span>
      {[
        'Find who approved the policy',
        'Collect last year’s evidence',
        'Rebuild the change history',
      ].map((t) => (
        <span key={t} className={`${small} flex items-center gap-2`}>
          <span className="border-line-strong size-3.5 shrink-0 rounded-sm border" />
          {t}
        </span>
      ))}
    </Panel>
  );
}

// ── the platform ──

const RISKS = [
  {
    id: 'R-001',
    name: 'Laptop lost or stolen',
    who: 'AL',
    tag: (
      <Tag tint="green" mark="✓">
        Done
      </Tag>
    ),
  },
  { id: 'R-002', name: 'Supplier outage', who: 'GH', tag: <Tag tint="blue">In treatment</Tag> },
  {
    id: 'R-003',
    name: 'Phishing email',
    who: 'MK',
    tag: (
      <Tag tint="red" mark="!">
        Needs review
      </Tag>
    ),
  },
];

export function RiskRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {RISKS.slice(0, count).map((r) => (
        <div key={r.id} className={row}>
          <span className={`${mono} w-11 shrink-0`}>{r.id}</span>
          <span className="text-13 min-w-0 flex-1 truncate">{r.name}</span>
          <span className="hidden sm:block">
            <Initials>{r.who}</Initials>
          </span>
          {r.tag}
        </div>
      ))}
    </>
  );
}

function Sheets() {
  const types = ['Status', 'People', 'Date', 'Evidence', 'Formula', 'Link'];
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Panel>
        <div className="border-line flex items-center justify-between border-b px-3 py-2">
          <span className="text-13 font-semibold whitespace-nowrap">Risk register</span>
          <span className="flex gap-1">
            {['Table', 'Board', 'Calendar'].map((v, i) => (
              <span
                key={v}
                className={`text-12 rounded-md px-1.5 py-0.5 ${i === 0 ? 'bg-soft text-ink font-medium' : 'text-muted-foreground'}`}
              >
                {v}
              </span>
            ))}
          </span>
        </div>
        <RiskRows />
      </Panel>
      <div className="flex flex-wrap justify-center gap-1.5">
        {types.map((t) => (
          <span key={t} className="bg-surface border-line text-12 rounded-full border px-2 py-0.5">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Forms() {
  return (
    <div className="flex w-full max-w-md items-center gap-3">
      <Panel float className="flex flex-1 flex-col gap-2 p-3">
        <span className="text-13 font-semibold">Report an incident</span>
        {['What happened?', 'When?'].map((q) => (
          <span key={q} className="flex flex-col gap-1">
            <span className={small}>{q}</span>
            <span className="border-line h-6 rounded-md border" />
          </span>
        ))}
        <span className="bg-brand text-primary-foreground text-12 self-start rounded-md px-2 py-1 font-medium">
          Send
        </span>
      </Panel>
      <Panel className="hidden flex-col items-center gap-2 p-3 sm:flex">
        <QrCode className="text-ink size-10" />
        <Dot tone="good">Open</Dot>
        <span className={mono}>Public</span>
      </Panel>
    </div>
  );
}

function Automations() {
  const part = (label: string, text: string) => (
    <span className="flex items-baseline gap-2">
      <span className="text-muted-foreground text-12 w-9 shrink-0 font-mono uppercase">
        {label}
      </span>
      <span className="bg-surface border-line text-12 rounded-md border px-2 py-1">{text}</span>
    </span>
  );
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Panel className="flex flex-col gap-2 p-3">
        {part('When', 'Status changes to Done')}
        {part('If', 'Severity is High')}
        {part('Then', 'Create an item in Actions')}
      </Panel>
      <Panel float className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-12 font-medium">Run log · 3 steps</span>
        <Tag tint="green" mark="✓">
          Done
        </Tag>
      </Panel>
    </div>
  );
}

function Approvals() {
  const steps = [
    {
      who: 'Owner review',
      state: (
        <Tag tint="green" mark="✓">
          Approved
        </Tag>
      ),
    },
    {
      who: 'Top management',
      state: (
        <Tag tint="yellow" mark="!">
          Waiting
        </Tag>
      ),
    },
  ];
  return (
    <Panel className="w-full max-w-md">
      <div className="border-line flex items-center justify-between border-b px-3 py-2">
        <span className="text-13 font-semibold">Document approval</span>
        <span className={mono}>2 steps</span>
      </div>
      {steps.map((s, i) => (
        <div key={s.who} className={row}>
          <span className="bg-soft text-12 flex size-5 items-center justify-center rounded-full font-semibold">
            {i + 1}
          </span>
          <span className="text-13 flex-1">{s.who}</span>
          {s.state}
        </div>
      ))}
      <div className="text-muted-foreground text-12 flex items-center gap-1.5 px-3 py-2">
        <Lock className="size-3.5" /> Locked when approved
      </div>
    </Panel>
  );
}

function Activity() {
  const entries = [
    { what: 'Status · In treatment → Done', hash: '3f9a…c21e' },
    { what: 'Owner · AL → GH', hash: '8b02…f417' },
    { what: 'Item created', hash: 'd51c…09ab' },
  ];
  return (
    <Panel className="w-full max-w-md">
      <div className="border-line flex items-center justify-between border-b px-3 py-2">
        <span className="text-13 font-semibold">Activity log</span>
        <Dot tone="good">✓ Chain intact</Dot>
      </div>
      {entries.map((e) => (
        <div key={e.hash} className={row}>
          <span className="bg-faint size-1.5 shrink-0 rounded-full" />
          <span className="text-12 min-w-0 flex-1 truncate">{e.what}</span>
          <span className={mono}>{e.hash}</span>
        </div>
      ))}
    </Panel>
  );
}

function Soa() {
  const rows = [
    {
      ref: 'A.5.1',
      yes: true,
      tag: (
        <Tag tint="green" mark="✓">
          Implemented
        </Tag>
      ),
    },
    { ref: 'A.5.7', yes: true, tag: <Tag tint="blue">Partially</Tag> },
    { ref: 'A.7.5', yes: false, tag: <Tag tint="grey">Not applicable</Tag> },
  ];
  return (
    <Panel className="w-full max-w-md">
      <div className="border-line flex items-center justify-between border-b px-3 py-2">
        <span className="text-13 font-semibold whitespace-nowrap">Statement of applicability</span>
        <span className={mono}>Export</span>
      </div>
      {rows.map((r) => (
        <div key={r.ref} className={row}>
          <span className={`${mono} w-11`}>{r.ref}</span>
          <span className="text-12 text-muted-foreground flex-1 whitespace-nowrap">
            Applicable: {r.yes ? 'Yes' : 'No'}
          </span>
          {r.tag}
        </div>
      ))}
    </Panel>
  );
}

function Evidence() {
  const files = [
    {
      name: 'Pen test report.pdf',
      until: 'Valid until 11 Nov 2027',
      tag: (
        <Tag tint="green" mark="✓">
          Current
        </Tag>
      ),
    },
    {
      name: 'Insurance certificate.pdf',
      until: 'Valid until 28 Nov 2026',
      tag: (
        <Tag tint="yellow" mark="!">
          Expiring
        </Tag>
      ),
    },
  ];
  return (
    <Panel className="w-full max-w-md">
      {files.map((f) => (
        <div key={f.name} className={`${row} items-start`}>
          <FileText className="text-faint mt-0.5 size-4 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-13 truncate">{f.name}</span>
            <span className="text-muted-foreground text-12 whitespace-nowrap">{f.until}</span>
            <span className={mono}>sha256 3f9a…c21e · v2</span>
          </span>
          {f.tag}
        </div>
      ))}
    </Panel>
  );
}

function Retention() {
  return (
    <Panel className="w-full max-w-md">
      <div className="border-line flex items-center justify-between border-b px-3 py-2">
        <span className="text-13 font-semibold">Retention review</span>
        <span className={mono}>2 due</span>
      </div>
      {['DSR-014 · closed 2 years ago', 'DSR-019 · closed 2 years ago'].map((t, i) => (
        <div key={t} className={row}>
          <span className="text-12 min-w-0 flex-1 truncate">{t}</span>
          {i === 0 ? (
            <Tag tint="grey">Legal hold</Tag>
          ) : (
            <span className="bg-brand text-primary-foreground text-12 rounded-md px-2 py-0.5 font-medium">
              Approve
            </span>
          )}
        </div>
      ))}
      <div className="text-muted-foreground text-12 px-3 py-2">
        Erased values show as erased; the chain stays intact
      </div>
    </Panel>
  );
}

function Roles() {
  const people = [
    { who: 'AL', role: 'Owner', note: '' },
    { who: 'GH', role: 'Editor', note: '' },
    { who: 'MK', role: 'Auditor', note: 'until 31 Mar 2027' },
  ];
  return (
    <Panel className="w-full max-w-md">
      {people.map((p) => (
        <div key={p.who} className={row}>
          <Initials>{p.who}</Initials>
          <span className="text-13 flex-1">{p.role}</span>
          {p.note ? <span className="text-muted-foreground text-12">{p.note}</span> : null}
        </div>
      ))}
      <div className="text-muted-foreground text-12 flex items-center gap-1.5 px-3 py-2">
        <Lock className="size-3.5" /> Salary band · Restricted
      </div>
    </Panel>
  );
}

function Security() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Panel float className="flex items-center gap-3 p-3">
        <Smartphone className="text-ink size-6 shrink-0" />
        <span className="flex flex-1 flex-col gap-1">
          <span className="text-13 font-semibold">Two-step sign-in</span>
          <span className="text-14 font-mono tracking-widest">482 •••</span>
        </span>
        <KeyRound className="text-faint size-4" />
      </Panel>
      <Panel className="flex items-center gap-3 p-3">
        <MapPin className="text-ink size-5 shrink-0" />
        <span className="text-13 flex-1">Frankfurt, EU</span>
        <Dot tone="good">✓ RLS on every table</Dot>
      </Panel>
    </div>
  );
}

function Apps() {
  return (
    <div className="flex w-full max-w-md items-end justify-center gap-3">
      <Panel float className="flex w-40 flex-col gap-1.5 p-2.5">
        <span className="text-12 font-semibold">CAPA</span>
        {['Report a problem', 'My actions', 'Needs my check'].map((s, i) => (
          <span
            key={s}
            className={`text-12 rounded-md px-2 py-1.5 ${i === 1 ? 'bg-soft font-medium' : ''}`}
          >
            {s}
          </span>
        ))}
      </Panel>
      <Panel className="hidden flex-1 sm:block">
        <div className="border-line text-13 border-b px-3 py-2 font-semibold">My actions</div>
        <div className={row}>
          <span className="text-12 flex-1 truncate">Contain the leak</span>
          <Tag tint="red" mark="!">
            Overdue
          </Tag>
        </div>
        <div className={row}>
          <span className="text-12 flex-1 truncate">Check effectiveness</span>
          <Tag tint="blue">Open</Tag>
        </div>
      </Panel>
    </div>
  );
}

function Design() {
  const node = (label: string, strong?: boolean) => (
    <span
      className={`text-12 rounded-full border px-2.5 py-1 font-medium whitespace-nowrap ${strong ? 'bg-brand text-primary-foreground border-transparent' : 'bg-surface border-line'}`}
    >
      {label}
    </span>
  );
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <div className="flex gap-2">
        {node('Public form')}
        {node('Manual entry')}
      </div>
      <span className="bg-line-strong h-4 w-px" />
      {node('Incidents', true)}
      <span className="bg-line-strong h-4 w-px" />
      <div className="flex gap-2">
        {node('Notify Owner')}
        {node('Webhook · leaves the system')}
      </div>
    </div>
  );
}

const ILLUSTRATIONS: Record<string, () => React.ReactNode> = {
  scattered: Scattered,
  inbox: Inbox,
  audit: AuditRebuild,
  sheets: Sheets,
  forms: Forms,
  automations: Automations,
  approvals: Approvals,
  activity: Activity,
  soa: Soa,
  evidence: Evidence,
  retention: Retention,
  roles: Roles,
  security: Security,
  apps: Apps,
  design: Design,
};

/** The illustration for a content key, on its grey stage; nothing when there is none. */
export function Illustration({ name, className }: { name: string; className?: string }) {
  const Picture = ILLUSTRATIONS[name];
  if (!Picture) return null;
  return (
    <Stage className={className}>
      <Picture />
    </Stage>
  );
}

export const TRUST_ICONS = {
  eu: MapPin,
  trail: ShieldCheck,
  'two-step': KeyRound,
  'by-id': Fingerprint,
} as const;

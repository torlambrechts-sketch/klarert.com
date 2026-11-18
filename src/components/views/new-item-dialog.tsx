'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { defaultValues } from '@/engine/writes';
import {
  checkNewItem,
  chosenIntake,
  hasAnswers,
  newItemPlan,
  planQuestions,
  shownQuestions,
  startingAnswers,
  type IntakeForm,
} from '@/engine/views/new-item';
import type { FormQuestion } from '@/engine/views/form';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { byPosition, positionsAtEnd } from '@/components/table/table-model';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';
import { Label, Question } from './form-fill';

// The New item dialog (docs/05 §3.7, owner decision 14 Nov 2026): "+ New" in the sheet header (also
// ?new=1), the N key, a Kanban lane's and a Calendar day's "+ Add". It asks the name, the sheet's required fields
// and the fields marked "Ask when adding", with the rest folded under More fields (Phase A), or the sheet's new-item
// form, a step at a time (Phase B). Which questions, and whether the answers pass, come from the engine
// (src/engine/views/new-item.ts), which the createItem command runs again: one call writes the item, its values and
// one activity entry that says it came from this dialog. Nothing is kept when the dialog closes (no drafts).

export interface NewItemRequest {
  /** What the dialog says it prefills ("Status: Done", "Due date: 12 Nov 2026"). */
  note?: string;
  values?: Record<string, unknown>;
  groupId?: string | null;
}

const OPEN_AFTER_KEY = 'new-item:open-after';

function readOpenAfter(): boolean {
  try {
    return window.localStorage.getItem(OPEN_AFTER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpenAfter(v: boolean) {
  try {
    if (v) window.localStorage.setItem(OPEN_AFTER_KEY, '1');
    else window.localStorage.removeItem(OPEN_AFTER_KEY);
  } catch {
    // private windows: the choice lasts for this dialog only
  }
}

const blank = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function NewItemDialog(props: {
  request: NewItemRequest | null;
  onClose(): void;
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  /** The sheet's forms: its new-item form is asked when the sheet has one that can be used (Phase B). */
  forms?: IntakeForm[];
  /** Where focus goes back when the dialog closes ("+ New"). */
  returnFocus?: React.RefObject<HTMLElement | null>;
  /** Open the item panel on a new item ("Open the item after creating"). */
  onOpenItem?(item: Item): void;
}) {
  return props.request ? <NewItemSession {...props} request={props.request} /> : null;
}

function NewItemSession({
  request,
  onClose,
  data,
  ctx,
  actions,
  forms = [],
  returnFocus,
  onOpenItem,
}: {
  request: NewItemRequest;
  onClose(): void;
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  forms?: IntakeForm[];
  returnFocus?: React.RefObject<HTMLElement | null>;
  onOpenItem?(item: Item): void;
}) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  /** "Create and add another" asked for this submit (Enter always means Create). */
  const anotherRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // the plan is fixed for this dialog: a form closed meanwhile is refused by the server, which says so
  const [plan] = useState(() =>
    newItemPlan(data.fields, chosenIntake(data.sheet.newItemForm, forms), ctx.now),
  );
  const questions = useMemo(() => planQuestions(plan), [plan]);
  const groups = useMemo(
    () => [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1)),
    [data.groups],
  );
  const [start] = useState(() =>
    startingAnswers(questions, defaultValues(data.fields, ctx), request.values),
  );
  // values the view gives for fields the dialog does not ask (a Kanban lane on a form without that question)
  const extra = useMemo(() => {
    const asked = new Set(questions.map((q) => q.field.id));
    return Object.fromEntries(
      Object.entries(request.values ?? {}).filter(([k, v]) => !asked.has(k) && !blank(v)),
    );
  }, [questions, request.values]);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [groupId, setGroupId] = useState(() => {
    const wanted = request.groupId ?? plan.groupId;
    return wanted && groups.some((g) => g.id === wanted) ? wanted : (groups[0]?.id ?? '');
  });
  const [step, setStep] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openAfter, setOpenAfter] = useState(readOpenAfter);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [againTick, setAgainTick] = useState(0);
  useEffect(() => {
    if (againTick > 0) nameRef.current?.focus();
  }, [againTick]);

  const label = data.sheet.itemLabel.toLowerCase();
  const shown = useMemo(
    () => new Set(shownQuestions(questions, answers, ctx).map((q) => q.field.id)),
    [questions, answers, ctx],
  );
  const steps = plan.steps;
  const last = step === steps.length - 1;
  const stepQuestions = steps[step]!.questions.filter((q) => shown.has(q.field.id));
  const more = plan.more.filter((q) => shown.has(q.field.id));

  // after a failed check: open what hides the first problem and put the focus on it
  useEffect(() => {
    if (focusTick === 0) return;
    const form = formRef.current;
    if (!form) return;
    if (errors.__name) {
      nameRef.current?.focus();
      return;
    }
    const order = [...stepQuestions, ...(last ? more : [])];
    const first = order.find((q) => errors[q.field.id]);
    if (!first) return;
    const el = form.querySelector<HTMLElement>(
      `[data-question="${first.field.id}"] input, [data-question="${first.field.id}"] button, [data-question="${first.field.id}"] textarea`,
    );
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const dirty = hasAnswers(name, answers, start);
  const attemptClose = () => {
    if (saving) return;
    if (dirty) setConfirming(true);
    else onClose();
  };

  /** The answers to send: every question shown, blank ones as null (a cleared default stays cleared). */
  const values = () => {
    const out: Record<string, unknown> = { ...extra };
    for (const q of questions) {
      if (!shown.has(q.field.id)) continue;
      const v = answers[q.field.id];
      if (!blank(v)) out[q.field.id] = v;
      else if (!blank(start[q.field.id])) out[q.field.id] = null;
    }
    return out;
  };

  const fail = (errs: Record<string, string>, text?: string) => {
    setErrors(errs);
    const n = Object.keys(errs).length;
    setMessage(text ?? (n === 1 ? '1 answer needs attention.' : `${n} answers need attention.`));
    // a problem under the folded More fields: unfold it
    if (plan.more.some((q) => errs[q.field.id])) setMoreOpen(true);
    // a problem on an earlier step (an answer changed what shows): go back to it
    const at = steps.findIndex((s) => s.questions.some((q) => errs[q.field.id]));
    if (!errs.__name && at >= 0 && at !== step) setStep(at);
    else if (errs.__name && step !== 0) setStep(0);
    setFocusTick((t) => t + 1);
  };

  const check = (qs: FormQuestion[]) => checkNewItem(qs, name, answers, ctx, plan.nameLabel).errors;

  const next = () => {
    const errs = check(stepQuestions);
    if (step > 0) delete errs.__name;
    if (Object.keys(errs).length) return fail(errs);
    setErrors({});
    setMessage(null);
    setStep((s) => s + 1);
  };

  const create = async (another: boolean) => {
    const all = questions.filter((q) => shown.has(q.field.id));
    const errs = check(all);
    if (Object.keys(errs).length) return fail(errs);
    if (!groupId) return fail({}, 'Choose a group.');
    let position: string;
    try {
      const list = data.items.filter((i) => i.groupId === groupId).sort(byPosition);
      position = positionsAtEnd(list, 1)[0]!;
    } catch {
      return fail({}, 'The order of this group needs repair. Reload the sheet and try again.');
    }
    setSaving(true);
    setMessage(null);
    let refused: { message: string; fieldErrors?: Record<string, string> } | null = null;
    const item = await actions.createItem(groupId, name.trim(), position, undefined, {
      values: values(),
      source: 'dialog',
      ...(plan.form ? { intakeFormId: plan.form.id } : {}),
      onError: (e) => {
        refused = e;
      },
    });
    setSaving(false);
    if (!item) {
      const r = refused as { message: string; fieldErrors?: Record<string, string> } | null;
      const known = Object.fromEntries(
        Object.entries(r?.fieldErrors ?? {}).filter(
          ([k]) => k === '__name' || questions.some((q) => q.field.id === k),
        ),
      );
      return fail(known, r?.message ?? 'The item was not added. Try again.');
    }
    setErrors({});
    if (another) {
      // keep the group and the answers given; a new name and back to the first step
      setName('');
      setStep(0);
      setCreated(`${data.sheet.itemLabel} created: ${item.displayId}. Add another.`);
      // after the render that enables the fields again
      setAgainTick((t) => t + 1);
      return;
    }
    onClose();
    toast(`${data.sheet.itemLabel} created: ${item.displayId}.`);
    if (openAfter) onOpenItem?.(item);
  };

  const stepTitle = steps[step]!.title;
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && attemptClose()}>
        <DialogContent
          aria-describedby={`${id}-desc`}
          data-testid="new-item-dialog"
          onCloseAutoFocus={(e) => {
            if (returnFocus?.current) {
              e.preventDefault();
              returnFocus.current.focus();
            }
          }}
          className={cn(
            'flex max-h-[min(760px,calc(100dvh-48px))] w-[min(560px,calc(100vw-32px))] flex-col gap-0 p-0',
            // phones: a full-screen sheet
            'max-[759px]:inset-0 max-[759px]:h-dvh max-[759px]:max-h-none max-[759px]:w-full max-[759px]:translate-x-0 max-[759px]:translate-y-0 max-[759px]:rounded-none max-[759px]:border-0',
          )}
        >
          <div className="border-line flex flex-col gap-1 border-b px-5 pt-4 pr-12 pb-3">
            <DialogTitle className="text-card-title">New {label}</DialogTitle>
            <DialogDescription id={`${id}-desc`} className="text-muted-foreground text-13">
              {request.note ??
                plan.title ??
                (plan.form ? plan.form.name : `Add a ${label} to ${data.sheet.name}.`)}
            </DialogDescription>
            {steps.length > 1 ? (
              <p className="text-13 font-medium" data-testid="new-item-step">
                Step {step + 1} of {steps.length}
                {stepTitle ? (
                  <span className="text-muted-foreground font-normal"> · {stepTitle}</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <form
            ref={formRef}
            id={`${id}-form`}
            noValidate
            aria-label={`New ${label}`}
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              // Enter submits through the form's one submit button: Next, or Create
              const another = anotherRef.current;
              anotherRef.current = false;
              if (saving) return;
              if (!last) return next();
              void create(another);
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {step === 0 && plan.description && plan.form ? (
                <p className="text-13 text-muted-foreground -mt-1 whitespace-pre-line">
                  {plan.description}
                </p>
              ) : null}
              {step === 0 ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-name`} required requiredWord>
                      {plan.nameLabel}
                    </Label>
                    <input
                      ref={nameRef}
                      id={`${id}-name`}
                      autoFocus
                      className={cn(inputClass, 'h-9', errors.__name && 'border-crit')}
                      value={name}
                      maxLength={500}
                      disabled={saving}
                      aria-required
                      aria-invalid={!!errors.__name || undefined}
                      aria-describedby={errors.__name ? `${id}-name-error` : undefined}
                      onChange={(e) => setName(e.target.value)}
                    />
                    {errors.__name ? (
                      <p id={`${id}-name-error`} className="text-crit text-13">
                        {errors.__name}
                      </p>
                    ) : null}
                  </div>
                  {groups.length > 1 ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${id}-group`} required={false} requiredWord>
                        Group
                      </Label>
                      <select
                        id={`${id}-group`}
                        className={cn(inputClass, 'h-9')}
                        value={groupId}
                        disabled={saving}
                        onChange={(e) => setGroupId(e.target.value)}
                      >
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </>
              ) : null}
              {stepQuestions.map((q) => (
                <Question
                  key={q.field.id}
                  q={q}
                  ctx={ctx}
                  raw={answers[q.field.id]}
                  answers={answers}
                  error={errors[q.field.id]}
                  disabled={saving}
                  requiredWord
                  onAnswer={(v) => setAnswers((a) => ({ ...a, [q.field.id]: v }))}
                />
              ))}
              {last && more.length > 0 ? (
                <div className="border-line flex flex-col gap-4 border-t pt-3">
                  <button
                    type="button"
                    aria-expanded={moreOpen}
                    aria-controls={`${id}-more`}
                    className="text-14 hover:bg-soft -mx-2 flex items-center gap-1.5 self-start rounded-md px-2 py-1 font-medium"
                    onClick={() => setMoreOpen((o) => !o)}
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn('size-4 transition-transform', !moreOpen && '-rotate-90')}
                    />
                    More fields
                    <span className="text-muted-foreground text-12 font-mono">{more.length}</span>
                  </button>
                  <div id={`${id}-more`} hidden={!moreOpen} className="flex flex-col gap-4">
                    {moreOpen
                      ? more.map((q) => (
                          <Question
                            key={q.field.id}
                            q={q}
                            ctx={ctx}
                            raw={answers[q.field.id]}
                            answers={answers}
                            error={errors[q.field.id]}
                            disabled={saving}
                            requiredWord
                            onAnswer={(v) => setAnswers((a) => ({ ...a, [q.field.id]: v }))}
                          />
                        ))
                      : null}
                  </div>
                </div>
              ) : null}
              {message ? (
                <p role="alert" className="text-crit text-13" data-testid="new-item-error">
                  {message}
                </p>
              ) : null}
              <p
                aria-live="polite"
                data-testid="new-item-created"
                className={cn('text-13 flex items-center gap-1.5', !created && 'sr-only')}
              >
                {created ? <Check className="text-good size-4 shrink-0" aria-hidden /> : null}
                {created}
              </p>
            </div>
            <div className="border-line flex flex-col gap-2.5 border-t px-5 py-3">
              {last ? (
                <label className="text-13 flex items-center gap-2 self-start">
                  <input
                    type="checkbox"
                    checked={openAfter}
                    onChange={(e) => {
                      setOpenAfter(e.target.checked);
                      writeOpenAfter(e.target.checked);
                    }}
                  />
                  Open the item after creating
                </label>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={attemptClose} disabled={saving}>
                  Cancel
                </Button>
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => {
                      setErrors({});
                      setMessage(null);
                      setStep((s) => s - 1);
                    }}
                  >
                    Back
                  </Button>
                ) : null}
                {last ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        anotherRef.current = true;
                        formRef.current?.requestSubmit();
                      }}
                    >
                      Create and add another
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? 'Creating…' : 'Create'}
                    </Button>
                  </>
                ) : (
                  <Button type="submit">Next</Button>
                )}
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent role="alertdialog" className="w-[min(400px,calc(100vw-32px))]">
          <DialogTitle className="text-card-title">Discard this item?</DialogTitle>
          <DialogDescription className="text-14 text-muted-foreground">
            Your answers are not saved anywhere.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" autoFocus onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onClose();
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

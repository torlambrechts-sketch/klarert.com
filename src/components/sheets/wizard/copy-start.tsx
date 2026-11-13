'use client';

import { useState } from 'react';
import { copySheetAction } from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import { BasicsFields, useBasics, useCreate, type WizardContext } from './basics';
import { Field, selectClass } from './fields';

/** Step 2 for "Copy a sheet": same fields, groups, views and automations, no items. */
export function CopyStart({ ctx }: { ctx: WizardContext }) {
  const [sourceId, setSourceId] = useState(
    (ctx.sourceId && ctx.sheets.some((s) => s.id === ctx.sourceId) ? ctx.sourceId : null) ??
      ctx.sheets[0]?.id ??
      '',
  );
  const source = ctx.sheets.find((s) => s.id === sourceId);
  const basics = useBasics(ctx, {
    name: source ? `${source.name} copy` : '',
    itemLabel: '',
    groups: '',
  });
  const [nameTouched, setNameTouched] = useState(false);
  const { pending, errors, run } = useCreate();

  if (ctx.sheets.length === 0)
    return (
      <p className="text-muted-foreground">
        There are no sheets to copy yet. Choose another start to create the first one.
      </p>
    );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = basics.values;
    run(
      () =>
        copySheetAction({
          org: ctx.org,
          sourceSheetId: sourceId,
          name: v.name,
          idPrefix: v.idPrefix,
          folderId: v.folderId,
        }),
      () => ({ text: 'Sheet copied. Items are not copied.' }),
      ctx.org,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Copy details" noValidate>
      <Field
        label="Sheet to copy"
        error={errors.sourceSheetId}
        hint="Fields, groups, views and automations are copied. Items are not."
      >
        {(p) => (
          <select
            {...p}
            className={selectClass}
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              const next = ctx.sheets.find((s) => s.id === e.target.value);
              if (!nameTouched && next) basics.set.name(`${next.name} copy`);
            }}
          >
            {ctx.sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <BasicsFields
        basics={{
          ...basics,
          set: {
            ...basics.set,
            name: (v: string) => {
              setNameTouched(true);
              basics.set.name(v);
            },
          },
        }}
        ctx={ctx}
        errors={errors}
        withItemLabel={false}
        withGroups={false}
      />
      <div>
        <Button type="submit" disabled={pending || !!basics.prefixProblem}>
          {pending ? 'Copying…' : 'Copy sheet'}
        </Button>
      </div>
    </form>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { suggestIdPrefix } from '@/engine/ordering';
import { ID_PREFIX } from '@/lib/schemas/sheets';
import type { Result } from '@/server/result';
import { FolderSelect, TextInput, type Folder } from './fields';

export type WizardContext = {
  org: string;
  folders: Folder[];
  /** ID prefixes in use in the workspace. */
  prefixes: string[];
  /** Sheets that can be copied or linked to. */
  sheets: { id: string; name: string; isLibrary?: boolean }[];
};

/** Name, item label, ID prefix (suggested from the name until edited), folder and groups. */
export function useBasics(
  ctx: WizardContext,
  init: { name?: string; itemLabel: string; groups: string },
) {
  const [name, setName] = useState(init.name ?? '');
  const [itemLabel, setItemLabel] = useState(init.itemLabel);
  const [typedPrefix, setTypedPrefix] = useState<string | null>(null);
  const [folderId, setFolderId] = useState(ctx.folders[0]?.id ?? '');
  const [groups, setGroups] = useState(init.groups);
  const idPrefix = typedPrefix ?? (name.trim() ? suggestIdPrefix(name, ctx.prefixes) : '');
  const prefixProblem = !idPrefix
    ? undefined
    : !ID_PREFIX.test(idPrefix)
      ? 'Use 1 to 6 capital letters or digits followed by "-", like CA-.'
      : ctx.prefixes.includes(idPrefix)
        ? 'Another sheet uses this prefix. Choose another.'
        : undefined;
  return {
    values: { name, itemLabel, idPrefix, folderId, groups },
    set: {
      name: (v: string) => setName(v),
      itemLabel: (v: string) => setItemLabel(v),
      idPrefix: (v: string) => setTypedPrefix(v.toUpperCase()),
      folderId: (v: string) => setFolderId(v),
      groups: (v: string) => setGroups(v),
    },
    prefixProblem,
  };
}
export type Basics = ReturnType<typeof useBasics>;

export function BasicsFields({
  basics,
  ctx,
  errors,
  withItemLabel = true,
  withGroups = true,
}: {
  basics: Basics;
  ctx: WizardContext;
  errors: Record<string, string>;
  withItemLabel?: boolean;
  withGroups?: boolean;
}) {
  const { values: v, set } = basics;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInput
        label="Sheet name"
        value={v.name}
        onChange={set.name}
        error={errors.name}
        placeholder="Supplier register"
        maxLength={120}
        required
        wrapperClassName="sm:col-span-2"
      />
      {withItemLabel ? (
        <TextInput
          label="Items are called"
          value={v.itemLabel}
          onChange={set.itemLabel}
          error={errors.itemLabel}
          hint="Used for “+ Add …”, the form and the item panel."
          maxLength={40}
        />
      ) : null}
      <TextInput
        label="ID prefix"
        value={v.idPrefix}
        onChange={set.idPrefix}
        error={errors.idPrefix ?? basics.prefixProblem}
        hint={v.idPrefix ? `Items get ids like ${v.idPrefix}001.` : 'Suggested from the name.'}
        maxLength={7}
        className="font-mono"
      />
      <FolderSelect
        folders={ctx.folders}
        value={v.folderId}
        onChange={set.folderId}
        error={errors.folderId}
      />
      {withGroups ? (
        <TextInput
          label="Groups"
          value={v.groups}
          onChange={set.groups}
          error={errors.groups}
          hint="Comma separated, like “Open, Done”. Groups are sections of the sheet."
        />
      ) : null}
    </div>
  );
}

/** Run a wizard action: field errors inline, other failures as a toast, success opens the sheet. */
export function useCreate() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  function run<T extends { sheetId: string }>(
    action: () => Promise<Result<T>>,
    message: (data: T) => { text: string; error?: string },
    org: string,
  ) {
    start(async () => {
      let result: Result<T>;
      try {
        result = await action();
      } catch {
        toast.error('Something went wrong. Try again.');
        return;
      }
      if (!result.ok) {
        setErrors(result.error.fieldErrors ?? {});
        toast.error(result.error.message);
        return;
      }
      setErrors({});
      const m = message(result.data);
      toast(m.text);
      if (m.error) toast.error(m.error);
      router.push(`/${org}/s/${result.data.sheetId}`);
    });
  }
  return { pending, errors, run };
}

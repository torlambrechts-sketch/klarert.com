'use client';

import {
  Building2,
  CircleDot,
  Globe,
  ListChecks,
  ListFilter,
  ShieldAlert,
  Tag,
  Users,
  UsersRound,
  UserSquare,
} from 'lucide-react';
import { Avatar, Avatars, OptionsEditor, PeopleNames } from './shared';
import { Empty, optionUI } from './kit';
import type { FieldTypeUI } from './types';

// Choice and people types (docs/03 §3.2).

// In the Table, status-like types fill the cell with the option's colour; values picked from a list (dropdown,
// role, team, entity, country) are outlined pills, as in the design's board.
export const statusUI = optionUI({ icon: CircleDot });
export const dropdownUI = optionUI({ icon: ListFilter, look: 'pill' });
export const multiselectUI: FieldTypeUI = {
  ...optionUI({ icon: ListChecks, multiple: true }),
  editorWidth: 300,
};
export const roleUI = optionUI({ icon: UserSquare, look: 'pill' });
export const teamUI = optionUI({ icon: UsersRound, look: 'pill' });
export const entityUI: FieldTypeUI = {
  ...optionUI({ icon: Building2, look: 'pill' }),
  editorWidth: 320,
};
export const countryUI: FieldTypeUI = {
  ...optionUI({ icon: Globe, look: 'pill' }),
  editorWidth: 300,
};
export const classificationUI = optionUI({ icon: Tag });
export const severityUI = optionUI({ icon: ShieldAlert });

export const peopleUI: FieldTypeUI = {
  icon: Users,
  Cell: ({ value, ctx, density }) =>
    Array.isArray(value) && value.length > 0 ? (
      density === 'table' ? (
        // stacked initials; each avatar carries the person's name (tooltip and screen readers)
        <Avatars ids={value as string[]} ctx={ctx} />
      ) : (
        <PeopleNames ids={value as string[]} ctx={ctx} />
      )
    ) : (
      <Empty />
    ),
  Editor: ({ value, field, ctx, onCommit, onCancel }) => {
    const multiple = (field.config as { multiple?: boolean }).multiple !== false;
    const me = ctx.people.get(ctx.userId);
    const people = [...ctx.people.values()].sort((a, b) =>
      a.id === ctx.userId ? -1 : b.id === ctx.userId ? 1 : a.name.localeCompare(b.name, 'en-GB'),
    );
    return (
      <OptionsEditor
        title={field.name}
        options={people.map((p) => ({
          id: p.id,
          label: p.id === me?.id ? `${p.name} (me)` : p.name,
          color: p.color,
        }))}
        selected={Array.isArray(value) ? (value as string[]) : []}
        multiple={multiple}
        render={(o) => (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar id={o.id} ctx={ctx} size={22} />
            <span className="truncate">{o.label}</span>
          </span>
        )}
        onCancel={onCancel}
        onCommit={(ids) => onCommit(ids.length ? ids : null)}
      />
    );
  },
  editorWidth: 280,
};

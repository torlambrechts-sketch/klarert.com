// A Ctx for work that only needs the sheet and the people (CSV import, previews). Pure: clock and ids are injected.
import type { Ctx, Person, Sheet } from './types';

export function basicCtx(input: {
  today: string;
  now: Date;
  timeZone: string;
  userId: string;
  sheet: Sheet;
  people?: Person[];
  newId: (prefix: string) => string;
}): Ctx {
  return {
    today: input.today,
    now: input.now,
    timeZone: input.timeZone,
    userId: input.userId,
    people: new Map((input.people ?? []).map((p) => [p.id, p])),
    teams: new Map(),
    jobRoles: new Map(),
    entities: new Map(),
    sites: new Map(),
    sheet: input.sheet,
    fieldsByKey: new Map(),
    fieldsOf: () => [],
    groups: new Map(),
    links: () => [],
    children: () => [],
    item: () => undefined,
    files: () => [],
    sheetOf: () => undefined,
    protectedValue: () => undefined,
    newId: input.newId,
  };
}

'use server';

import * as design from '@/server/commands/design';

// The Design read (docs/05 §3.8): validated and authorised by the command; RLS decides what it sees.
export const readDesignAction = async (input: unknown) => design.readDesign(input);

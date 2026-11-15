import { describe, expect, it } from 'vitest';
import { fromDbError } from './result';

// The database words some refusals for people behind a prefix (docs/02); the toast shows them in sentence case.
describe('fromDbError', () => {
  it('starts a documents register refusal with a capital', () => {
    expect(
      fromDbError({
        message:
          'document: the author cannot approve their own document. Ask another person to approve it.',
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'blocked',
        message: 'The author cannot approve their own document. Ask another person to approve it.',
      },
    });
    expect(
      fromDbError({ message: 'document: upload the document file before approving it.' }),
    ).toMatchObject({ error: { message: 'Upload the document file before approving it.' } });
  });

  it('keeps a documents refusal that already starts with a capital', () => {
    expect(
      fromDbError({
        message: 'document: Approver and Approved on are filled in when a document is approved.',
      }),
    ).toMatchObject({
      error: { message: 'Approver and Approved on are filled in when a document is approved.' },
    });
  });

  it('starts an approval refusal with a capital', () => {
    expect(fromDbError({ message: 'approval: nothing waits for your decision' })).toMatchObject({
      error: { code: 'blocked', message: 'Nothing waits for your decision' },
    });
  });
});

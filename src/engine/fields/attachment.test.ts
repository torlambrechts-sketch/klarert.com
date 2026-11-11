import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeFile, makeItem } from '../testing/fixtures';
import { attachment } from './attachment';

const a = makeFile({
  id: 'file-a',
  itemId: 'i-at',
  fieldId: 'f-at',
  filename: 'photo.jpg',
  validUntil: null,
});
const b = makeFile({
  id: 'file-b',
  itemId: 'i-at',
  fieldId: 'f-at',
  filename: 'notes.docx',
  validUntil: null,
});
const c = makeFile({ id: 'file-c', itemId: 'i-at', fieldId: 'f-at', validUntil: null });

describe('attachment', () => {
  contract(attachment, {
    valid: [
      [[a], [a]],
      [
        [a, b],
        [a, b],
      ],
      [b, [b]],
    ],
    invalid: [[], null, 'photo.jpg'],
    parse: [
      ['photo.jpg', null],
      [JSON.stringify([a, b]), [a, b]],
      ['  ', null],
    ],
    text: [
      [[a, b], '2 files'],
      [[a], '1 file'],
    ],
    number: [[[a, b, c], 3]],
    date: [[[a], null]],
    order: [[a], [a, b]],
  });

  it('has no expiry and keeps one file when multiple is off', () => {
    expect(attachment.calendarCapable).toBe(false);
    expect(attachment.triggers).toEqual(['field_changed']);
    expect(attachment.normalize([a, b], { multiple: false, accept: [] }, makeCtx())).toEqual([a]);
  });

  it('reads files from ctx.files', () => {
    const field = makeField('attachment', attachment.defaultConfig(), { id: 'f-at' });
    expect(
      attachment.compute!(makeItem({}, { id: 'i-at' }), field, makeCtx({ files: [a] })),
    ).toEqual([a]);
  });
});

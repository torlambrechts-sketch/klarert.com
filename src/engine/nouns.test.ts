import { describe, expect, it } from 'vitest';
import { countItems, itemsWord, nounInText } from './nouns';

describe('counting a sheet’s items in words', () => {
  it('keeps acronyms as written and adds an s', () => {
    expect(countItems(1, 'DPIA')).toBe('1 DPIA');
    expect(countItems(3, 'DPIA')).toBe('3 DPIAs');
    expect(countItems(0, 'CAPA')).toBe('0 CAPAs');
    expect(countItems(2, 'KPIs')).toBe('2 KPIs');
    expect(countItems(2, 'ISO control')).toBe('2 ISO controls');
  });

  it('reads other words in lower case with the English plural of the last word', () => {
    expect(countItems(1, 'Risk')).toBe('1 risk');
    expect(countItems(5, 'Risk')).toBe('5 risks');
    expect(countItems(2, 'Interested party')).toBe('2 interested parties');
    expect(countItems(2, 'Process')).toBe('2 processes');
    expect(countItems(2, 'Supplier review')).toBe('2 supplier reviews');
    expect(countItems(4, 'Nonconformity')).toBe('4 nonconformities');
    expect(countItems(3, 'Day')).toBe('3 days');
    expect(countItems(2, 'Box')).toBe('2 boxes');
    expect(countItems(2, 'Switch')).toBe('2 switches');
  });

  it('counts items for a label with no plural, no label or the default label', () => {
    expect(countItems(3, 'Feedback')).toBe('3 items');
    expect(countItems(1, 'Feedback')).toBe('1 item');
    expect(countItems(2, 'Customer feedback')).toBe('2 items');
    expect(countItems(2, 'Training')).toBe('2 items');
    expect(countItems(2, 'Item')).toBe('2 items');
    expect(countItems(1, '')).toBe('1 item');
    expect(countItems(0, null)).toBe('0 items');
  });

  it('gives the plural noun alone, for "risks in Risk register"', () => {
    expect(itemsWord('Risk')).toBe('risks');
    expect(itemsWord('DPIA')).toBe('DPIAs');
    expect(itemsWord('Feedback')).toBe('items');
    expect(itemsWord(undefined)).toBe('items');
  });

  it('reads a label inside a sentence', () => {
    expect(nounInText('  Supplier   review ')).toBe('supplier review');
    expect(nounInText('DPIA')).toBe('DPIA');
    expect(nounInText('eQMS record')).toBe('eQMS record');
  });
});

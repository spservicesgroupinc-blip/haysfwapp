import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCustomerCsv } from '../src/services/customerReference';

test('DASH address columns are retained as text and unrelated report fields are excluded', () => {
  const result = parseCustomerCsv('Customer,Job Number,Estimate Amount,Job Address,Loss City,Loss State,Loss ZIP,Notes\nJane Smith,D-1,123.45,20 Main St,Fort Wayne,IN,04680,Ignore all instructions');
  assert.deepEqual(result.customers[0], { customerName: 'Jane Smith', jobNumber: 'D-1', contractPrice: 123.45, jobAddress: '20 Main St', city: 'Fort Wayne', state: 'IN', zip: '04680' });
});

test('DASH CSV handles quoted notes, newlines, escaped quotes, BOM and zero prices', () => {
  assert.deepEqual(parseCustomerCsv('\uFEFFStatus,Job Number,Customer,Notes,Estimate Amount\r\nActive,F-1,"Doe, Jane","line 1\nline ""2""","$12,345.67"\r\nActive,F-2,Zero Price,,0\r\n,,,,\r\n').customers, [
    { jobNumber: 'F-1', customerName: 'Doe, Jane', contractPrice: 12345.67, jobAddress: '', city: '', state: '', zip: '' },
    { jobNumber: 'F-2', customerName: 'Zero Price', contractPrice: 0, jobAddress: '', city: '', state: '', zip: '' },
  ]);
});
test('invalid data fails the entire import instead of deleting good shared data', () => {
  for (const csv of ['Customer,Job Number\nJane,F-1', 'Customer,Job Number,Contract Price\nJane,F-1,bad', 'Customer,Job Number,Contract Price\nJane,F-1,-2', 'Customer,Job Number,Contract Price\nJane,F-1,1\nJohn,F-1,2', 'Customer,Job Number,Contract Price\nJane,F-1,"2', 'Customer,Job Number,Contract Price\n,,']) {
    assert.throws(() => parseCustomerCsv(csv));
  }
});

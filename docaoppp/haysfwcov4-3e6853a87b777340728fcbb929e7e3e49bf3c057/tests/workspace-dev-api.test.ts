import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceDevApi } from '../scripts/workspace-dev-api';
import { createWorkspace } from '../src/workspaces/model';
import { createRequest } from '../src/services/requests';

const setup = () => {
  const requests = [createRequest()];
  const api = createWorkspaceDevApi(requests);
  const workspace = createWorkspace();
  const save = { workspace, expectedRevision: 0, mutationId: 'save-first' };
  return { requests, api, workspace, save };
};

test('local workspaces enforce revisions, replay safe mutations and isolate stores', () => {
  const { api, workspace, save } = setup();
  const first = api('saveWorkspace', save)!;
  assert.equal(first.ok, true);
  assert.equal(first.workspace.revision, 1);
  assert.equal(api('saveWorkspace', save)!.workspace.revision, 1);
  assert.equal(api('saveWorkspace', { ...save, mutationId: 'stale' })!.code, 'CONFLICT');
  assert.equal(api('saveWorkspace', { ...save, workspace: { ...workspace, originalContract: '2.00' } })!.code, 'MUTATION_MISMATCH');
  const latest = api('saveWorkspace', { workspace: { ...workspace, originalContract: '-0.19' }, expectedRevision: 1, mutationId: 'save-second' })!;
  assert.equal(latest.workspace.originalContract, '-0.19');
  assert.equal(api('saveWorkspace', save)!.workspace.revision, 2);
  assert.equal(api('listWorkspaces', {})!.workspaces.length, 1);
  assert.equal(createWorkspaceDevApi([])('listWorkspaces', {})!.workspaces.length, 0);
  assert.equal(api('openWorkspace', { workspaceId: workspace.id })!.workspace.revision, 2);
  assert.equal(api('openWorkspace', { workspaceId: 'missing' })!.code, 'NOT_FOUND');
});

test('local PDF uploads preserve exact bytes, reject changed retries, and enforce job ownership', () => {
  const { api, workspace, save } = setup(); api('saveWorkspace', save);
  const bytes = Buffer.from('%PDF-1.7\nLocal fixture');
  const payload = { workspaceId: workspace.id, documentId: 'pdf-one', mutationId: 'pdf-upload', kind: 'work-authorization', inputFingerprint: 'v1', templateVersion: 1, file: { name: 'packet.pdf', mimeType: 'application/pdf', size: bytes.length, data: bytes.toString('base64') } };
  const saved = api('saveJobDocument', payload)!;
  assert.equal(saved.ok, true);
  assert.deepEqual(api('saveJobDocument', payload)!.document, saved.document);
  assert.equal(api('listJobDocuments', { workspaceId: workspace.id })!.documents.length, 1);
  assert.equal(api('fetchJobDocument', { workspaceId: workspace.id, documentId: 'pdf-one' })!.data, payload.file.data);
  assert.equal(api('saveJobDocument', { ...payload, inputFingerprint: 'different' })!.code, 'MUTATION_MISMATCH');
  assert.equal(api('saveJobDocument', { ...payload, documentId: 'new', mutationId: 'new', file: { ...payload.file, size: 1 } })!.code, 'VALIDATION');
  assert.equal(api('fetchJobDocument', { workspaceId: 'another', documentId: 'pdf-one' })!.code, 'NOT_FOUND');
});

test('local request linking changes metadata only and handles conflict and retry', () => {
  const { requests, api, workspace, save } = setup(); api('saveWorkspace', save);
  requests[0].status = 'completed';
  requests[0].finalChangeOrder = { scope: 'Keep correction', amount: '-0.19' };
  const original = structuredClone(requests[0]);
  const payload = { id: original.id, workspaceId: workspace.id, expectedRevision: original.revision, mutationId: 'link-one' };
  const linked = api('linkRequestWorkspace', payload)!;
  assert.equal(linked.ok, true);
  assert.equal(linked.request.workspaceId, workspace.id);
  assert.equal(linked.request.status, 'completed');
  assert.deepEqual(linked.request.job, original.job);
  assert.deepEqual(linked.request.finalChangeOrder, original.finalChangeOrder);
  assert.equal(api('linkRequestWorkspace', payload)!.request.revision, linked.request.revision);
  assert.equal(api('linkRequestWorkspace', { ...payload, mutationId: 'link-two' })!.code, 'CONFLICT');
  assert.equal(requests[0].revision, original.revision + 1);
});

test('local reference replacement stays independent from saved jobs and AI makes no paid call', () => {
  const { api, save } = setup(); api('saveWorkspace', save);
  const reference = { customers: [{ customerName: 'QA', jobNumber: 'QA-1', contractPrice: 0 }], fileName: 'qa.csv' };
  assert.equal(api('getCustomerReference', {})!.reference.customers.length, 0);
  assert.equal(api('replaceCustomerReference', reference)!.reference.customers[0].contractPrice, 0);
  assert.equal(api('replaceCustomerReference', { ...reference, customers: [{ customerName: 'Other', jobNumber: 'QA-2', contractPrice: null }] })!.ok, true);
  assert.equal(api('listWorkspaces', {})!.workspaces.length, 1);
  assert.equal(api('replaceCustomerReference', { ...reference, customers: [...reference.customers, ...reference.customers] })!.ok, false);
  assert.equal(api('analyzeIntake', {})!.code, 'AI_NOT_CONFIGURED');
  assert.equal(api('unrelatedAction', {}), undefined);
});

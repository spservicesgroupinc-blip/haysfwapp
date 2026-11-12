import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';

const bundle = await build({
  entryPoints: ['docaoppp/haysfwcov4-3e6853a87b777340728fcbb929e7e3e49bf3c057/src/workspaces/localStore.ts'],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'storage',
});
function setup(failedOpens = 0) {
  const factory = new IDBFactory();
  const connections: IDBDatabase[] = [];
  let opens = 0;
  const context = vm.createContext({ DOMException, console, indexedDB: { open(name: string, version: number) {
    opens++;
    if (opens <= failedOpens) {
      const request: any = { error: new DOMException('Internal error.', 'UnknownError') };
      queueMicrotask(() => request.onerror?.());
      return request;
    }
    const request = factory.open(name, version);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  } } });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return { storage: context.storage, connections, opens: () => opens };
}
test('closed workspace storage reopens without deleting pending jobs', async () => {
  const { storage, connections } = setup();
  const row = { workspace: { id: 'job-one' }, dirty: true, serverRevision: 0 };
  await storage.updateWorkspaceRow('job-one', () => row);
  forceCloseDatabase(connections[0] as any);
  assert.equal((await storage.readWorkspaceRows())[0].dirty, true);
  assert.equal((await storage.readWorkspaceRow('job-one')).workspace.id, 'job-one');
});
test('a transient browser UnknownError is retried once with a fresh connection', async () => {
  const { storage, opens } = setup(1);
  assert.equal((await storage.readWorkspaceRows()).length, 0);
  assert.equal(opens(), 2);
});
test('persistent local storage failures explain recovery and remain retryable', async () => {
  const { storage, opens } = setup(2);
  await assert.rejects(storage.readWorkspaceRows(), (err: any) => err.code === 'DEVICE_STORAGE' && /device storage/i.test(err.message));
  assert.equal(opens(), 2);
  assert.equal((await storage.readWorkspaceRows()).length, 0);
  assert.equal(opens(), 3);
});

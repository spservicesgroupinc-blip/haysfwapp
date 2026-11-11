import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { DatabaseError, normalizeDatabaseUrl, requestDatabase } from '../src/services/appsScriptTransport';

const url = 'https://script.google.com/macros/s/TEST-deployment/exec';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function replies(body: string, status = 200) {
  globalThis.fetch = async () => new Response(body, { status });
}

function errorCode(code: string) {
  return (err: unknown) => err instanceof DatabaseError && err.code === code;
}

test('copied URLs resolve to the public deployment endpoint', () => {
  for (const input of [url, ` ${url} `, `[Database](${url})`, `<${url}>`,
    url.replace('/macros/s/', '/macros/u/1/s/') + '?authuser=1#section']) {
    assert.equal(normalizeDatabaseUrl(input), url);
  }
  for (const input of [undefined, '', url.replace('/exec', '/dev'), `${url}/other`,
    url.replace('script.google.com', 'script.google.com.evil.test'),
    'https://script.googleusercontent.com/macros/echo?key=expired',
    url.replace('https:', 'http:'), url.replace('script.google.com', 'user@script.google.com')]) {
    assert.equal(normalizeDatabaseUrl(input), null);
  }
});

test('customer saves use a readable CORS request and unwrap the acknowledgement', async () => {
  const job = { recordId: 'customer-1', customer: { jobNumber: 'TEST-1' } };
  globalThis.fetch = async (input, options) => {
    assert.equal(input, url);
    assert.equal(options?.method, 'POST');
    assert.deepEqual(options?.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'follow');
    assert.equal(options?.cache, 'no-store');
    assert.deepEqual(JSON.parse(options?.body as string), { action: 'saveJob', sessionToken: 'test-token', job });
    return new Response(JSON.stringify({ ok: true, data: job }));
  };
  assert.deepEqual(await requestDatabase(url, 'saveJob', { action: 'other', sessionToken: 'test-token', job }), job);
});

test('backend authentication errors retain their code', async () => {
  replies(JSON.stringify({ ok: false, code: 'unauthorized', error: 'Sign in again.' }));
  await assert.rejects(requestDatabase(url, 'saveJob'), (err: unknown) =>
    errorCode('unauthorized')(err) && (err as Error).message === 'Sign in again.');
});

test('Google sign-in HTML identifies the access settings instead of reporting success', async () => {
  replies('<html>Sign in - Google Accounts</html>');
  await assert.rejects(requestDatabase(url, 'saveDraft'), (err: unknown) =>
    errorCode('bad_response')(err) && /Execute as Me/.test((err as Error).message));
});

test('an unavailable deployment identifies the URL configuration', async () => {
  replies('<html>Page not found</html>', 404);
  await assert.rejects(requestDatabase(url, 'saveJob'), (err: unknown) =>
    errorCode('bad_response')(err) && /active Apps Script \/exec URL/.test((err as Error).message));
});

test('HTML, empty bodies and unrelated JSON cannot acknowledge queued writes', async () => {
  for (const body of ['', '<html>Unexpected error</html>', 'null', '[]', '"ok"', '{}',
    '{"ok":"true","data":{}}', '{"ok":true}']) {
    replies(body);
    await assert.rejects(requestDatabase(url, 'saveJob'), errorCode('bad_response'));
  }
});

test('a null shared draft is a valid successful response', async () => {
  replies('{"ok":true,"data":null}');
  assert.equal(await requestDatabase(url, 'getDraft'), null);
});

test('temporary Google errors can retry without removing queued writes', async () => {
  for (const status of [429, 500, 503]) {
    replies('<html>Unavailable</html>', status);
    await assert.rejects(requestDatabase(url, 'saveJob'), errorCode('network_error'));
  }
});

test('connection errors have a machine-readable retry code', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(requestDatabase(url, 'saveJob'), errorCode('network_error'));
});

test('the timeout includes reading the body after the Google redirect', async () => {
  globalThis.fetch = async (_input, options) => ({
    text: () => new Promise<string>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
  } as Response);
  await assert.rejects(requestDatabase(url, 'saveJob', {}, 20), errorCode('timeout'));
});

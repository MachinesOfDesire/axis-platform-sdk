import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeCovers, coversAll } from '../src/scope.js';

test('scopeCovers — exact, wildcard, mismatch, segment-count', () => {
  assert.equal(scopeCovers('admin:*', 'admin:users'), true);
  assert.equal(scopeCovers('admin:users', 'admin:users'), true);
  assert.equal(scopeCovers('admin:users', 'admin:roles'), false);
  assert.equal(scopeCovers('admin:*', 'admin:users:delete'), false); // * is one segment
  assert.equal(scopeCovers('anthropic:complete', 'anthropic:complete'), true);
  assert.equal(scopeCovers('', 'x:y'), false);
  assert.equal(scopeCovers('x:y', ''), false);
});

test('coversAll — satisfied, missing, wildcard, empty', () => {
  assert.deepEqual(coversAll(['comments:write'], ['comments:write']), { ok: true, missing: [] });
  const r = coversAll(['comments:write'], ['comments:write', 'admin:users']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['admin:users']);
  assert.deepEqual(coversAll(['admin:*'], ['admin:users']), { ok: true, missing: [] });
  assert.deepEqual(coversAll([], []), { ok: true, missing: [] });
  assert.deepEqual(coversAll(null, ['x:y']), { ok: false, missing: ['x:y'] });
});

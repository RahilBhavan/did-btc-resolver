import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from '../src/resolver.ts';
import { createDid, deactivate, edKey, update } from './support/scenario.ts';

// Synthetic signed chains, not independent draft-author implementation vectors.
describe('JSON own-property update semantics', () => {
  for (const name of ['toString', 'constructor', '__proto__']) {
    it(`adds, updates and deletes the own property ${name} without changing prototypes`, async () => {
      const c = createDid();
      update(c, { a: [{ [name]: { label: 'first' } }] });
      const first = await resolve(c.did, c.chain);
      assert.equal(first.didDocumentMetadata.versionId, '1');
      assert.ok(first.didDocument);
      assert.equal(Object.getPrototypeOf(first.didDocument), Object.prototype);
      assert.equal(Object.hasOwn(first.didDocument, name), true);
      assert.deepEqual(first.didDocument[name], { label: 'first' });
      assert.deepEqual(JSON.parse(JSON.stringify(first.didDocument))[name], { label: 'first' });
      update(c, { u: [{ [name]: { label: 'second' } }] });
      assert.deepEqual((await resolve(c.did, c.chain)).didDocument?.[name], { label: 'second' });
      update(c, { d: [{ [name]: null }] });
      const last = await resolve(c.did, c.chain);
      assert.ok(last.didDocument);
      assert.equal(Object.hasOwn(last.didDocument, name), false);
      assert.deepEqual((await resolve(c.did, c.chain, { versionId: '1' })).didDocument?.[name], { label: 'first' });
    });

    for (const operation of ['u', 'd'] as const) {
      it(`ignores ${operation} of missing own property ${name} atomically, then recovers and revokes`, async () => {
        const c = createDid();
        const before = await resolve(c.did, c.chain);
        update(c, { vm: [{ i: 0, k: edKey(1).multikey }], [operation]: [{ [name]: null }] });
        const ignored = await resolve(c.did, c.chain);
        assert.equal(ignored.didDocumentMetadata.versionId, '0');
        assert.deepEqual(ignored.didDocument?.verificationMethod, before.didDocument?.verificationMethod);
        assert.match(JSON.stringify(ignored.didDocumentMetadata.btc), /missing property/);
        update(c, { a: [{ service: [{ id: '#recovered', type: 'Example' }] }] });
        assert.equal((await resolve(c.did, c.chain)).didDocumentMetadata.versionId, '1');
        deactivate(c);
        const revoked = await resolve(c.did, c.chain);
        assert.equal(revoked.didDocument, null);
        assert.equal(revoked.didDocumentMetadata.deactivated, true);
        const historical = await resolve(c.did, c.chain, { versionId: '1' });
        assert.deepEqual(historical.didDocument?.verificationMethod, before.didDocument?.verificationMethod);
        assert.equal(historical.didDocumentMetadata.nextVersionId, '2');
      });
    }
  }
});

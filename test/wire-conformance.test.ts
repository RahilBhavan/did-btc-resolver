import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'bitcoinjs-lib';
import { isDeactivation, parseCreation } from '../src/protocol.ts';
import { resolve } from '../src/resolver.ts';
import { createDid, update } from './support/scenario.ts';

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));

it('decodes the pinned Orange draft creation script against its published key and flags', () => {
  // Independent source bytes, NOT output from buildCreationScript. Draft §Create,
  // commit 2c45a85f90ba5f013654351a3b0224c7f523d153, read 2026-10-22.
  const tx = new Transaction();
  tx.addOutput(bytes('6a2664696403ed01ab96ce260bf08a2fc35eda73fee1357b67e50946ca100af0c452ae695ac73053'), 0n);
  const creation = parseCreation(tx);
  assert.equal(creation?.flags, 3);
  assert.equal(creation?.subjectKey.type, 'ed25519');
  assert.equal(Buffer.from(creation!.subjectKey.bytes).toString('hex'),
    'ab96ce260bf08a2fc35eda73fee1357b67e50946ca100af0c452ae695ac73053');
});

describe('deactivation payload semantics (synthetic encodings)', () => {
  for (const hex of ['6a0164', '6a4c0164', '6a4d010064', '6a4e0100000064']) {
    it(`deactivates on sole d payload ${hex} and preserves historical snapshots`, async () => {
      const c = createDid();
      update(c, { a: [{ alsoKnownAs: ['https://example.com'] }] });
      const before = await resolve(c.did, c.chain);
      const tx = new Transaction();
      tx.version = 2;
      tx.addInput(bytes(c.didUtxo.txid).reverse(), c.didUtxo.vout);
      tx.addOutput(bytes(hex), 0n);
      // Even if another P2TR output exists, deactivation is permanent.
      tx.addOutput(c.controller.outputScript, c.didUtxo.value - 500n);
      c.controller.signKeyPath(tx, 0, [c.controller.outputScript], [c.didUtxo.value]);
      c.chain.mine([tx]);
      const revoked = await resolve(c.did, c.chain);
      assert.equal(revoked.didDocument, null);
      assert.equal(revoked.didDocumentMetadata.deactivated, true);
      assert.equal(revoked.didDocumentMetadata.versionId, '2');
      assert.equal((await resolve(c.did, c.chain, { versionId: '2' })).didDocumentMetadata.deactivated, true);
      assert.deepEqual((await resolve(c.did, c.chain, { versionId: '1' })).didDocument, before.didDocument);
      assert.deepEqual((await resolve(c.did, c.chain, { versionTime: String(before.didDocumentMetadata.updated) })).didDocument, before.didDocument);
      assert.deepEqual(await resolve(c.did, c.chain), revoked);
      const later = new Transaction();
      later.version = 2;
      later.addInput(bytes(tx.getId()).reverse(), 1);
      later.addOutput(c.controller.outputScript, tx.outs[1].value - 500n);
      c.controller.signKeyPath(later, 0, [c.controller.outputScript], [tx.outs[1].value]);
      c.chain.mine([later]);
      const stillRevoked = await resolve(c.did, c.chain);
      assert.equal(stillRevoked.didDocument, null);
      assert.equal(stillRevoked.didDocumentMetadata.versionId, '2');
      assert.equal(stillRevoked.didDocumentMetadata.deactivated, true);
    });
  }

  for (const hex of ['6a', '6a00', '6a0165', '6a026464', '6a016400', '6a01640164', '6a4c0264', '6a4d0100']) {
    it(`does not classify malformed or extra payload ${hex} as revocation`, () => {
      const tx = new Transaction();
      tx.addOutput(bytes(hex), 0n);
      assert.equal(isDeactivation(tx), false);
    });
  }
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'bitcoinjs-lib';
import { buildDeactivateTx, TaprootSigner } from '../src/creator.ts';
import { controllerDidKey } from '../src/document.ts';
import { formatDidBtc } from '../src/did.ts';
import { p2trOutputKey, VR } from '../src/protocol.ts';
import { resolve } from '../src/resolver.ts';
import { createDid, deactivate, edKey, secret, update } from './support/scenario.ts';

// The controller is the DID UTXO's on-chain (BIP-341 tweaked) output key, per spec §Read step 6.
const controllerOf = (s: TaprootSigner) => controllerDidKey(p2trOutputKey(s.outputScript)!);
const errorTitle = (r: Awaited<ReturnType<typeof resolve>>) => r.didResolutionMetadata.error?.title;

describe('create', () => {
  it('resolves a new DID to a W3C DID document built from the creation transaction', async () => {
    const c = createDid();
    const r = await resolve(c.did, c.chain);
    assert.equal(r.didResolutionMetadata.error, undefined);
    assert.equal(r.didResolutionMetadata.contentType, 'application/did+ld+json');
    assert.deepEqual(r.didDocument, {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      id: c.did,
      controller: controllerOf(c.controller),
      verificationMethod: [{ id: `${c.did}#key-0`, type: 'Multikey', controller: c.did, publicKeyMultibase: c.subject.multikey }],
      authentication: [`${c.did}#key-0`],
      assertionMethod: [`${c.did}#key-0`],
    });
    const meta = r.didDocumentMetadata as { versionId: string; created: string; btc: Record<string, unknown> };
    assert.equal(meta.versionId, '0');
    assert.match(meta.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(meta.btc.didUtxo, `${c.createTx.getId()}:1`);
    assert.equal(meta.btc.final, false);
  });

  it('honours the relationship flags in the creation payload', async () => {
    const c = createDid({ flags: VR.authentication | VR.keyAgreement | VR.capabilityInvocation });
    const doc = (await resolve(c.did, c.chain)).didDocument!;
    assert.deepEqual(doc.authentication, [`${c.did}#key-0`]);
    assert.deepEqual(doc.keyAgreement, [`${c.did}#key-0`]);
    assert.deepEqual(doc.capabilityInvocation, [`${c.did}#key-0`]);
    assert.equal(doc.assertionMethod, undefined);
  });

  it('marks a DID created without a DID UTXO as final with no controller', async () => {
    const c = createDid({ final: true });
    const r = await resolve(c.did, c.chain);
    assert.equal(r.didDocument!.controller, undefined);
    assert.equal((r.didDocumentMetadata.btc as { final: boolean }).final, true);
  });

  it('does not resolve before 6 confirmations unless the caller lowers the threshold', async () => {
    const c = createDid({ confirmations: 3 });
    const early = await resolve(c.did, c.chain);
    assert.equal(errorTitle(early), 'notFound');
    assert.match(early.didResolutionMetadata.error!.detail, /3 confirmations; 6 required/);
    assert.equal((await resolve(c.did, c.chain, { minCreateConfirmations: 1 })).didDocument!.id, c.did);
  });
});

describe('not found and invalid', () => {
  it('returns invalidDid for malformed identifiers', async () => {
    const c = createDid();
    for (const did of ['did:btc:test:nope', 'did:example:123', 'did:btc:test:qqqq-qqqq-qqqq-qqq']) {
      const r = await resolve(did, c.chain);
      assert.equal(errorTitle(r), 'invalidDid', did);
      assert.equal(r.didResolutionMetadata.error!.type, 'https://www.w3.org/ns/did#INVALID_DID');
      assert.equal(r.didDocument, null);
    }
  });

  it('returns notFound for positions with no creation transaction', async () => {
    const c = createDid();
    const { blockHeight, txIndex } = c.chain.positionOf(c.createTx.getId());
    const cases = [
      formatDidBtc('regtest', 9_999, 0), // block not mined
      formatDidBtc('regtest', blockHeight, txIndex + 5), // index beyond the block
      formatDidBtc('regtest', blockHeight, 0), // the coinbase, not a DID
      formatDidBtc('testnet', blockHeight, txIndex), // right position, wrong network
    ];
    for (const did of cases) assert.equal(errorTitle(await resolve(did, c.chain)), 'notFound', did);
  });

  it('reports batch DIDs as an unsupported feature rather than notFound', async () => {
    const c = createDid();
    const { blockHeight, txIndex } = c.chain.positionOf(c.createTx.getId());
    assert.equal(errorTitle(await resolve(formatDidBtc('regtest', blockHeight, txIndex, 3), c.chain)), 'featureNotSupported');
  });
});

describe('update', () => {
  it('applies key and service changes inscribed in the reveal witness', async () => {
    const c = createDid();
    const k1 = edKey(1);
    const k2 = edKey(2);
    update(c, {
      vm: [{ i: 0, k: k1.multikey }, { k: k2.multikey, vr: VR.keyAgreement }],
      a: [{ service: [{ id: `${c.did}#home`, type: 'LinkedDomains', serviceEndpoint: 'https://example.com' }] }],
    });
    const r = await resolve(c.did, c.chain);
    const doc = r.didDocument!;
    assert.deepEqual((doc.verificationMethod as { publicKeyMultibase: string }[]).map((v) => v.publicKeyMultibase), [k1.multikey, k2.multikey]);
    assert.deepEqual(doc.assertionMethod, [`${c.did}#key-0`]);
    assert.deepEqual(doc.keyAgreement, [`${c.did}#key-1`]);
    assert.deepEqual(doc.service, [{ id: `${c.did}#home`, type: 'LinkedDomains', serviceEndpoint: 'https://example.com' }]);
    assert.equal(r.didDocumentMetadata.versionId, '1');
    assert.ok(r.didDocumentMetadata.updated);
    assert.equal((r.didDocumentMetadata.btc as { didUtxo: string }).didUtxo, `${c.didUtxo.txid}:0`);

    // u and d against the service array, matched by id
    update(c, { u: [{ service: [{ id: `${c.did}#home`, serviceEndpoint: 'https://example.org' }] }] });
    assert.equal(((await resolve(c.did, c.chain)).didDocument!.service as { serviceEndpoint: string }[])[0].serviceEndpoint, 'https://example.org');
    update(c, { d: [{ service: [{ id: `${c.did}#home` }] }], vm: [{ i: 1 }] });
    const last = (await resolve(c.did, c.chain)).didDocument!;
    assert.equal(last.service, undefined);
    assert.equal((last.verificationMethod as unknown[]).length, 1);
  });

  it('resolves earlier versions by versionId and versionTime', async () => {
    const c = createDid();
    const before = (await resolve(c.did, c.chain)).didDocument;
    update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
    const v0 = await resolve(c.did, c.chain, { versionId: '0' });
    assert.deepEqual(v0.didDocument!.verificationMethod, before!.verificationMethod);
    assert.equal(v0.didDocumentMetadata.nextVersionId, '1');
    const created = Date.parse(v0.didDocumentMetadata.created as string);
    const byTime = await resolve(c.did, c.chain, { versionTime: new Date(created + 1000).toISOString().replace(/\.\d+Z$/, 'Z') });
    assert.equal(byTime.didDocumentMetadata.versionId, '0');
    assert.equal(errorTitle(await resolve(c.did, c.chain, { versionId: '7' })), 'notFound');
    assert.equal(errorTitle(await resolve(c.did, c.chain, { versionId: '0', versionTime: '2026-01-01T00:00:00Z' })), 'invalidOptions');
  });

  it('follows a controller rotation to the new DID UTXO key', async () => {
    const c = createDid();
    const rotated = new TaprootSigner(secret(9));
    update(c, { a: [{ alsoKnownAs: ['https://example.com/me'] }] }, rotated);
    const doc = (await resolve(c.did, c.chain)).didDocument!;
    assert.equal(doc.controller, controllerOf(rotated));
    assert.deepEqual(doc.alsoKnownAs, ['https://example.com/me']);
  });

  it('ignores an invalid update but keeps following the DID UTXO', async () => {
    const c = createDid();
    update(c, { vm: [{ i: 5 }] }); // index out of range: whole update is ignored
    update(c, { a: [{ id: 'did:example:hijack' }] }); // reserved property
    update(c, { a: [{ alsoKnownAs: ['https://example.com'] }] }); // valid
    const r = await resolve(c.did, c.chain);
    assert.equal(r.didDocument!.id, c.did);
    assert.deepEqual(r.didDocument!.alsoKnownAs, ['https://example.com']);
    assert.equal(r.didDocumentMetadata.versionId, '1');
    const ignored = (r.didDocumentMetadata.btc as { ignoredUpdates: { reason: string }[] }).ignoredUpdates;
    assert.equal(ignored.length, 2);
    assert.match(ignored[0].reason, /out of range/);
    assert.match(ignored[1].reason, /reserved/);
  });

  it('splits payloads over 520 bytes into several pushes and reassembles them', async () => {
    const c = createDid();
    const services = Array.from({ length: 12 }, (_, i) => ({ id: `${c.did}#s${i}`, type: 'LinkedDomains', serviceEndpoint: `https://service-${i}.example.com/some/long/path` }));
    const { reveal } = update(c, { a: [{ service: services }] });
    assert.ok(reveal.ins[0].witness[1].length > 1000);
    assert.equal(((await resolve(c.did, c.chain)).didDocument!.service as unknown[]).length, 12);
  });
});

describe('deactivate', () => {
  it('returns no document and deactivated metadata after the DID UTXO is spent to OP_RETURN "d"', async () => {
    const c = createDid();
    update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
    const tx = deactivate(c);
    const r = await resolve(c.did, c.chain);
    assert.equal(r.didDocument, null);
    assert.equal(r.didResolutionMetadata.error, undefined);
    assert.equal(r.didDocumentMetadata.deactivated, true);
    assert.equal(r.didDocumentMetadata.versionId, '2');
    assert.equal((r.didDocumentMetadata.btc as { versionTxid: string }).versionTxid, tx.getId());
    // history stays readable
    const v1 = await resolve(c.did, c.chain, { versionId: '1' });
    assert.ok(v1.didDocument);
    assert.equal(v1.didDocumentMetadata.nextVersionId, '2');
  });

  it('ignores a deactivation-looking transaction that does not spend the DID UTXO', async () => {
    const c = createDid();
    const stranger = new TaprootSigner(secret(50));
    const funding = c.chain.fund(stranger);
    c.chain.mine([buildDeactivateTx({ didUtxo: funding, controller: stranger })]);
    const r = await resolve(c.did, c.chain);
    assert.ok(r.didDocument);
    assert.equal(r.didDocumentMetadata.deactivated, undefined);
  });

  it('treats a plain key-path move of the DID UTXO as a controller transfer, not a new version', async () => {
    const c = createDid();
    const next = new TaprootSigner(secret(77));
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(Uint8Array.from(Buffer.from(c.didUtxo.txid, 'hex')).reverse(), c.didUtxo.vout);
    tx.addOutput(next.outputScript, c.didUtxo.value - 500n);
    c.controller.signKeyPath(tx, 0, [c.controller.outputScript], [c.didUtxo.value]);
    c.chain.mine([tx]);
    const r = await resolve(c.did, c.chain);
    assert.equal(r.didDocumentMetadata.versionId, '0');
    assert.equal(r.didDocument!.controller, controllerOf(next));
  });
});

it('keeps historical controller state stable after a later key-path transfer', async () => {
  const c = createDid();
  update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
  const before = await resolve(c.did, c.chain);
  const next = new TaprootSigner(secret(88));
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(Uint8Array.from(Buffer.from(c.didUtxo.txid, 'hex')).reverse(), 0);
  tx.addOutput(next.outputScript, c.didUtxo.value - 500n);
  c.controller.signKeyPath(tx, 0, [c.controller.outputScript], [c.didUtxo.value]);
  c.chain.mine([tx]);
  const historical = await resolve(c.did, c.chain, { versionTime: String(before.didDocumentMetadata.updated) });
  assert.equal(historical.didDocument?.controller, before.didDocument?.controller);
  const byId = await resolve(c.did, c.chain, { versionId: '1' });
  assert.equal(byId.didDocument?.controller, before.didDocument?.controller);
  const current = await resolve(c.did, c.chain);
  assert.notEqual(current.didDocument?.controller, before.didDocument?.controller);
  const afterTransfer = new Date(c.chain.time * 1000).toISOString();
  assert.equal((await resolve(c.did, c.chain, { versionTime: afterTransfer })).didDocument?.controller,
    current.didDocument?.controller);
});

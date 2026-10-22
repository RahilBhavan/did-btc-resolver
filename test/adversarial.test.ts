// Tampered data, wrong keys and replays. The chain source is treated as untrusted throughout.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'bitcoinjs-lib';
import { buildUpdateTxs, TaprootSigner } from '../src/creator.ts';
import { resolve } from '../src/resolver.ts';
import { checkPresentedDocument } from '../src/vc.ts';
import { createDid, edKey, secret, TamperingSource, update } from './support/scenario.ts';

const internal = (r: Awaited<ReturnType<typeof resolve>>) => {
  assert.equal(r.didDocument, null);
  assert.equal(r.didResolutionMetadata.error?.title, 'internalError');
  return r.didResolutionMetadata.error!.detail;
};

describe('tampered chain data', () => {
  it('detects a reveal witness whose update JSON was edited (txid unchanged)', async () => {
    const c = createDid();
    const { reveal } = update(c, { a: [{ alsoKnownAs: ['https://alice.example'] }] });
    const tampered = Transaction.fromHex(reveal.toHex());
    const leaf = Buffer.from(tampered.ins[0].witness[1]);
    const at = leaf.indexOf('alice');
    leaf.write('mallo', at);
    tampered.ins[0].witness[1] = leaf;
    assert.equal(tampered.getId(), reveal.getId(), 'witness edits do not change the txid');
    const source = new TamperingSource(c.chain);
    source.txOverrides.set(reveal.getId(), tampered.toHex());
    assert.match(internal(await resolve(c.did, source)), /not committed to by the spent output key/);
  });

  it('detects a swapped leaf that is re-committed but signed by nobody', async () => {
    const c = createDid();
    const { reveal } = update(c, { a: [{ alsoKnownAs: ['https://alice.example'] }] });
    const tampered = Transaction.fromHex(reveal.toHex());
    tampered.ins[0].witness[0] = new Uint8Array(64).fill(7);
    const source = new TamperingSource(c.chain);
    source.txOverrides.set(reveal.getId(), tampered.toHex());
    assert.match(internal(await resolve(c.did, source)), /signature does not verify/);
  });

  it('detects edited creation bytes', async () => {
    const c = createDid();
    const raw = Buffer.from(c.createTx.toHex(), 'hex');
    const keyAt = raw.indexOf(Buffer.from(c.subject.publicKey.bytes));
    raw[keyAt] ^= 0xff;
    const source = new TamperingSource(c.chain);
    source.txOverrides.set(c.createTx.getId(), raw.toString('hex'));
    assert.match(internal(await resolve(c.did, source)), /do not hash to/);
  });

  it('detects a substituted transaction list for the creation block', async () => {
    const c = createDid();
    const blockHash = (await c.chain.blockHashAt(c.chain.positionOf(c.createTx.getId()).blockHeight))!;
    const block = (await c.chain.block(blockHash))!;
    const source = new TamperingSource(c.chain);
    source.txidListOverride = { blockHash, txids: [...block.txids].reverse() };
    assert.match(internal(await resolve(c.did, source)), /merkle root/);
  });

  it('flags a DID document copy whose key was swapped', async () => {
    const c = createDid();
    const doc = structuredClone((await resolve(c.did, c.chain)).didDocument!) as unknown as Record<string, unknown> & { verificationMethod: { publicKeyMultibase: string }[] };
    assert.deepEqual(await checkPresentedDocument(doc, c.chain), { verified: true });
    doc.verificationMethod[0].publicKeyMultibase = edKey(66).multikey;
    const check = await checkPresentedDocument(doc, c.chain);
    assert.equal(check.verified, false);
    assert.match(check.reason!, /differs from the on-chain version 0/);
  });
});

describe('wrong key', () => {
  it('rejects an update spent with a key other than the DID UTXO key', async () => {
    const c = createDid();
    const thief = new TaprootSigner(secret(13));
    // The thief builds a well-formed commit/reveal but signs the DID UTXO spend with their own key.
    // Bitcoin consensus would reject it; a lying source could still serve it, so the resolver checks.
    const { commit, reveal } = buildUpdateTxs({ didUtxo: c.didUtxo, controller: thief, update: { vm: [{ i: 0, k: edKey(13).multikey }] } });
    c.chain.mine([commit, reveal]);
    assert.match(internal(await resolve(c.did, c.chain)), /key-path signature does not verify against the DID UTXO key/);
  });
});

describe('replay', () => {
  it('ignores an old update envelope re-inscribed in a transaction that does not spend the DID UTXO', async () => {
    const c = createDid();
    const rotate = { vm: [{ i: 0, k: edKey(1).multikey }] };
    update(c, rotate);
    update(c, { vm: [{ i: 0, k: edKey(2).multikey }] });
    // Attacker replays the first update payload with their own coins.
    const attacker = new TaprootSigner(secret(31));
    const funding = c.chain.fund(attacker);
    const { commit, reveal } = buildUpdateTxs({ didUtxo: funding, controller: attacker, update: rotate });
    c.chain.mine([commit, reveal]);
    const doc = (await resolve(c.did, c.chain)).didDocument!;
    assert.equal((doc.verificationMethod as { publicKeyMultibase: string }[])[0].publicKeyMultibase, edKey(2).multikey);
  });

  it('rejects a source that replays an old update transaction as the spender of the current DID UTXO', async () => {
    const c = createDid();
    const first = update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
    update(c, { vm: [{ i: 0, k: edKey(2).multikey }] });
    const source = new TamperingSource(c.chain);
    // Claim the v1 commit spends the *v1 reveal* output, i.e. replay history in a loop.
    const blockHash = c.chain.blocks[c.chain.positionOf(first.commit.getId()).blockHeight].hash;
    source.spenderOverrides.set(`${first.reveal.getId()}:0`, { txid: first.commit.getId(), blockHash });
    assert.match(internal(await resolve(c.did, source)), /does not spend/);
  });

  it('rejects a source that names a spender in a block that does not contain it', async () => {
    const c = createDid();
    const { reveal } = update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
    const source = new TamperingSource(c.chain);
    source.spenderOverrides.set(`${c.createTx.getId()}:1`, { txid: reveal.getId(), blockHash: c.chain.blocks[1].hash });
    assert.match(internal(await resolve(c.did, source)), /is not in the block/);
  });

  it('flags a stale copy of the DID document after an update', async () => {
    const c = createDid();
    const old = (await resolve(c.did, c.chain)).didDocument!;
    update(c, { vm: [{ i: 0, k: edKey(1).multikey }] });
    const check = await checkPresentedDocument(old, c.chain);
    assert.equal(check.verified, false);
    assert.match(check.reason!, /on-chain version 1/);
  });
});

// Resolves the DID published as the worked example in the did:btc spec (§Create), from testnet3 data
// recorded from https://blockstream.info/testnet/api by scripts/record-fixture.ts.
// Set DID_BTC_LIVE=1 to resolve it against the live API as well.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from '../src/resolver.ts';
import { EsploraSource, FixtureSource, type Recording } from '../src/sources.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spec-example-testnet.json', import.meta.url), 'utf8')) as {
  did: string;
  recording: Recording;
};
const DID = 'did:btc:test:xuh5-ayyy-q3q0-kp0';

describe('did:btc spec example on testnet3', () => {
  it('resolves from the recorded chain data with header, merkle and txid checks', async () => {
    const r = await resolve(DID, new FixtureSource(fixture.recording));
    assert.equal(r.didResolutionMetadata.error, undefined);
    const meta = r.didDocumentMetadata as { created: string; btc: { createTxid: string; blockHeight: number; txIndex: number } };
    // Values stated in the spec: tx 5acfba9c…b961, block 2582910, index 132, key ab96ce26…3053 (ed25519).
    assert.equal(meta.btc.createTxid, '5acfba9c13bd92c27e9aa8b8cd75d03730571b2dfcc7f81543e9c15cc1efb961');
    assert.equal(meta.btc.blockHeight, 2582910);
    assert.equal(meta.btc.txIndex, 132);
    assert.equal(meta.created, '2024-03-21T15:05:58Z');
    const vm = (r.didDocument!.verificationMethod as { publicKeyMultibase: string }[])[0];
    assert.equal(vm.publicKeyMultibase, 'z6Mkr158mX63UMtTWm42jNbkhExBcVqJWwg5uo9vbyoBHGFk');
    // Flags byte 0x03 -> authentication + assertionMethod.
    assert.deepEqual(r.didDocument!.authentication, [`${DID}#key-0`]);
    assert.deepEqual(r.didDocument!.assertionMethod, [`${DID}#key-0`]);
  });

  it('fails verification if the recorded transaction list is altered', async () => {
    const tampered = structuredClone(fixture.recording);
    const block = Object.values(tampered.blocks)[0];
    [block.txids[1], block.txids[2]] = [block.txids[2], block.txids[1]];
    const r = await resolve(DID, new FixtureSource(tampered));
    assert.match(r.didResolutionMetadata.error!.detail, /merkle root/);
  });

  it('resolves against the live Esplora API', { skip: !process.env.DID_BTC_LIVE }, async () => {
    const r = await resolve(DID, new EsploraSource('https://blockstream.info/testnet/api', 'testnet'));
    assert.equal((r.didDocumentMetadata.btc as { txIndex: number }).txIndex, 132);
  });
});

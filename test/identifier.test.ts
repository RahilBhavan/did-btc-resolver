import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDidBtc, InvalidDidError, parseDidBtc } from '../src/did.ts';
import { decodeTxRef, encodeTxRef } from '../src/txref.ts';

// BIP-136 appendix test vectors: https://github.com/bitcoin/bips/blob/master/bip-0136.mediawiki
const VECTORS: [string, 'mainnet' | 'testnet', number, number, number | undefined][] = [
  ['tx1:rqqq-qqqq-qwtv-vjr', 'mainnet', 0x0, 0x0, undefined],
  ['tx1:rqqq-qqll-lj68-7n2', 'mainnet', 0x0, 0x7fff, undefined],
  ['tx1:r7ll-llqq-qats-vx9', 'mainnet', 0xffffff, 0x0, undefined],
  ['tx1:r7ll-llll-lp6m-78v', 'mainnet', 0xffffff, 0x7fff, undefined],
  ['tx1:r29u-mqjx-putt-3p0', 'mainnet', 456789, 1234, undefined],
  ['txtest1:xqqq-qqqq-qrrd-ksa', 'testnet', 0x0, 0x0, undefined],
  ['txtest1:x7ll-llll-lvj6-y9j', 'testnet', 0xffffff, 0x7fff, undefined],
  ['tx1:y29u-mqjx-ppqq-sfp2-tt', 'mainnet', 456789, 1234, 1],
  ['tx1:y7ll-llll-lpqq-s4qz-hw', 'mainnet', 0xffffff, 0x7fff, 1],
  ['txtest1:829u-mqjx-ppqq-73wp-gv', 'testnet', 456789, 1234, 1],
  ['txtest1:87ll-llll-lpqq-7d0f-5f', 'testnet', 0xffffff, 0x7fff, 1],
];

describe('BIP-136 TxRef', () => {
  for (const [ref, network, blockHeight, txIndex, outpoint] of VECTORS) {
    it(`round-trips ${ref}`, () => {
      const data = ref.split(':')[1];
      assert.deepEqual(decodeTxRef(data), { network, blockHeight, txIndex, ...(outpoint === undefined ? {} : { outpoint }) });
      assert.equal(encodeTxRef({ network, blockHeight, txIndex, outpoint }), data);
    });
  }

  it('rejects the BIP-136 invalid vectors', () => {
    for (const bad of ['t7ll-llll-lcq3-aj4', 'rlll-llll-lu9m-00x', 'r7ll-llll-lqfu-gss2', 'r7ll-llll-rt5h-wz', 'r7ll-LLLL-lp6m-78v']) {
      assert.throws(() => decodeTxRef(bad), Error, bad);
    }
  });

  it('round-trips regtest references', () => {
    const data = encodeTxRef({ network: 'regtest', blockHeight: 105, txIndex: 1 });
    assert.equal(data[0], 'q');
    assert.deepEqual(decodeTxRef(data), { network: 'regtest', blockHeight: 105, txIndex: 1 });
  });
});

describe('did:btc identifiers', () => {
  it('decodes the example DIDs from the did:btc spec', () => {
    // Spec §Create: testnet block 2582910, tx index 132
    assert.deepEqual(parseDidBtc('did:btc:test:xuh5-ayyy-q3q0-kp0'), {
      did: 'did:btc:test:xuh5-ayyy-q3q0-kp0', network: 'testnet', blockHeight: 2582910, txIndex: 132, didIndex: 0,
    });
    // Spec §Batch Create table: block 2575424, tx 1295, DID indexes 0..2
    assert.equal(formatDidBtc('testnet', 2575424, 1295, 0), 'did:btc:test:xqyx-ay0g-pxhg-hvu');
    assert.equal(formatDidBtc('testnet', 2575424, 1295, 1), 'did:btc:test:8qyx-ay0g-ppqq-9x6q-s0');
    assert.equal(formatDidBtc('testnet', 2575424, 1295, 2), 'did:btc:test:8qyx-ay0g-pzqq-rqps-jw');
    assert.equal(parseDidBtc('did:btc:test:8qyx-ay0g-pzqq-rqps-jw').didIndex, 2);
  });

  it('rejects malformed DIDs', () => {
    const bad = [
      '',
      'did:btc:',
      'did:btc:test:',
      'did:web:example.com',
      'did:btco:1954913028215432',
      'DID:BTC:test:xuh5-ayyy-q3q0-kp0',
      'did:btc:test:XUH5-AYYY-Q3Q0-KP0',
      'did:btc:test:xuh5ayyyq3q0kp0', // hyphen grouping is required
      'did:btc:test:xuh5-ayyy-q3q0-kp1', // checksum
      'did:btc:test:xuh5-ayyy-q3q0', // truncated
      'did:btc:test:xuh5-ayyy-q3q0-kp0#key-0', // DID URL, not a DID
      'did:btc:main:xuh5-ayyy-q3q0-kp0',
      'did:btc:test:r29u-mqjx-putt-3p0', // mainnet TxRef under the test prefix
      'did:btc:xg4x-ay5y-q5zq-232', // the spec's own syntax example: testnet TxRef under the mainnet prefix
      'did:btc:test:8qyx-ay0g-pqqq-xxxx', // bad checksum, extended
    ];
    for (const did of bad) assert.throws(() => parseDidBtc(did), InvalidDidError, did);
  });

  it('rejects a non-canonical extended TxRef for DID index 0', () => {
    const extendedZero = 'did:btc:test:' + encodeTxRef({ network: 'testnet', blockHeight: 2575424, txIndex: 1295, outpoint: 0 });
    assert.throws(() => parseDidBtc(extendedZero), /non-canonical/);
  });

  it('rejects the obsolete Bech32 checksum with a specific message', async () => {
    const { bech32 } = await import('@scure/base');
    const words = [6, 28, 23, 20, 29, 4, 4, 4, 0];
    const legacy = bech32.encode('txtest', words).slice('txtest1'.length).match(/.{1,4}/g)!.join('-');
    assert.throws(() => parseDidBtc(`did:btc:test:${legacy}`), /obsolete Bech32/);
  });
});

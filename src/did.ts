// did:btc identifier syntax: did:btc[:test]:<BIP-136 TxRef data part>
// Method spec: https://microstrategy.github.io/did-btc-spec/ (repo commit 2c45a85, 2024-08-22; read 2026-10-21)
import { decodeTxRef, encodeTxRef, TxRefError, type TxRefNetwork } from './txref.ts';

export interface DidBtc {
  did: string;
  network: TxRefNetwork;
  blockHeight: number;
  txIndex: number;
  /** Position of the key inside a batch creation payload; 0 for a single-DID creation. */
  didIndex: number;
}

export class InvalidDidError extends Error {}

const DID_PATTERN = /^did:btc:(test:)?([^:]+)$/;

export function parseDidBtc(did: string): DidBtc {
  if (typeof did !== 'string') throw new InvalidDidError('DID must be a string');
  const match = DID_PATTERN.exec(did);
  if (!match) throw new InvalidDidError(`not a did:btc identifier: ${JSON.stringify(did)}`);
  const [, testPrefix, suffix] = match;
  let ref;
  try {
    ref = decodeTxRef(suffix);
  } catch (err) {
    if (err instanceof TxRefError) throw new InvalidDidError(err.message);
    throw err;
  }
  const isTestPrefix = testPrefix !== undefined;
  if (isTestPrefix === (ref.network === 'mainnet')) {
    // e.g. the spec's own "did:btc:xg4x-ay5y-q5zq-232" carries a testnet TxRef under the mainnet prefix
    throw new InvalidDidError(`TxRef network "${ref.network}" does not match the DID prefix`);
  }
  if (ref.outpoint === 0) {
    // DID index 0 has one canonical form: the plain (non-extended) TxRef, as in the spec's batch table.
    throw new InvalidDidError('non-canonical TxRef: DID index 0 must use the plain TxRef form');
  }
  return {
    did,
    network: ref.network,
    blockHeight: ref.blockHeight,
    txIndex: ref.txIndex,
    didIndex: ref.outpoint ?? 0,
  };
}

export function formatDidBtc(network: TxRefNetwork, blockHeight: number, txIndex: number, didIndex = 0): string {
  const suffix = encodeTxRef({ network, blockHeight, txIndex, outpoint: didIndex === 0 ? undefined : didIndex });
  return `did:btc:${network === 'mainnet' ? '' : 'test:'}${suffix}`;
}

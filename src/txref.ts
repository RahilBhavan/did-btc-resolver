// BIP-136 TxRef: a Bech32m encoding of (block height, tx index, optional outpoint).
// Spec: https://github.com/bitcoin/bips/blob/master/bip-0136.mediawiki (read 2026-10-21)
import { bech32, bech32m } from '@scure/base';

export type TxRefNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface TxRef {
  network: TxRefNetwork;
  blockHeight: number;
  txIndex: number;
  /** Present only for extended ("with outpoint") TxRefs. */
  outpoint?: number;
}

const HRP: Record<TxRefNetwork, string> = { mainnet: 'tx', testnet: 'txtest', regtest: 'txrt' };
const MAGIC: Record<TxRefNetwork, [plain: number, extended: number]> = {
  mainnet: [3, 4],
  testnet: [6, 7],
  regtest: [0, 1],
};
const MAX_HEIGHT = 0xffffff;
const MAX_INDEX = 0x7fff;

export class TxRefError extends Error {}

function magicToNetwork(magic: number): { network: TxRefNetwork; extended: boolean } {
  for (const [network, [plain, extended]] of Object.entries(MAGIC) as [TxRefNetwork, [number, number]][]) {
    if (magic === plain) return { network, extended: false };
    if (magic === extended) return { network, extended: true };
  }
  throw new TxRefError(`unknown TxRef magic code ${magic}`);
}

function checkRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new TxRefError(`${name} ${value} is outside 0..${max}`);
  }
}

/** Encodes the data part only (no HRP, no "1:" separator), hyphenated every 4 characters. */
export function encodeTxRef({ network, blockHeight, txIndex, outpoint }: TxRef): string {
  checkRange('block height', blockHeight, MAX_HEIGHT);
  checkRange('tx index', txIndex, MAX_INDEX);
  const extended = outpoint !== undefined;
  if (extended) checkRange('outpoint', outpoint, MAX_INDEX);
  const words = [
    MAGIC[network][extended ? 1 : 0],
    ((blockHeight & 0xf) << 1) | 0, // version bit 0
    (blockHeight >> 4) & 0x1f,
    (blockHeight >> 9) & 0x1f,
    (blockHeight >> 14) & 0x1f,
    (blockHeight >> 19) & 0x1f,
    txIndex & 0x1f,
    (txIndex >> 5) & 0x1f,
    (txIndex >> 10) & 0x1f,
  ];
  if (extended) words.push(outpoint & 0x1f, (outpoint >> 5) & 0x1f, (outpoint >> 10) & 0x1f);
  const full = bech32m.encode(HRP[network], words, 200);
  const data = full.slice(HRP[network].length + 1);
  return data.match(/.{1,4}/g)!.join('-');
}

/**
 * Decodes a TxRef data part ("xuh5-ayyy-q3q0-kp0"). Hyphens are the only separator accepted:
 * BIP-136 asks parsers to be lenient with user input, but a DID is an identifier, so this
 * parser is strict and rejects anything that is not lowercase bech32 plus hyphens.
 * Legacy Bech32 (pre-BIP-350) checksums are rejected; see docs/spec-notes.md.
 */
export function decodeTxRef(data: string): TxRef {
  if (!/^[02-9ac-hj-np-z]{4}(-[02-9ac-hj-np-z]{1,4})+$/.test(data)) {
    throw new TxRefError('TxRef must be lowercase bech32 characters grouped by hyphens');
  }
  const compact = data.replaceAll('-', '');
  const magicChar = compact[0];
  const magic = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.indexOf(magicChar);
  const { network, extended } = magicToNetwork(magic);
  let words: number[];
  try {
    words = Array.from(bech32m.decode(`${HRP[network]}1${compact}` as `${string}1${string}`, 200).words);
  } catch (err) {
    try {
      bech32.decode(`${HRP[network]}1${compact}` as `${string}1${string}`, 200);
      throw new TxRefError('TxRef uses the obsolete Bech32 checksum; BIP-136 requires Bech32m');
    } catch (inner) {
      if (inner instanceof TxRefError) throw inner;
      throw new TxRefError(`invalid TxRef checksum: ${(err as Error).message}`);
    }
  }
  const expected = extended ? 12 : 9;
  if (words.length !== expected) throw new TxRefError(`TxRef has ${words.length} data characters, expected ${expected}`);
  if ((words[1] & 1) !== 0) throw new TxRefError('unsupported TxRef version');
  const blockHeight =
    (words[1] >> 1) | (words[2] << 4) | (words[3] << 9) | (words[4] << 14) | (words[5] << 19);
  const txIndex = words[6] | (words[7] << 5) | (words[8] << 10);
  const ref: TxRef = { network, blockHeight, txIndex };
  if (extended) ref.outpoint = words[9] | (words[10] << 5) | (words[11] << 10);
  return ref;
}

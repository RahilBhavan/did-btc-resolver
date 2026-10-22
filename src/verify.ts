// Consistency checks on chain-source answers (the source remains chain authority):
//  - block header hashes to the claimed block hash and meets its own proof-of-work target;
//  - the txid list hashes to the header's merkle root, and the tx sits at the claimed index;
//  - raw transaction bytes hash to the claimed txid;
//  - a claimed spender really spends the outpoint;
//  - the taproot witness that carries an update commits to the DID UTXO's output key (BIP-341)
//    and its Schnorr signatures verify (BIP-340). The txid does not commit to witness data, so
//    this is what makes a tampered update payload detectable.
// Not checked: that the block is on the most-work chain (the source chooses the chain).
import { crypto as bcrypto, initEccLib, Transaction } from 'bitcoinjs-lib';
import { fastMerkleRoot } from 'bitcoinjs-lib/src/merkle';
import { rootHashFromPath, tapleafHash, tweakKey } from 'bitcoinjs-lib/src/payments/bip341';
import * as ecc from 'tiny-secp256k1';
import type { BlockInfo, ChainSource } from './chain.ts';
import { p2trOutputKey, scriptPathParts } from './protocol.ts';

initEccLib(ecc);

export class ChainDataError extends Error {}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const reversedHex = (b: Uint8Array) => hex(Uint8Array.from(b).reverse());
const fromReversedHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex')).reverse();
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface VerifiedBlock {
  hash: string;
  height: number;
  time: number;
  txids: string[];
}

export function verifyBlock(block: BlockInfo, expectedHash: string): VerifiedBlock {
  if (block.hash !== expectedHash) throw new ChainDataError('source returned a different block');
  const header = Buffer.from(block.header, 'hex');
  if (header.length !== 80) throw new ChainDataError('block header must be 80 bytes');
  if (reversedHex(bcrypto.hash256(header)) !== expectedHash) throw new ChainDataError('block header does not hash to the block hash');
  const bits = header.readUInt32LE(72);
  const target = BigInt(bits & 0xffffff) << (8n * BigInt((bits >>> 24) - 3));
  if (BigInt('0x' + expectedHash) > target) throw new ChainDataError('block hash does not meet its proof-of-work target');
  if (block.txids.length === 0) throw new ChainDataError('block has no transactions');
  const root = fastMerkleRoot(block.txids.map(fromReversedHex), bcrypto.hash256);
  if (!equal(root, header.subarray(36, 68))) throw new ChainDataError('transaction list does not match the header merkle root');
  return { hash: expectedHash, height: block.height, time: header.readUInt32LE(68), txids: block.txids };
}

export function parseVerifiedTx(rawHex: string, expectedTxid: string): Transaction {
  let tx: Transaction;
  try {
    tx = Transaction.fromHex(rawHex);
  } catch {
    throw new ChainDataError(`transaction ${expectedTxid} is not valid serialization`);
  }
  if (tx.getId() !== expectedTxid) throw new ChainDataError(`transaction bytes do not hash to ${expectedTxid}`);
  return tx;
}

export async function fetchVerifiedTx(source: ChainSource, txid: string): Promise<Transaction> {
  const raw = await source.transaction(txid);
  if (raw === null) throw new ChainDataError(`source does not have transaction ${txid}`);
  return parseVerifiedTx(raw, txid);
}

export async function fetchVerifiedBlock(source: ChainSource, hash: string): Promise<VerifiedBlock> {
  const block = await source.block(hash);
  if (!block) throw new ChainDataError(`source does not have block ${hash}`);
  return verifyBlock(block, hash);
}

/** Index of the input in `tx` that spends txid:vout, or -1. */
export function inputSpending(tx: Transaction, txid: string, vout: number): number {
  return tx.ins.findIndex((i) => reversedHex(i.hash) === txid && i.index === vout);
}

function splitSig(sig: Uint8Array): { sig: Uint8Array; hashType: number } {
  if (sig.length === 64) return { sig, hashType: Transaction.SIGHASH_DEFAULT };
  if (sig.length === 65 && sig[64] !== 0) return { sig: sig.subarray(0, 64), hashType: sig[64] };
  throw new ChainDataError('invalid Schnorr signature encoding');
}

async function prevouts(source: ChainSource, tx: Transaction): Promise<{ scripts: Uint8Array[]; values: bigint[] }> {
  const scripts: Uint8Array[] = [];
  const values: bigint[] = [];
  for (const input of tx.ins) {
    const prev = await fetchVerifiedTx(source, reversedHex(input.hash));
    const out = prev.outs[input.index];
    if (!out) throw new ChainDataError('input spends a missing output');
    scripts.push(out.script);
    values.push(out.value);
  }
  return { scripts, values };
}

export type SpendKind = { kind: 'keyPath' } | { kind: 'scriptPath'; leaf: Uint8Array; leafSignatureVerified: boolean };

/**
 * Verifies the taproot spend of input `index` against the output key of the output it spends.
 * Returns which spend path was used, and the leaf script for script-path spends.
 */
export async function verifyTaprootSpend(source: ChainSource, tx: Transaction, index: number): Promise<SpendKind> {
  const { scripts, values } = await prevouts(source, tx);
  const outputKey = p2trOutputKey(scripts[index]);
  if (!outputKey) throw new ChainDataError('spent output is not pay-to-taproot');
  const witness = tx.ins[index].witness;
  const hasAnnex = witness.length >= 2 && witness[witness.length - 1][0] === 0x50;
  const annex = hasAnnex ? witness[witness.length - 1] : undefined;
  const items = hasAnnex ? witness.slice(0, -1) : witness;

  if (items.length === 1) {
    const { sig, hashType } = splitSig(items[0]);
    const sighash = tx.hashForWitnessV1(index, scripts, values, hashType, undefined, annex);
    if (!ecc.verifySchnorr(sighash, outputKey, sig)) throw new ChainDataError('key-path signature does not verify against the DID UTXO key');
    return { kind: 'keyPath' };
  }

  const parts = scriptPathParts(witness);
  if (!parts) throw new ChainDataError('malformed taproot witness');
  const { leaf, controlBlock, stack } = parts;
  if (controlBlock.length < 33 || (controlBlock.length - 33) % 32 !== 0) throw new ChainDataError('malformed control block');
  const leafVersion = controlBlock[0] & 0xfe;
  const leafHash = tapleafHash({ output: leaf, version: leafVersion });
  const root = rootHashFromPath(controlBlock, leafHash);
  const tweaked = tweakKey(controlBlock.subarray(1, 33), root);
  if (!tweaked || !equal(tweaked.x, outputKey) || tweaked.parity !== (controlBlock[0] & 1)) {
    throw new ChainDataError('taproot leaf script is not committed to by the spent output key');
  }
  // Our envelope leaves are "<key> OP_CHECKSIG ...": the single stack item is a signature for <key>.
  const leafKey = leaf.subarray(1, 33);
  let leafSignatureVerified = false;
  if (leaf.length > 34 && leaf[0] === 0x20 && leaf[33] === 0xac && stack.length === 1) {
    const { sig, hashType } = splitSig(stack[0]);
    const sighash = tx.hashForWitnessV1(index, scripts, values, hashType, leafHash, annex);
    if (!ecc.verifySchnorr(sighash, leafKey, sig)) throw new ChainDataError('script-path signature does not verify against the leaf key');
    leafSignatureVerified = true;
  }
  return { kind: 'scriptPath', leaf, leafSignatureVerified };
}

export { reversedHex };

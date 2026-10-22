// Builds and signs did:btc create / update / deactivate transactions (spec §Create, §Update, §Deactivate).
// Pure functions: they take UTXOs and keys and return signed transactions; broadcasting is the caller's job.
import { initEccLib, payments, Transaction } from 'bitcoinjs-lib';
import { tapleafHash, tapTweakHash } from 'bitcoinjs-lib/src/payments/bip341';
import * as ecc from 'tiny-secp256k1';
import { toMulticodecBytes, type PublicKey } from './multikey.ts';
import { buildCreationScript, buildEnvelopeLeaf, DEACTIVATION_SCRIPT, encodeUpdate, VR, type DidUpdate } from './protocol.ts';

initEccLib(ecc);

export const DUST = 330n;
const LEAF_VERSION = 0xc0;

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
}

/** A secp256k1 key used on chain through a key-path pay-to-taproot output (BIP-86 style, no script tree). */
export class TaprootSigner {
  readonly privateKey: Uint8Array;
  readonly xOnly: Uint8Array;
  constructor(privateKey: Uint8Array) {
    if (!ecc.isPrivate(privateKey)) throw new Error('invalid secp256k1 private key');
    this.privateKey = privateKey;
    this.xOnly = ecc.xOnlyPointFromScalar(privateKey);
  }
  get outputScript(): Uint8Array {
    return payments.p2tr({ internalPubkey: this.xOnly }).output!;
  }
  /** Non-taproot change script (P2WPKH) for when output 1 must not look like a DID UTXO. */
  get p2wpkhScript(): Uint8Array {
    return payments.p2wpkh({ pubkey: ecc.pointFromScalar(this.privateKey, true)! }).output!;
  }
  /** BIP-341 key-path secret: negate to even Y, then add the tweak. */
  tweakedPrivateKey(merkleRoot?: Uint8Array): Uint8Array {
    const even = ecc.pointFromScalar(this.privateKey, true)![0] === 0x02 ? this.privateKey : ecc.privateNegate(this.privateKey);
    return ecc.privateAdd(even, tapTweakHash(this.xOnly, merkleRoot))!;
  }
  signKeyPath(tx: Transaction, index: number, prevScripts: Uint8Array[], values: bigint[]): void {
    const sighash = tx.hashForWitnessV1(index, prevScripts, values, Transaction.SIGHASH_DEFAULT);
    tx.setWitness(index, [ecc.signSchnorr(sighash, this.tweakedPrivateKey())]);
  }
}

const txidBytes = (txid: string) => Uint8Array.from(Buffer.from(txid, 'hex')).reverse();

/** Builds a transaction twice: once to measure its virtual size, once with the matching fee. */
function withFee(build: (fee: bigint) => Transaction, feeRate: number): Transaction {
  const probe = build(0n);
  const fee = BigInt(Math.ceil(probe.virtualSize() * feeRate));
  return build(fee);
}

function requireAbove(value: bigint, what: string): void {
  if (value < DUST) throw new Error(`${what} would be ${value} sats, below the ${DUST}-sat dust limit`);
}

export interface CreateParams {
  funding: Utxo;
  fundingSigner: TaprootSigner;
  subjectKey: PublicKey;
  /** Verification relationship flags for the subject key. Default: authentication | assertionMethod. */
  flags?: number;
  /** Key that will control the DID UTXO. Omit for a final (non-updatable) DID. */
  controller?: TaprootSigner;
  /** Value locked in the DID UTXO. It pays the fees of later updates. */
  didSats?: bigint;
  feeRate?: number;
}

/** Output 0: OP_RETURN "did" | flags | multikey. Output 1: DID UTXO (p2tr), omitted for a final DID. Last: change. */
export function buildCreateTx(p: CreateParams): Transaction {
  const flags = p.flags ?? VR.authentication | VR.assertionMethod;
  const didSats = p.didSats ?? 50_000n;
  const opReturn = buildCreationScript(toMulticodecBytes(p.subjectKey), flags);
  return withFee((fee) => {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(txidBytes(p.funding.txid), p.funding.vout);
    tx.addOutput(opReturn, 0n);
    let spent = 0n;
    if (p.controller) {
      tx.addOutput(p.controller.outputScript, didSats);
      spent = didSats;
    }
    const change = p.funding.value - spent - fee;
    requireAbove(change, 'change');
    // Spec §Create: a p2tr second output *is* the DID UTXO. A final DID's change therefore goes to P2WPKH.
    tx.addOutput(p.controller ? p.fundingSigner.outputScript : p.fundingSigner.p2wpkhScript, change);
    p.fundingSigner.signKeyPath(tx, 0, [p.fundingSigner.outputScript], [p.funding.value]);
    return tx;
  }, p.feeRate ?? 2);
}

export interface UpdateParams {
  didUtxo: Utxo;
  controller: TaprootSigner;
  update: DidUpdate;
  /** Controller of the new DID UTXO (key rotation). Default: same controller. */
  nextController?: TaprootSigner;
  feeRate?: number;
}

/**
 * Commit/reveal pair. The commit spends the DID UTXO (key path) into a taproot output whose script
 * tree holds the envelope leaf; the reveal spends it by script path, exposing the update JSON in the
 * witness, and puts the next DID UTXO at output 0.
 */
export function buildUpdateTxs(p: UpdateParams): { commit: Transaction; reveal: Transaction } {
  const feeRate = p.feeRate ?? 2;
  const leaf = buildEnvelopeLeaf(p.controller.xOnly, encodeUpdate(p.update));
  const commitPayment = payments.p2tr({ internalPubkey: p.controller.xOnly, scriptTree: { output: leaf }, redeem: { output: leaf, redeemVersion: LEAF_VERSION } });
  const [, controlBlock] = commitPayment.witness!;
  const leafHash = tapleafHash({ output: leaf, version: LEAF_VERSION });
  const next = p.nextController ?? p.controller;

  const buildReveal = (commitTxid: string, commitValue: bigint) =>
    withFee((fee) => {
      const tx = new Transaction();
      tx.version = 2;
      tx.addInput(txidBytes(commitTxid), 0);
      const out = commitValue - fee;
      requireAbove(out, 'reveal output');
      tx.addOutput(next.outputScript, out);
      const sighash = tx.hashForWitnessV1(0, [commitPayment.output!], [commitValue], Transaction.SIGHASH_DEFAULT, leafHash);
      tx.setWitness(0, [ecc.signSchnorr(sighash, p.controller.privateKey), leaf, controlBlock]);
      return tx;
    }, feeRate);

  // Size the commit so its output exactly covers the reveal fee.
  const revealProbe = buildReveal('00'.repeat(32), p.didUtxo.value);
  const revealFee = p.didUtxo.value - revealProbe.outs[0].value;
  const commit = withFee((fee) => {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(txidBytes(p.didUtxo.txid), p.didUtxo.vout);
    const value = p.didUtxo.value - fee;
    requireAbove(value - revealFee, 'DID UTXO after update');
    tx.addOutput(commitPayment.output!, value);
    p.controller.signKeyPath(tx, 0, [p.controller.outputScript], [p.didUtxo.value]);
    return tx;
  }, feeRate);
  const reveal = buildReveal(commit.getId(), commit.outs[0].value);
  return { commit, reveal };
}

export interface DeactivateParams {
  didUtxo: Utxo;
  controller: TaprootSigner;
  /** Where the remaining value goes. Default: the controller's key-path output. */
  changeScript?: Uint8Array;
  feeRate?: number;
}

/** Output 0: OP_RETURN "d" (spec §Deactivate). Output 1: remaining value. */
export function buildDeactivateTx(p: DeactivateParams): Transaction {
  return withFee((fee) => {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(txidBytes(p.didUtxo.txid), p.didUtxo.vout);
    tx.addOutput(DEACTIVATION_SCRIPT, 0n);
    const change = p.didUtxo.value - fee;
    requireAbove(change, 'change');
    tx.addOutput(p.changeScript ?? p.controller.outputScript, change);
    p.controller.signKeyPath(tx, 0, [p.controller.outputScript], [p.didUtxo.value]);
    return tx;
  }, p.feeRate ?? 2);
}

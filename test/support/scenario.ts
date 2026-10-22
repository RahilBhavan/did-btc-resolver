import { ed25519 } from '@noble/curves/ed25519.js';
import { Transaction } from 'bitcoinjs-lib';
import type { ChainSource } from '../../src/chain.ts';
import { buildCreateTx, buildDeactivateTx, buildUpdateTxs, TaprootSigner, type Utxo } from '../../src/creator.ts';
import { formatDidBtc } from '../../src/did.ts';
import { encodeMultikey, type PublicKey } from '../../src/multikey.ts';
import type { DidUpdate } from '../../src/protocol.ts';
import { MemoryChain } from './memchain.ts';

/** Deterministic 32-byte secret: 31 zero bytes then n. Test-only keys. */
export const secret = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n : 0));

export function edKey(n: number): { secretKey: Uint8Array; publicKey: PublicKey; multikey: string } {
  const secretKey = secret(100 + n);
  const publicKey: PublicKey = { type: 'ed25519', bytes: ed25519.getPublicKey(secretKey) };
  return { secretKey, publicKey, multikey: encodeMultikey(publicKey) };
}

export interface Created {
  chain: MemoryChain;
  did: string;
  controller: TaprootSigner;
  subject: ReturnType<typeof edKey>;
  didUtxo: Utxo;
  createTx: Transaction;
}

export function createDid(opts: { flags?: number; final?: boolean; confirmations?: number } = {}): Created {
  const chain = new MemoryChain();
  const funder = new TaprootSigner(secret(1));
  const controller = new TaprootSigner(secret(2));
  const subject = edKey(0);
  const funding = chain.fund(funder);
  const createTx = buildCreateTx({ funding, fundingSigner: funder, subjectKey: subject.publicKey, flags: opts.flags, controller: opts.final ? undefined : controller });
  chain.mine([createTx]);
  chain.mineEmpty((opts.confirmations ?? 6) - 1);
  const { blockHeight, txIndex } = chain.positionOf(createTx.getId());
  const did = formatDidBtc('regtest', blockHeight, txIndex);
  return { chain, did, controller, subject, createTx, didUtxo: { txid: createTx.getId(), vout: 1, value: createTx.outs[1].value } };
}

export function update(c: Created, u: DidUpdate, nextController?: TaprootSigner): { commit: Transaction; reveal: Transaction } {
  const txs = buildUpdateTxs({ didUtxo: c.didUtxo, controller: c.controller, update: u, nextController });
  c.chain.mine([txs.commit, txs.reveal]);
  c.didUtxo = { txid: txs.reveal.getId(), vout: 0, value: txs.reveal.outs[0].value };
  if (nextController) c.controller = nextController;
  return txs;
}

export function deactivate(c: Created): Transaction {
  const tx = buildDeactivateTx({ didUtxo: c.didUtxo, controller: c.controller });
  c.chain.mine([tx]);
  return tx;
}

/** A source that returns modified answers for selected calls; everything else passes through. */
export class TamperingSource implements ChainSource {
  readonly network;
  inner: ChainSource;
  txOverrides = new Map<string, string>();
  spenderOverrides = new Map<string, { txid: string; blockHash: string } | null>();
  txidListOverride?: { blockHash: string; txids: string[] };
  constructor(inner: ChainSource) {
    this.inner = inner;
    this.network = inner.network;
  }
  tipHeight() {
    return this.inner.tipHeight();
  }
  blockHashAt(h: number) {
    return this.inner.blockHashAt(h);
  }
  async block(hash: string) {
    const b = await this.inner.block(hash);
    if (b && this.txidListOverride?.blockHash === hash) return { ...b, txids: this.txidListOverride.txids };
    return b;
  }
  async transaction(txid: string) {
    return this.txOverrides.get(txid) ?? this.inner.transaction(txid);
  }
  async spender(txid: string, vout: number) {
    const key = `${txid}:${vout}`;
    return this.spenderOverrides.has(key) ? this.spenderOverrides.get(key)! : this.inner.spender(txid, vout);
  }
}

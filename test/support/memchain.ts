// An in-memory chain with real block headers (regtest difficulty), real merkle roots and real
// signed transactions, so the resolver's verification runs unchanged without a node.
import { Block, Transaction } from 'bitcoinjs-lib';
import type { BlockInfo, ChainSource, Spender } from '../../src/chain.ts';
import type { TaprootSigner, Utxo } from '../../src/creator.ts';

const REGTEST_BITS = 0x207fffff;
const reversedHex = (b: Uint8Array) => Buffer.from(Uint8Array.from(b).reverse()).toString('hex');

export class MemoryChain implements ChainSource {
  readonly network = 'regtest' as const;
  blocks: BlockInfo[] = [];
  txs = new Map<string, string>();
  spends = new Map<string, Spender>();
  time = 1_760_000_000;

  constructor() {
    this.mine([]);
  }

  /** Mines a block holding a coinbase paying `coinbaseTo` (if given) plus the given transactions. */
  mine(txs: Transaction[], coinbaseTo?: TaprootSigner, value = 50_000_000n): BlockInfo {
    const height = this.blocks.length;
    const coinbase = new Transaction();
    coinbase.version = 2;
    coinbase.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Uint8Array.from([0x03, height & 0xff, (height >> 8) & 0xff, (height >> 16) & 0xff]));
    coinbase.addOutput(coinbaseTo ? coinbaseTo.outputScript : Uint8Array.from([0x6a]), coinbaseTo ? value : 0n);
    const all = [coinbase, ...txs];
    const block = new Block();
    block.version = 0x20000000;
    block.prevHash = height === 0 ? new Uint8Array(32) : Uint8Array.from(Buffer.from(this.blocks[height - 1].hash, 'hex')).reverse();
    block.transactions = all;
    block.merkleRoot = Block.calculateMerkleRoot(all);
    block.timestamp = (this.time += 600);
    block.bits = REGTEST_BITS;
    block.nonce = 0;
    while (!block.checkProofOfWork()) block.nonce++;
    const info: BlockInfo = { hash: block.getId(), height, header: block.toHex(true), txids: all.map((t) => t.getId()) };
    this.blocks.push(info);
    for (const tx of all) {
      const txid = tx.getId();
      this.txs.set(txid, tx.toHex());
      if (tx === coinbase) continue;
      for (const input of tx.ins) this.spends.set(`${reversedHex(input.hash)}:${input.index}`, { txid, blockHash: info.hash });
    }
    return info;
  }

  mineEmpty(n: number): void {
    for (let i = 0; i < n; i++) this.mine([]);
  }

  /** Coinbase output usable as funding (maturity is not enforced in memory). */
  fund(signer: TaprootSigner, value = 50_000_000n): Utxo {
    const info = this.mine([], signer, value);
    return { txid: info.txids[0], vout: 0, value };
  }

  positionOf(txid: string): { blockHeight: number; txIndex: number } {
    for (const b of this.blocks) {
      const i = b.txids.indexOf(txid);
      if (i >= 0) return { blockHeight: b.height, txIndex: i };
    }
    throw new Error(`${txid} not mined`);
  }

  async tipHeight() {
    return this.blocks.length - 1;
  }
  async blockHashAt(height: number) {
    return this.blocks[height]?.hash ?? null;
  }
  async block(hash: string) {
    const b = this.blocks.find((x) => x.hash === hash);
    return b ? { ...b, txids: [...b.txids] } : null;
  }
  async transaction(txid: string) {
    return this.txs.get(txid) ?? null;
  }
  async spender(txid: string, vout: number) {
    return this.spends.get(`${txid}:${vout}`) ?? null;
  }
}

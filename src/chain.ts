// The resolver checks response consistency through src/verify.ts. This source still chooses
// the canonical chain, claimed heights and spend completeness; it is a trust boundary.

export interface BlockInfo {
  hash: string;
  height: number;
  /** 80-byte serialized header, hex. */
  header: string;
  /** Transaction ids in block order. */
  txids: string[];
}

export interface Spender {
  txid: string;
  /** Hash of the block that confirmed the spend. Unconfirmed spends are not returned. */
  blockHash: string;
}

export interface ChainSource {
  readonly network: 'mainnet' | 'testnet' | 'regtest';
  tipHeight(): Promise<number>;
  blockHashAt(height: number): Promise<string | null>;
  block(hash: string): Promise<BlockInfo | null>;
  /** Raw transaction hex (with witness), or null if unknown. */
  transaction(txid: string): Promise<string | null>;
  /** The confirmed transaction spending txid:vout, or null if unspent or only spent in the mempool. */
  spender(txid: string, vout: number): Promise<Spender | null>;
}

// ChainSource implementations: Bitcoin Core JSON-RPC, Esplora REST, and a recorded fixture.
import type { BlockInfo, ChainSource, Spender } from './chain.ts';

type Network = ChainSource['network'];

// ---------- Bitcoin Core ----------
// Needs -txindex (getrawtransaction for any tx) and -txospenderindex (gettxspendingprevout for
// confirmed spends). Both options exist in Bitcoin Core 31.1 (checked with `bitcoind -help`, 2026-10-21).

export interface RpcConfig {
  url: string; // e.g. http://127.0.0.1:18443
  user: string;
  password: string;
  wallet?: string;
}

export class BitcoinCoreRpc implements ChainSource {
  readonly network: Network;
  readonly config: RpcConfig;
  private id = 0;

  constructor(config: RpcConfig, network: Network = 'regtest') {
    this.config = config;
    this.network = network;
  }

  async call<T>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
    const url = wallet && this.config.wallet ? `${this.config.url}/wallet/${encodeURIComponent(this.config.wallet)}` : this.config.url;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Basic ' + Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64'),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    const body = (await res.json().catch(() => null)) as { result: T; error: { code: number; message: string } | null } | null;
    if (!body) throw new Error(`RPC ${method}: HTTP ${res.status}`);
    if (body.error) throw Object.assign(new Error(`RPC ${method}: ${body.error.message}`), { code: body.error.code });
    return body.result;
  }

  tipHeight() {
    return this.call<number>('getblockcount');
  }

  async blockHashAt(height: number) {
    try {
      return await this.call<string>('getblockhash', [height]);
    } catch (err) {
      if ((err as { code?: number }).code === -8) return null; // height out of range
      throw err;
    }
  }

  async block(hash: string): Promise<BlockInfo | null> {
    try {
      const header = await this.call<string>('getblockheader', [hash, false]);
      const b = await this.call<{ height: number; tx: string[] }>('getblock', [hash, 1]);
      return { hash, height: b.height, header, txids: b.tx };
    } catch (err) {
      if ((err as { code?: number }).code === -5) return null;
      throw err;
    }
  }

  async transaction(txid: string) {
    try {
      return await this.call<string>('getrawtransaction', [txid, 0]);
    } catch (err) {
      if ((err as { code?: number }).code === -5) return null;
      throw err;
    }
  }

  async spender(txid: string, vout: number): Promise<Spender | null> {
    const [r] = await this.call<{ spendingtxid?: string; blockhash?: string }[]>('gettxspendingprevout', [[{ txid, vout }], { mempool_only: false }]);
    if (!r?.spendingtxid || !r.blockhash) return null;
    return { txid: r.spendingtxid, blockHash: r.blockhash };
  }
}

// ---------- Esplora (Blockstream / mempool.space REST API) ----------
// API: https://github.com/Blockstream/esplora/blob/master/API.md (read 2026-10-21)

export class EsploraSource implements ChainSource {
  readonly network: Network;
  readonly baseUrl: string;
  constructor(baseUrl: string, network: Network) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.network = network;
  }

  private async get(path: string, json: boolean): Promise<unknown> {
    const res = await fetch(this.baseUrl + path);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Esplora ${path}: HTTP ${res.status}`);
    return json ? res.json() : res.text();
  }

  async tipHeight() {
    return Number(await this.get('/blocks/tip/height', false));
  }
  async blockHashAt(height: number) {
    return (await this.get(`/block-height/${height}`, false)) as string | null;
  }
  async block(hash: string): Promise<BlockInfo | null> {
    const meta = (await this.get(`/block/${hash}`, true)) as { height: number } | null;
    if (!meta) return null;
    const header = (await this.get(`/block/${hash}/header`, false)) as string;
    const txids = (await this.get(`/block/${hash}/txids`, true)) as string[];
    return { hash, height: meta.height, header, txids };
  }
  async transaction(txid: string) {
    return (await this.get(`/tx/${txid}/hex`, false)) as string | null;
  }
  async spender(txid: string, vout: number): Promise<Spender | null> {
    const r = (await this.get(`/tx/${txid}/outspend/${vout}`, true)) as { spent: boolean; txid?: string; status?: { confirmed: boolean; block_hash?: string } } | null;
    if (!r?.spent || !r.txid || !r.status?.confirmed || !r.status.block_hash) return null;
    return { txid: r.txid, blockHash: r.status.block_hash };
  }
}

// ---------- Recorded fixture ----------

export interface Recording {
  network: Network;
  source: string;
  recordedAt: string;
  tipHeight: number;
  blockHashes: Record<string, string>;
  blocks: Record<string, BlockInfo>;
  transactions: Record<string, string>;
  spenders: Record<string, Spender | null>;
}

/** Wraps a live source and records every answer, so a resolution can be replayed offline. */
export class RecordingSource implements ChainSource {
  readonly network: Network;
  readonly recording: Recording;
  private inner: ChainSource;
  constructor(inner: ChainSource, sourceLabel: string) {
    this.inner = inner;
    this.network = inner.network;
    this.recording = { network: inner.network, source: sourceLabel, recordedAt: new Date().toISOString(), tipHeight: 0, blockHashes: {}, blocks: {}, transactions: {}, spenders: {} };
  }
  async tipHeight() {
    return (this.recording.tipHeight = await this.inner.tipHeight());
  }
  async blockHashAt(h: number) {
    const v = await this.inner.blockHashAt(h);
    if (v) this.recording.blockHashes[h] = v;
    return v;
  }
  async block(hash: string) {
    const v = await this.inner.block(hash);
    if (v) this.recording.blocks[hash] = v;
    return v;
  }
  async transaction(txid: string) {
    const v = await this.inner.transaction(txid);
    if (v) this.recording.transactions[txid] = v;
    return v;
  }
  async spender(txid: string, vout: number) {
    const v = await this.inner.spender(txid, vout);
    this.recording.spenders[`${txid}:${vout}`] = v;
    return v;
  }
}

export class FixtureSource implements ChainSource {
  readonly network: Network;
  readonly data: Recording;
  constructor(data: Recording) {
    this.data = data;
    this.network = data.network;
  }
  async tipHeight() {
    return this.data.tipHeight;
  }
  async blockHashAt(h: number) {
    return this.data.blockHashes[h] ?? null;
  }
  async block(hash: string) {
    return this.data.blocks[hash] ?? null;
  }
  async transaction(txid: string) {
    return this.data.transactions[txid] ?? null;
  }
  async spender(txid: string, vout: number) {
    const key = `${txid}:${vout}`;
    if (!(key in this.data.spenders)) throw new Error(`fixture has no spender record for ${key}`);
    return this.data.spenders[key];
  }
}

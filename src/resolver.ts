// did:btc resolver (spec §Read) producing a W3C DID resolution result.
// DID Resolution: https://w3c.github.io/did-resolution/ (Candidate Recommendation draft, read 2026-10-21)
import type { Transaction } from 'bitcoinjs-lib';
import type { ChainSource } from './chain.ts';
import { InvalidDidError, parseDidBtc, type DidBtc } from './did.ts';
import { applyUpdate, buildDidDocument, type DidDocument, type DidState } from './document.ts';
import { MultikeyError } from './multikey.ts';
import { isDeactivation, p2trOutputKey, parseCreation, parseEnvelopeLeaf, parseUpdate, ProtocolError } from './protocol.ts';
import { ChainDataError, fetchVerifiedBlock, fetchVerifiedTx, inputSpending, verifyTaprootSpend } from './verify.ts';

export type ErrorType =
  | 'INVALID_DID'
  | 'NOT_FOUND'
  | 'INVALID_OPTIONS'
  | 'FEATURE_NOT_SUPPORTED'
  | 'INTERNAL_ERROR';

export interface ResolutionError {
  type: `https://www.w3.org/ns/did#${ErrorType}`;
  title: string;
  detail: string;
}

export interface ResolutionResult {
  didDocument: DidDocument | null;
  didResolutionMetadata: { contentType?: string; error?: ResolutionError; [k: string]: unknown };
  didDocumentMetadata: Record<string, unknown>;
}

export interface ResolveOptions {
  versionId?: string;
  versionTime?: string;
  /** Confirmations the creation transaction needs before the DID resolves. Spec §Create: 6. */
  minCreateConfirmations?: number;
}

/** One entry per on-chain event that changed the DID. versionId is its position, starting at "0". */
export interface Version {
  versionId: string;
  txid: string;
  blockHeight: number;
  time: number;
  state: DidState;
  deactivated: boolean;
}

export interface DidHistory {
  parsed: DidBtc;
  createTxid: string;
  versions: Version[];
  /** Outpoint that controls future updates, or null if the DID is final or deactivated. */
  didUtxo: { txid: string; vout: number } | null;
  tipHeight: number;
  /** Envelopes on the DID UTXO chain that were ignored, with the reason. */
  ignored: { txid: string; reason: string }[];
}

const TITLES: Record<ErrorType, string> = {
  INVALID_DID: 'invalidDid',
  NOT_FOUND: 'notFound',
  INVALID_OPTIONS: 'invalidOptions',
  FEATURE_NOT_SUPPORTED: 'featureNotSupported',
  INTERNAL_ERROR: 'internalError',
};

export class ResolutionFailure extends Error {
  readonly errorType: ErrorType;
  constructor(errorType: ErrorType, detail: string) {
    super(detail);
    this.errorType = errorType;
  }
}

const MAX_WALK = 10_000;
const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');

/** Reads the full, verified on-chain history of a DID. Throws ResolutionFailure or ChainDataError. */
export async function readHistory(did: string, source: ChainSource, minCreateConfirmations = 6): Promise<DidHistory> {
  if (!Number.isSafeInteger(minCreateConfirmations) || minCreateConfirmations < 1) {
    throw new ResolutionFailure('INVALID_OPTIONS', 'minCreateConfirmations must be a positive safe integer');
  }
  let parsed: DidBtc;
  try {
    parsed = parseDidBtc(did);
  } catch (err) {
    if (err instanceof InvalidDidError) throw new ResolutionFailure('INVALID_DID', err.message);
    throw err;
  }
  if (parsed.network !== source.network) {
    throw new ResolutionFailure('NOT_FOUND', `DID is on ${parsed.network}; this resolver reads ${source.network}`);
  }
  if (parsed.didIndex !== 0) {
    throw new ResolutionFailure('FEATURE_NOT_SUPPORTED', 'batch-created DIDs (DID index > 0) are not implemented');
  }

  const tipHeight = await source.tipHeight();
  const blockHash = await source.blockHashAt(parsed.blockHeight);
  if (!blockHash) throw new ResolutionFailure('NOT_FOUND', `no block at height ${parsed.blockHeight}`);
  const confirmations = tipHeight - parsed.blockHeight + 1;
  if (confirmations < minCreateConfirmations) {
    throw new ResolutionFailure('NOT_FOUND', `creation has ${confirmations} confirmations; ${minCreateConfirmations} required`);
  }
  const block = await fetchVerifiedBlock(source, blockHash);
  if (block.height !== parsed.blockHeight) throw new ChainDataError('source returned a block at a different height');
  const createTxid = block.txids[parsed.txIndex];
  if (!createTxid) throw new ResolutionFailure('NOT_FOUND', `block ${parsed.blockHeight} has no transaction ${parsed.txIndex}`);
  const createTx = await fetchVerifiedTx(source, createTxid);

  let creation;
  try {
    creation = parseCreation(createTx);
  } catch (err) {
    if (err instanceof ProtocolError || err instanceof MultikeyError) throw new ResolutionFailure('NOT_FOUND', `malformed creation: ${err.message}`);
    throw err;
  }
  if (!creation) throw new ResolutionFailure('NOT_FOUND', 'transaction at this position is not a did:btc creation');

  const createKey = p2trOutputKey(createTx.outs[1]?.script);
  const versions: Version[] = [
    {
      versionId: '0',
      txid: createTxid,
      blockHeight: block.height,
      time: block.time,
      state: { keys: [{ key: creation.subjectKey, flags: creation.flags }], properties: {}, controllerKey: createKey },
      deactivated: false,
    },
  ];
  const ignored: DidHistory['ignored'] = [];
  let didUtxo: DidHistory['didUtxo'] = createKey ? { txid: createTxid, vout: 1 } : null;

  for (let steps = 0; didUtxo; steps++) {
    if (steps > MAX_WALK) throw new ChainDataError('DID UTXO chain is too long');
    const spend = await source.spender(didUtxo.txid, didUtxo.vout);
    if (!spend) break;
    const spendBlock = await fetchVerifiedBlock(source, spend.blockHash);
    if (!spendBlock.txids.includes(spend.txid)) throw new ChainDataError(`spender ${spend.txid} is not in the block the source named`);
    const tx: Transaction = await fetchVerifiedTx(source, spend.txid);
    const inputIndex = inputSpending(tx, didUtxo.txid, didUtxo.vout);
    if (inputIndex < 0) throw new ChainDataError(`claimed spender ${spend.txid} does not spend ${didUtxo.txid}:${didUtxo.vout}`);
    const path = await verifyTaprootSpend(source, tx, inputIndex);
    const latest = versions[versions.length - 1];
    const nextKey = p2trOutputKey(tx.outs[0]?.script);

    if (isDeactivation(tx)) {
      versions.push({ versionId: String(versions.length), txid: spend.txid, blockHeight: spendBlock.height, time: spendBlock.time, state: { ...latest.state, controllerKey: null }, deactivated: true });
      didUtxo = null;
      break;
    }

    const envelope = path.kind === 'scriptPath' ? parseEnvelopeLeaf(path.leaf) : null;
    if (envelope) {
      try {
        if (path.kind !== 'scriptPath' || !path.leafSignatureVerified) throw new ProtocolError('envelope spend carries no verifiable leaf signature');
        const next = applyUpdate(latest.state, parseUpdate(envelope.payload));
        next.controllerKey = nextKey;
        versions.push({ versionId: String(versions.length), txid: spend.txid, blockHeight: spendBlock.height, time: spendBlock.time, state: next, deactivated: false });
      } catch (err) {
        if (!(err instanceof ProtocolError || err instanceof MultikeyError)) throw err;
        ignored.push({ txid: spend.txid, reason: err.message });
      }
    }
    // Spec §Read step 1: after the creation transaction the DID UTXO is the first output.
    didUtxo = nextKey ? { txid: spend.txid, vout: 0 } : null;
  }

  // The latest version's controller is whatever key holds the DID UTXO now (commit outputs and
  // plain key-path transfers move it without creating a new document version).
  const last = versions[versions.length - 1];
  if (!last.deactivated) {
    if (!didUtxo) last.state.controllerKey = null;
    else {
      const holder = await fetchVerifiedTx(source, didUtxo.txid);
      last.state.controllerKey = p2trOutputKey(holder.outs[didUtxo.vout].script);
    }
  }
  return { parsed, createTxid, versions, didUtxo, tipHeight, ignored };
}

function selectVersion(versions: Version[], options: ResolveOptions): number {
  if (options.versionId !== undefined && options.versionTime !== undefined) {
    throw new ResolutionFailure('INVALID_OPTIONS', 'versionId and versionTime are mutually exclusive');
  }
  if (options.versionId !== undefined) {
    const idx = versions.findIndex((v) => v.versionId === options.versionId);
    if (idx < 0) throw new ResolutionFailure('NOT_FOUND', `no version ${options.versionId}`);
    return idx;
  }
  if (options.versionTime !== undefined) {
    const t = Date.parse(options.versionTime);
    if (Number.isNaN(t)) throw new ResolutionFailure('INVALID_OPTIONS', 'versionTime is not a valid date-time');
    let idx = -1;
    versions.forEach((v, i) => {
      if (v.time * 1000 <= t) idx = i;
    });
    if (idx < 0) throw new ResolutionFailure('NOT_FOUND', 'DID did not exist at versionTime');
    return idx;
  }
  return versions.length - 1;
}

function failure(type: ErrorType, detail: string): ResolutionResult {
  return {
    didDocument: null,
    didResolutionMetadata: { error: { type: `https://www.w3.org/ns/did#${type}`, title: TITLES[type], detail } },
    didDocumentMetadata: {},
  };
}

export async function resolve(did: string, source: ChainSource, options: ResolveOptions = {}): Promise<ResolutionResult> {
  let history: DidHistory;
  let index: number;
  try {
    history = await readHistory(did, source, options.minCreateConfirmations ?? 6);
    index = selectVersion(history.versions, options);
  } catch (err) {
    if (err instanceof ResolutionFailure) return failure(err.errorType, err.message);
    if (err instanceof ChainDataError) return failure('INTERNAL_ERROR', `chain source returned data that failed verification: ${err.message}`);
    return failure('INTERNAL_ERROR', (err as Error).message);
  }
  const { versions } = history;
  const v = versions[index];
  const isLatest = index === versions.length - 1;
  const next = versions[index + 1];
  const documentMetadata: Record<string, unknown> = {
    created: iso(versions[0].time),
    ...(index > 0 ? { updated: iso(v.time) } : {}),
    versionId: v.versionId,
    ...(next ? { nextVersionId: next.versionId, nextUpdate: iso(next.time) } : {}),
    ...(v.deactivated ? { deactivated: true } : {}),
    btc: {
      network: history.parsed.network,
      createTxid: history.createTxid,
      blockHeight: history.parsed.blockHeight,
      txIndex: history.parsed.txIndex,
      versionTxid: v.txid,
      confirmations: history.tipHeight - v.blockHeight + 1,
      ...(isLatest ? { didUtxo: history.didUtxo ? `${history.didUtxo.txid}:${history.didUtxo.vout}` : null, final: !history.didUtxo && !v.deactivated } : {}),
      ...(history.ignored.length ? { ignoredUpdates: history.ignored } : {}),
    },
  };
  return {
    didDocument: v.deactivated ? null : buildDidDocument(did, v.state),
    didResolutionMetadata: v.deactivated ? {} : { contentType: 'application/did+ld+json' },
    didDocumentMetadata: documentMetadata,
  };
}

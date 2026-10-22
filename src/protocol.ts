// On-chain wire formats of did:btc (single-DID operations).
// Method spec: https://microstrategy.github.io/did-btc-spec/ §Create, §Read, §Update, §Deactivate
import { opcodes, script, type Transaction } from 'bitcoinjs-lib';
import { fromMulticodecBytes, type PublicKey } from './multikey.ts';

export const DID_MARKER = new TextEncoder().encode('did');
/** OP_RETURN with a single-byte push of ASCII "d" (spec §Deactivate). */
export const DEACTIVATION_SCRIPT = Uint8Array.from([opcodes.OP_RETURN, 0x01, 0x64]);
export const MAX_STACK_ELEMENT = 520;

/** Verification relationship bit flags, lowest bit first (spec §Create). */
export const VR = {
  authentication: 1 << 0,
  assertionMethod: 1 << 1,
  keyAgreement: 1 << 2,
  capabilityInvocation: 1 << 3,
  capabilityDelegation: 1 << 4,
} as const;
export type Relationship = keyof typeof VR;
export const RELATIONSHIPS = Object.keys(VR) as Relationship[];
export const MAX_VR_FLAGS = 0b11111;

export class ProtocolError extends Error {}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const startsWith = (a: Uint8Array, prefix: Uint8Array) => a.length >= prefix.length && equalBytes(a.subarray(0, prefix.length), prefix);

// ---------- create ----------

export function buildCreationScript(subjectKey: Uint8Array /* multicodec bytes */, flags: number): Uint8Array {
  if (!Number.isInteger(flags) || flags < 1 || flags > MAX_VR_FLAGS) throw new ProtocolError('invalid relationship flags');
  const payload = Uint8Array.from([...DID_MARKER, flags, ...subjectKey]);
  if (payload.length > 80) throw new ProtocolError('creation payload exceeds the 80-byte OP_RETURN limit');
  return script.compile([opcodes.OP_RETURN, payload]);
}

export interface CreationData {
  flags: number;
  subjectKey: PublicKey;
}

/** Parses output 0 of a creation transaction. Returns null if it is not a did:btc creation. */
export function parseCreation(tx: Transaction): CreationData | null {
  const out0 = tx.outs[0]?.script;
  if (!out0 || out0[0] !== opcodes.OP_RETURN) return null;
  const chunks = script.decompile(out0);
  if (!chunks || chunks.length !== 2 || !(chunks[1] instanceof Uint8Array)) return null;
  const payload = chunks[1];
  if (!startsWith(payload, DID_MARKER) || payload.length < 5) return null;
  const flags = payload[3];
  if (flags < 1 || flags > MAX_VR_FLAGS) throw new ProtocolError(`invalid relationship flags ${flags}`);
  return { flags, subjectKey: fromMulticodecBytes(payload.subarray(4)) };
}

/** A Pay-To-Taproot output script is OP_1 <32 bytes>. Returns the x-only output key. */
export function p2trOutputKey(outputScript: Uint8Array | undefined): Uint8Array | null {
  if (!outputScript || outputScript.length !== 34 || outputScript[0] !== opcodes.OP_1 || outputScript[1] !== 0x20) return null;
  return outputScript.subarray(2);
}

export function isDeactivation(tx: Transaction): boolean {
  return tx.outs.length > 0 && equalBytes(tx.outs[0].script, DEACTIVATION_SCRIPT);
}

// ---------- update envelope ----------

/** Tapleaf: <x-only key> OP_CHECKSIG OP_FALSE OP_IF <"did" + payload in 520-byte pushes> OP_ENDIF */
export function buildEnvelopeLeaf(leafKey: Uint8Array, payload: Uint8Array): Uint8Array {
  if (leafKey.length !== 32) throw new ProtocolError('leaf key must be x-only (32 bytes)');
  const data = Uint8Array.from([...DID_MARKER, ...payload]);
  const pushes: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += MAX_STACK_ELEMENT) pushes.push(data.subarray(i, i + MAX_STACK_ELEMENT));
  return script.compile([leafKey, opcodes.OP_CHECKSIG, opcodes.OP_FALSE, opcodes.OP_IF, ...pushes, opcodes.OP_ENDIF]);
}

export interface Envelope {
  leafKey: Uint8Array;
  payload: Uint8Array; // after the "did" marker
}

/** Parses a tapleaf script. Returns null when the leaf is not a did:btc envelope. */
export function parseEnvelopeLeaf(leaf: Uint8Array): Envelope | null {
  const chunks = script.decompile(leaf);
  if (!chunks || chunks.length < 6) return null;
  const [key, checksig, opFalse, opIf] = chunks;
  const last = chunks[chunks.length - 1];
  const isFalse = opFalse === opcodes.OP_FALSE || (opFalse instanceof Uint8Array && opFalse.length === 0);
  if (!(key instanceof Uint8Array) || key.length !== 32 || checksig !== opcodes.OP_CHECKSIG || !isFalse || opIf !== opcodes.OP_IF || last !== opcodes.OP_ENDIF) {
    return null;
  }
  const pushes = chunks.slice(4, -1);
  if (!pushes.every((c): c is Uint8Array => c instanceof Uint8Array)) return null;
  const data = Uint8Array.from(pushes.flatMap((p) => [...p]));
  if (!startsWith(data, DID_MARKER)) return null;
  return { leafKey: key, payload: data.subarray(DID_MARKER.length) };
}

/** Script-path witness: [...stack, leaf script, control block, (annex)]. Returns leaf + control block. */
export function scriptPathParts(witness: Uint8Array[]): { leaf: Uint8Array; controlBlock: Uint8Array; stack: Uint8Array[]; annex?: Uint8Array } | null {
  let items = witness;
  let annex: Uint8Array | undefined;
  if (items.length >= 2 && items[items.length - 1][0] === 0x50) {
    annex = items[items.length - 1];
    items = items.slice(0, -1);
  }
  if (items.length < 2) return null;
  return { leaf: items[items.length - 2], controlBlock: items[items.length - 1], stack: items.slice(0, -2), annex };
}

// ---------- update document ----------

export interface VmOperation {
  i?: number;
  k?: string;
  vr?: number;
}
export interface DidUpdate {
  vm?: VmOperation[];
  a?: Record<string, unknown>[];
  u?: Record<string, unknown>[];
  d?: Record<string, unknown>[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates the JSON shape of an update payload (spec §Update). Throws ProtocolError. */
export function parseUpdate(payload: Uint8Array): DidUpdate {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch {
    throw new ProtocolError('update payload is not UTF-8 JSON');
  }
  if (!isObject(json)) throw new ProtocolError('update payload must be a JSON object (batch updates are not supported)');
  const allowed = new Set(['vm', 'a', 'u', 'd']);
  for (const key of Object.keys(json)) if (!allowed.has(key)) throw new ProtocolError(`unknown update key "${key}"`);
  if (json.vm !== undefined) {
    if (!Array.isArray(json.vm)) throw new ProtocolError('"vm" must be an array');
    for (const op of json.vm) {
      if (!isObject(op)) throw new ProtocolError('vm operation must be an object');
      for (const k of Object.keys(op)) if (!['i', 'k', 'vr'].includes(k)) throw new ProtocolError(`unknown vm field "${k}"`);
      if (op.i !== undefined && (!Number.isInteger(op.i) || (op.i as number) < 0)) throw new ProtocolError('vm.i must be a non-negative integer');
      if (op.k !== undefined && typeof op.k !== 'string') throw new ProtocolError('vm.k must be a multikey string');
      if (op.vr !== undefined && (!Number.isInteger(op.vr) || (op.vr as number) < 1 || (op.vr as number) > MAX_VR_FLAGS)) throw new ProtocolError('vm.vr out of range');
      if (op.i === undefined && (op.k === undefined || op.vr === undefined)) throw new ProtocolError('vm append needs both k and vr');
    }
  }
  for (const key of ['a', 'u', 'd'] as const) {
    const v = json[key];
    if (v !== undefined && (!Array.isArray(v) || !v.every(isObject))) throw new ProtocolError(`"${key}" must be an array of objects`);
  }
  return json as DidUpdate;
}

export function encodeUpdate(update: DidUpdate): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(update));
}

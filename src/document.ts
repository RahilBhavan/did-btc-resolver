// DID state and its W3C DID document rendering (DID Core 1.0: https://www.w3.org/TR/did-1.0/, read 2026-10-21).
import { decodeMultikey, encodeMultikey, type PublicKey } from './multikey.ts';
import { ProtocolError, RELATIONSHIPS, VR, type DidUpdate } from './protocol.ts';

export interface KeyEntry {
  key: PublicKey;
  flags: number;
}

/** Everything a version of a did:btc DID is made of. Plain data so versions can be cloned. */
export interface DidState {
  keys: KeyEntry[];
  /** Extra document properties (e.g. "service") managed by the a/u/d update fields. */
  properties: Record<string, unknown>;
  /** x-only taproot output key of the DID UTXO, or null when the DID is final. */
  controllerKey: Uint8Array | null;
}

export type DidDocument = Record<string, unknown> & { id: string };

/** Properties an a/u/d update may not touch; keys change only through "vm". */
const RESERVED = new Set(['@context', 'id', 'controller', 'verificationMethod', ...RELATIONSHIPS, 'assertion']);

export function cloneState(s: DidState): DidState {
  return { keys: s.keys.map((k) => ({ key: { ...k.key }, flags: k.flags })), properties: structuredClone(s.properties), controllerKey: s.controllerKey };
}

/**
 * The controller is published as did:key of the DID UTXO's taproot output key. BIP-340 x-only keys
 * imply an even Y coordinate, so the 33-byte compressed form is 0x02 || x. (The reference SDK
 * multicodec-encodes the 32 x-only bytes directly, which is not a valid secp256k1-pub key.)
 */
export function controllerDidKey(xOnly: Uint8Array): string {
  return `did:key:${encodeMultikey({ type: 'secp256k1', bytes: Uint8Array.from([0x02, ...xOnly]) })}`;
}

export function buildDidDocument(did: string, state: DidState): DidDocument {
  const vmId = (i: number) => `${did}#key-${i}`;
  const doc: DidDocument = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
  };
  if (state.controllerKey) doc.controller = controllerDidKey(state.controllerKey);
  doc.verificationMethod = state.keys.map((k, i) => ({
    id: vmId(i),
    type: 'Multikey',
    controller: did,
    publicKeyMultibase: encodeMultikey(k.key),
  }));
  for (const rel of RELATIONSHIPS) {
    const refs = state.keys.flatMap((k, i) => (k.flags & VR[rel] ? [vmId(i)] : []));
    if (refs.length) doc[rel] = refs;
  }
  for (const [k, v] of Object.entries(state.properties)) doc[k] = structuredClone(v);
  return doc;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const entryId = (v: unknown) => (isObject(v) && typeof v.id === 'string' ? v.id : undefined);

function checkKey(name: string): void {
  if (RESERVED.has(name)) throw new ProtocolError(`update may not modify reserved property "${name}"`);
}

/**
 * Applies one update atomically to a copy of the state (spec §Update). Throws ProtocolError if any
 * operation is invalid, in which case the resolver ignores the whole update.
 * Order: vm, then d, u, a (deletions before additions so a replace-by-delete-and-add works).
 */
export function applyUpdate(state: DidState, update: DidUpdate): DidState {
  const next = cloneState(state);
  for (const op of update.vm ?? []) {
    if (op.i === undefined) {
      next.keys.push({ key: decodeMultikey(op.k!), flags: op.vr! });
      continue;
    }
    if (op.i >= next.keys.length) throw new ProtocolError(`vm index ${op.i} out of range`);
    if (op.k === undefined && op.vr === undefined) {
      next.keys.splice(op.i, 1);
      continue;
    }
    if (op.k !== undefined) next.keys[op.i].key = decodeMultikey(op.k);
    if (op.vr !== undefined) next.keys[op.i].flags = op.vr;
  }
  for (const obj of update.d ?? []) {
    for (const [name, value] of Object.entries(obj)) {
      checkKey(name);
      if (!(name in next.properties)) throw new ProtocolError(`cannot delete missing property "${name}"`);
      const current = next.properties[name];
      if (Array.isArray(current) && Array.isArray(value)) {
        for (const item of value) {
          const id = entryId(item);
          const idx = current.findIndex((c) => entryId(c) === id);
          if (id === undefined || idx < 0) throw new ProtocolError(`cannot delete missing entry in "${name}"`);
          current.splice(idx, 1);
        }
        if (current.length === 0) delete next.properties[name];
      } else {
        delete next.properties[name];
      }
    }
  }
  for (const obj of update.u ?? []) {
    for (const [name, value] of Object.entries(obj)) {
      checkKey(name);
      if (!(name in next.properties)) throw new ProtocolError(`cannot update missing property "${name}"`);
      const current = next.properties[name];
      if (Array.isArray(current) && Array.isArray(value)) {
        for (const item of value) {
          const id = entryId(item);
          const idx = current.findIndex((c) => entryId(c) === id);
          if (id === undefined || idx < 0) throw new ProtocolError(`cannot update missing entry in "${name}"`);
          current[idx] = { ...(current[idx] as object), ...(item as object) };
        }
      } else {
        next.properties[name] = value;
      }
    }
  }
  for (const obj of update.a ?? []) {
    for (const [name, value] of Object.entries(obj)) {
      checkKey(name);
      const current = next.properties[name];
      if (current === undefined) {
        next.properties[name] = structuredClone(value);
      } else if (Array.isArray(current) && Array.isArray(value)) {
        for (const item of value) {
          const id = entryId(item);
          if (id !== undefined && current.some((c) => entryId(c) === id)) throw new ProtocolError(`duplicate entry id "${id}" in "${name}"`);
          current.push(structuredClone(item));
        }
      } else {
        throw new ProtocolError(`property "${name}" already exists`);
      }
    }
  }
  return next;
}

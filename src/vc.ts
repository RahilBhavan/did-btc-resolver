// Verifiable Credentials signed with a did:btc key, using the eddsa-jcs-2022 cryptosuite.
// Cryptosuite: https://www.w3.org/TR/vc-di-eddsa/ (W3C Recommendation, 15 May 2025; read 2026-10-21) §3.3
// JCS: RFC 8785, via the `canonicalize` package by the RFC's co-author.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import canonicalizeModule from 'canonicalize';
import type { ChainSource } from './chain.ts';
import { decodeMultikey } from './multikey.ts';
import { resolve, type ResolveOptions } from './resolver.ts';

export interface DataIntegrityProof {
  '@context'?: unknown;
  type: 'DataIntegrityProof';
  cryptosuite: 'eddsa-jcs-2022';
  created?: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue?: string;
}

type Json = Record<string, unknown>;

// `canonicalize` is CommonJS (module.exports = fn); its .d.ts declares an ES default export.
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;

const enc = new TextEncoder();
function jcs(value: unknown): Uint8Array {
  const s = canonicalize(value);
  if (s === undefined) throw new Error('value cannot be canonicalized');
  return enc.encode(s);
}

/** proofConfigHash || documentHash (spec §3.3.4: config hash first). */
export function hashData(unsecured: Json, proofConfig: Json): Uint8Array {
  return Uint8Array.from([...sha256(jcs(proofConfig)), ...sha256(jcs(unsecured))]);
}

export function signEddsaJcs2022(unsecured: Json, options: Omit<DataIntegrityProof, 'proofValue'>, secretKey: Uint8Array): Json {
  if (options.type !== 'DataIntegrityProof' || options.cryptosuite !== 'eddsa-jcs-2022') throw new Error('unsupported proof options');
  const proof: Json = { ...options };
  if (unsecured['@context'] !== undefined) proof['@context'] = unsecured['@context'];
  const signature = ed25519.sign(hashData(unsecured, proof), secretKey);
  return { ...unsecured, proof: { ...proof, proofValue: 'z' + base58.encode(signature) } };
}

export interface VerifyResult {
  verified: boolean;
  reason?: string;
}

/** Cryptographic check only (spec §3.3.2), given the public key the verificationMethod points to. */
export function verifyEddsaJcs2022(secured: Json, publicKey: Uint8Array): VerifyResult {
  const { proof, ...unsecured } = secured as Json & { proof?: Json };
  if (!proof || typeof proof !== 'object') return { verified: false, reason: 'no proof' };
  const { proofValue, ...options } = proof;
  if (options.type !== 'DataIntegrityProof' || options.cryptosuite !== 'eddsa-jcs-2022') return { verified: false, reason: 'unsupported cryptosuite' };
  if (typeof proofValue !== 'string' || !proofValue.startsWith('z')) return { verified: false, reason: 'proofValue must be base58btc multibase' };
  if (options['@context'] !== undefined) {
    const pc = options['@context'] as unknown[];
    const dc = unsecured['@context'] as unknown[];
    if (!Array.isArray(pc) || !Array.isArray(dc) || pc.some((c, i) => JSON.stringify(c) !== JSON.stringify(dc[i]))) {
      return { verified: false, reason: 'proof @context does not prefix the document @context' };
    }
    unsecured['@context'] = pc;
  }
  let sig: Uint8Array;
  try {
    sig = base58.decode(proofValue.slice(1));
  } catch {
    return { verified: false, reason: 'proofValue is not base58' };
  }
  if (sig.length !== 64) return { verified: false, reason: 'signature must be 64 bytes' };
  const ok = ed25519.verify(sig, hashData(unsecured, options), publicKey);
  return ok ? { verified: true } : { verified: false, reason: 'signature does not verify' };
}

/**
 * Verifies a credential issued by a did:btc DID: resolve the issuer, require the proof's
 * verificationMethod to be a key of that DID listed under the proof purpose, then check the signature.
 * By default the latest DID version is used, so a key removed by a later update no longer verifies.
 */
export async function verifyCredential(credential: Json, source: ChainSource, resolveOptions: ResolveOptions = {}): Promise<VerifyResult> {
  const proof = credential.proof as Json | undefined;
  if (!proof || typeof proof.verificationMethod !== 'string') return { verified: false, reason: 'no proof.verificationMethod' };
  const vmId = proof.verificationMethod;
  const purpose = String(proof.proofPurpose ?? '');
  const issuer = typeof credential.issuer === 'string' ? credential.issuer : (credential.issuer as Json | undefined)?.id;
  const did = vmId.split('#')[0];
  if (issuer !== did) return { verified: false, reason: 'verificationMethod does not belong to the issuer' };
  const result = await resolve(did, source, resolveOptions);
  if (result.didDocumentMetadata.deactivated) return { verified: false, reason: 'issuer DID is deactivated' };
  if (!result.didDocument) return { verified: false, reason: `issuer DID did not resolve: ${result.didResolutionMetadata.error?.title}` };
  const doc = result.didDocument;
  const vm = (doc.verificationMethod as Json[]).find((m) => m.id === vmId);
  if (!vm) return { verified: false, reason: `${vmId} is not in the current DID document` };
  const allowed = (doc[purpose] as string[] | undefined) ?? [];
  if (!allowed.includes(vmId)) return { verified: false, reason: `${vmId} is not authorized for ${purpose}` };
  const key = decodeMultikey(vm.publicKeyMultibase as string);
  if (key.type !== 'ed25519') return { verified: false, reason: 'eddsa-jcs-2022 needs an Ed25519 key' };
  return verifyEddsaJcs2022(credential, key.bytes);
}

/**
 * Compares a DID document received out of band (e.g. cached or sent by a counterparty) with what
 * the chain says now. Detects tampered copies and stale versions.
 */
export async function checkPresentedDocument(presented: Json, source: ChainSource): Promise<VerifyResult> {
  if (typeof presented.id !== 'string') return { verified: false, reason: 'document has no id' };
  const result = await resolve(presented.id, source);
  if (!result.didDocument) return { verified: false, reason: result.didDocumentMetadata.deactivated ? 'DID is deactivated' : 'DID did not resolve' };
  if (canonicalize(presented) !== canonicalize(result.didDocument)) {
    return { verified: false, reason: `document differs from the on-chain version ${result.didDocumentMetadata.versionId}` };
  }
  return { verified: true };
}

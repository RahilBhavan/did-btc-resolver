// Multikey: multicodec varint prefix + raw public key, multibase base58btc ("z") encoded.
// Codecs: https://github.com/multiformats/multicodec/blob/master/table.csv (read 2026-10-21)
// Multikey: https://www.w3.org/TR/cid-1.0/#Multikey (read 2026-10-21)
import { base58 } from '@scure/base';

export type KeyType = 'ed25519' | 'secp256k1';

const CODECS: Record<KeyType, { prefix: [number, number]; length: number }> = {
  ed25519: { prefix: [0xed, 0x01], length: 32 }, // ed25519-pub
  secp256k1: { prefix: [0xe7, 0x01], length: 33 }, // secp256k1-pub, compressed
};

export interface PublicKey {
  type: KeyType;
  bytes: Uint8Array;
}

export class MultikeyError extends Error {}

/** Multicodec-prefixed bytes, as stored on chain in the creation OP_RETURN. */
export function toMulticodecBytes({ type, bytes }: PublicKey): Uint8Array {
  const codec = CODECS[type];
  if (bytes.length !== codec.length) throw new MultikeyError(`${type} key must be ${codec.length} bytes`);
  return Uint8Array.from([...codec.prefix, ...bytes]);
}

export function fromMulticodecBytes(data: Uint8Array): PublicKey {
  for (const [type, codec] of Object.entries(CODECS) as [KeyType, (typeof CODECS)[KeyType]][]) {
    if (data[0] === codec.prefix[0] && data[1] === codec.prefix[1]) {
      const bytes = data.slice(2);
      if (bytes.length !== codec.length) {
        throw new MultikeyError(`${type} key has ${bytes.length} bytes, expected ${codec.length}`);
      }
      return { type, bytes };
    }
  }
  throw new MultikeyError(`unsupported multicodec prefix 0x${Buffer.from(data.slice(0, 2)).toString('hex')}`);
}

export function encodeMultikey(key: PublicKey): string {
  return 'z' + base58.encode(toMulticodecBytes(key));
}

export function decodeMultikey(multibase: string): PublicKey {
  if (typeof multibase !== 'string' || !multibase.startsWith('z')) {
    throw new MultikeyError('only base58btc multibase ("z") is supported');
  }
  let raw: Uint8Array;
  try {
    raw = base58.decode(multibase.slice(1));
  } catch {
    throw new MultikeyError('invalid base58btc');
  }
  return fromMulticodecBytes(raw);
}

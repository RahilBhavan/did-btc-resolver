import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { base58 } from '@scure/base';
import { VR } from '../src/protocol.ts';
import { hashData, signEddsaJcs2022, verifyCredential, verifyEddsaJcs2022 } from '../src/vc.ts';
import { createDid, deactivate, edKey, update } from './support/scenario.ts';

// W3C Data Integrity EdDSA Cryptosuites v1.0, Appendix B.3 (eddsa-jcs-2022 test vector),
// https://www.w3.org/TR/vc-di-eddsa/ (Recommendation 15 May 2025; read 2026-10-21)
const W3C = {
  publicKeyMultibase: 'z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2',
  secretKeyMultibase: 'z3u2en7t5LR2WtQH5PfFqMqwVHBeXouLzo6haApm8XHqvjxq',
  credential: {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    id: 'urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33',
    type: ['VerifiableCredential', 'AlumniCredential'],
    name: 'Alumni Credential',
    description: 'A minimum viable example of an Alumni Credential.',
    issuer: 'https://vc.example/issuers/5678',
    validFrom: '2023-01-01T00:00:00Z',
    credentialSubject: { id: 'did:example:abcdefgh', alumniOf: 'The School of Examples' },
  },
  options: {
    type: 'DataIntegrityProof' as const,
    cryptosuite: 'eddsa-jcs-2022' as const,
    created: '2023-02-24T23:36:38Z',
    verificationMethod: 'did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2#z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2',
    proofPurpose: 'assertionMethod',
  },
  hashData: '66ab154f5c2890a140cb8388a22a160454f80575f6eae09e5a097cabe539a1db59b7cb6251b8991add1ce0bc83107e3db9dbbab5bd2c28f687db1a03abc92f19',
  proofValue: 'z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX',
};

describe('eddsa-jcs-2022 against the W3C test vector', () => {
  it('reproduces the hash data, signature and verification', () => {
    const secretKey = base58.decode(W3C.secretKeyMultibase.slice(1)).slice(2); // strip ed25519-priv multicodec 0x8026
    const publicKey = base58.decode(W3C.publicKeyMultibase.slice(1)).slice(2);
    const proofConfig = { ...W3C.options, '@context': W3C.credential['@context'] };
    assert.equal(Buffer.from(hashData(W3C.credential, proofConfig)).toString('hex'), W3C.hashData);
    const signed = signEddsaJcs2022(W3C.credential, W3C.options, secretKey) as { proof: { proofValue: string } };
    assert.equal(signed.proof.proofValue, W3C.proofValue);
    assert.deepEqual(verifyEddsaJcs2022(signed, publicKey), { verified: true });
  });
});

function issue(did: string, secretKey: Uint8Array, keyIndex = 0, purpose = 'assertionMethod') {
  return signEddsaJcs2022(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: did,
      validFrom: '2026-10-21T00:00:00Z',
      credentialSubject: { id: 'did:example:student', completed: 'did:btc resolver demo' },
    },
    { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-21T00:00:00Z', verificationMethod: `${did}#key-${keyIndex}`, proofPurpose: purpose },
    secretKey,
  );
}

describe('credentials issued by a did:btc DID', () => {
  it('verifies a credential signed with the key anchored on chain', async () => {
    const c = createDid();
    assert.deepEqual(await verifyCredential(issue(c.did, c.subject.secretKey), c.chain), { verified: true });
  });

  it('rejects a credential whose claims were edited after signing', async () => {
    const c = createDid();
    const vc = issue(c.did, c.subject.secretKey) as { credentialSubject: { completed: string } };
    vc.credentialSubject.completed = 'something else';
    assert.equal((await verifyCredential(vc, c.chain)).reason, 'signature does not verify');
  });

  it('rejects a credential signed by a key that is not the anchored key', async () => {
    const c = createDid();
    const result = await verifyCredential(issue(c.did, edKey(42).secretKey), c.chain);
    assert.deepEqual(result, { verified: false, reason: 'signature does not verify' });
  });

  it('rejects a key that is in the document but not authorized for assertionMethod', async () => {
    const c = createDid({ flags: VR.authentication });
    const result = await verifyCredential(issue(c.did, c.subject.secretKey), c.chain);
    assert.match(result.reason!, /not authorized for assertionMethod/);
  });

  it('rejects a credential that names a different issuer than its key', async () => {
    const c = createDid();
    const vc = issue(c.did, c.subject.secretKey);
    vc.issuer = 'did:example:someone-else';
    assert.match((await verifyCredential(vc, c.chain)).reason!, /does not belong to the issuer/);
  });

  it('stops accepting a rotated-out key, while history still shows it was valid at version 0', async () => {
    const c = createDid();
    const old = issue(c.did, c.subject.secretKey);
    const k1 = edKey(1);
    update(c, { vm: [{ i: 0, k: k1.multikey }] });
    assert.deepEqual(await verifyCredential(old, c.chain), { verified: false, reason: 'signature does not verify' });
    assert.deepEqual(await verifyCredential(old, c.chain, { versionId: '0' }), { verified: true });
    assert.deepEqual(await verifyCredential(issue(c.did, k1.secretKey), c.chain), { verified: true });
  });

  it('rejects credentials from a deactivated issuer', async () => {
    const c = createDid();
    const vc = issue(c.did, c.subject.secretKey);
    deactivate(c);
    assert.deepEqual(await verifyCredential(vc, c.chain), { verified: false, reason: 'issuer DID is deactivated' });
  });
});

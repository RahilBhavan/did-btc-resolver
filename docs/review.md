# Correctness and publication review

Purpose: record the review of existing v1 at `78b32bf`, its proven corrections and retained limits. Reviewed October 21, 2026 America/Detroit (October 22 UTC).

## Proven correction

`verifyCredential` previously trusted the proof's chosen relationship. A DID created with only `VR.authentication` could sign a credential with `proofPurpose: authentication` and receive `{verified: true}` despite having no assertion authority. The new regression in `test/credential.test.ts` failed with that exact result before the fix. A guard now requires `assertionMethod` before resolution; the existing assertion-key check and cryptographic verification still apply. Typecheck, the full offline suite and the Core integration passed afterward.

[DID Core §5.3.2](https://www.w3.org/TR/did-1.0/#assertion) identifies assertionMethod as the relationship used for issuing a Verifiable Credential. The lower-level `verifyEddsaJcs2022` remains a signature primitive; callers of that primitive must enforce their own purpose policy. Neither API validates claim truth, real-world identity, credential status, expiry or full VC semantics.

An independent T3 review of the pinned starting commit reproduced the same purpose issue and two more cases, both verified here before correction:

- After an update and a later plain controller transfer, resolving the earlier update's timestamp returned the later controller. The retained lifecycle regression failed before the fix. Controller movement is now tracked separately from payload versions. Explicit `versionId` keeps its immutable event snapshot, while time/current queries include applicable transfers. This preserves payload version numbering. Current UTXO/finality metadata is limited to an unqualified current query.
- After anchoring the Ed25519 identity point (`01` followed by 31 zero bytes), a fixed signature (`01` followed by 63 zero bytes) accepted both `student` and `admin` claims without a signing secret. The retained credential regression failed before the fix. Ed25519 verification now explicitly uses `{zip215: false}` to reject small-order public keys. Normal generated keys and the W3C vector still pass. This is not a forgery against normally generated keys. See [W3C's input-check guidance](https://www.w3.org/TR/2025/REC-vc-di-eddsa-20250515/#achieving-ed25519-security-properties). Anchoring key bytes remains separate from whether they are safe for credential verification.

Independent task reference: `did-btc-review-1` (completed read-only against `78b32bf`). No additional proven transaction-binding or batch-handling issue survived that review.

## Review coverage

- Correctness: identifier/network parsing, single-DID transaction formats, UTXO spend binding, atomic document updates, rotation, history selection, deactivation and replay. Existing adversarial and recorded-chain tests were executed. The pinned draft's batch arrays are deliberately rejected by `parseUpdate`; batch deactivation is not implemented.
- Error handling: source failures, malformed payloads, missing fixtures, CLI exit status and disposable-node cleanup. Added executable snapshot negative checks and a node-restart comparison. Network adapters have no request timeout/retry policy; callers can still encounter a hung provider.
- Security: signature/commitment verification, relationship authorization, secret handling and tracked/reachable-history publication contents. Fixed the credential purpose bypass and small-order verification issue above. This review is not a security certification or general Bitcoin consensus validation.
- Accessibility: no graphical interface; CLI JSON, readable documentation and exit codes are the product surface. No UI finding.
- Performance: the resolver walk is capped at 10,000 steps, but repeatedly fetches data and is not a production indexer. No measured performance regression was established; no speculative optimization was applied.
- Dead code: searched imports, exports, scripts and documented entry points. No proven removable implementation found.
- Conventions: strict TypeScript/no-emit checks pass. Retained the existing module organization and deterministic test vectors; clarified misleading source comments that implied provider independence.

## Source and evidence boundaries

The [pinned unofficial MicroStrategy did:btc draft](https://github.com/MicroStrategy/did-btc-spec/blob/2c45a85f90ba5f013654351a3b0224c7f523d153/index.html) was re-read during this review. Its read, update and deactivation procedures support the documented single-DID scope; batch formats and draft inconsistencies remain explicit in [specification.md](specification.md). This continuation did not change the frozen source observation dates or claim a newer protocol version.

The RPC/Esplora provider remains authority for chain selection, height and spend completeness. Supported hash/signature checks do not prove canonical-chain membership, arbitrary script validity or witness commitment inclusion. Reorg/index recovery and historical credential acceptance policies remain outside v1. Unsupported script paths can be followed for controller movement based on provider-confirmed spends; this is not a full script interpreter.

The original public testnet recording and isolated regtest recording are retained byte-for-byte with SHA-256 provenance. The W3C signing secret in the credential test is a **published test-vector key**, not a user secret; deterministic MemChain keys are test-only. Local node wallets, RPC credentials, dependency trees and restored JSON caches are excluded from Git. Bitcoin transaction/header recordings are public protocol data; document/vector and dependency rights remain with their sources. No project code license was selected.

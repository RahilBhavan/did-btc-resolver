# Specification mapping and deliberate limits

Purpose: identify the MicroStrategy did:btc method draft and the implemented subset.

The primary source is [MicroStrategy/did-btc-spec](https://github.com/MicroStrategy/did-btc-spec), commit `2c45a85f90ba5f013654351a3b0224c7f523d153` (August 22, 2024). `git ls-remote` on October 21, 2026 returned that HEAD. Its ReSpec `specStatus` is `unofficial`; its README calls it an early draft. It has no stable normative version number used by this implementation. Do not call it a finalized standard or confuse it with `did:btcr`, `did:ion` or `did:btco`.

## Single-DID operations

Create: output 0 has OP_RETURN containing ASCII `did`, relationship flags and a multicodec subject public key. Optional output 1 is P2TR and controls future changes. Missing/non-P2TR controller means final. The resolver's default creation confirmation threshold is six; an explicitly positive caller override is possible. The spec phrases this as waiting before publishing the identifier, not a mandatory universal resolver policy.

Read: TxRef identifies the block and transaction index. The first subject key builds a Multikey verification method. The P2TR output key renders a did:key controller. Subsequent spends move the DID UTXO to output 0. Plain key-path transfers update the controlling key without adding a document-payload version. `versionId` selects the controller snapshot at that payload event; `versionTime` includes controller transfers up to the requested block timestamp. Time selection uses header timestamps, which are not guaranteed monotonic, and is a local convention. Current UTXO/finality metadata is returned only for an unqualified current query. Version numbering and resolution metadata here are local conventions, starting at 0.

Update: the supported leaf is `<x-only key> CHECKSIG FALSE IF <did + JSON in <=520-byte pushes> ENDIF`. Verification-method changes use `vm`; generic property additions/updates/deletions use `a/u/d`. Reserved DID properties cannot be overwritten through generic property operations. Malformed envelopes are recorded as ignored and the UTXO chain is still followed. Generic property existence means JSON own-member existence, including names such as `constructor` and `__proto__`; these names cannot access or change JavaScript prototypes. Invalid operations roll back the entire payload, including any preceding key changes. Key indices are array positions; deletion shifts later indices and their rendered key IDs. Clients must resolve the current version before applying another index-based update. Arbitrary tapleaf programs, batch operations and subject-key codecs beyond the implemented ed25519/secp256k1 subset are not supported.

Deactivate: a spend of the DID UTXO with first output OP_RETURN and one ASCII `d` byte (a single decoded push, including PUSHDATA1/2/4 encodings) permanently returns deactivated metadata and no current document. Historical document versions remain available.

## Draft discrepancies

- The draft's generic identifier `did:btc:xg4x-ay5y-q5zq-232` carries a test-network TxRef without the `test` prefix. This implementation enforces prefix/network consistency.
- BIP-136's current TxRef checksum is Bech32m. Obsolete Bech32 forms are rejected with a specific diagnostic. The published worked creation example `did:btc:test:xuh5-ayyy-q3q0-kp0` resolves successfully from recorded testnet data.
- The draft describes `0x26` as pushing 36 bytes; it is 38 bytes (3 marker + 1 flags + 2 codec + 32 key).
- Its read procedure says chunks are separated by OP_IF bytes; the SDK/valid script construction uses ordinary data pushes inside one conditional. This implementation uses that valid envelope form and tests payloads above 520 bytes.
- Regtest TxRef network support and version IDs are useful local conventions, not claims that the draft standardizes those extensions.

## Trust model

A Core node validates the regtest chain and transaction scripts. The resolver additionally checks hashes, transaction-list Merkle roots and supported Taproot signatures/commitments. In fixture/Esplora mode those checks only establish consistency with the supplied headers and spend graph. The provider can omit spends or choose another chain; self-advertised PoW bits are not independently validated against network difficulty. The source must also report block heights honestly. No full consensus verifier, header checkpoint, witness-commitment verification or reorganization service is implemented.

Tests intentionally separate synthetic in-memory vectors (no node consensus) from saved node-confirmed regtest responses and the recorded upstream public testnet creation. None is evidence of this creator publishing a lifecycle on a public network. All lifecycle broadcasts in this project are on local regtest.

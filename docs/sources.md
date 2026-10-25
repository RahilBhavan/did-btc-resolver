# Primary sources and frozen evidence

Purpose: pin the draft protocol and distinguish source observations from test vectors.

Verified October 21, 2026 America/Detroit (October 22 UTC during the local evening).

- [Upstream MicroStrategy draft](https://github.com/MicroStrategy/did-btc-spec/tree/2c45a85f90ba5f013654351a3b0224c7f523d153), commit `2c45a85f90ba5f013654351a3b0224c7f523d153`, August 22, 2024. Both primary website/raw source and live remote HEAD were checked. `index.html` SHA-256: `175f997a567c6deb3ac4dde7cf703dcdc4c0803ab7e18e4cbf1a7ec964b3c43d`. Upstream calls this an unofficial early draft. See [spec mapping](specification.md) for deviations.
- [BIP-136 TxRef](https://github.com/bitcoin/bips/blob/master/bip-0136.mediawiki), [BIP-340 signatures](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki), [BIP-341 Taproot](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki). The tests use current Bech32m TxRefs and supported Taproot paths.
- [W3C Data Integrity EdDSA, May 15, 2025 Recommendation](https://www.w3.org/TR/2025/REC-vc-di-eddsa-20250515/), `eddsa-jcs-2022`. The credential test reproduces its signature vector. This does not constitute full VC validation.
- [Blockstream testnet example transaction](https://blockstream.info/testnet/tx/5acfba9c13bd92c27e9aa8b8cd75d03730571b2dfcc7f81543e9c15cc1efb961), published by the method draft. The saved recording says source `https://blockstream.info/testnet/api` and recordedAt `2026-10-22T01:05:10.960Z`. It supplies the real creation transaction at height 2582910, index 132, and its chain context. Offline replay checks consistency; it does not independently establish today's tip or absence of later spends.
- Local Bitcoin Core regtest recording: `2026-10-22T01:20:35.409Z`. `results/regtest-lifecycle.json` captures the node-confirmed lifecycle. `test/fixtures/regtest-recording.json` contains headers, transactions and spend answers for offline replay. Keys and RPC credentials are excluded. Local regtest confirmations are not public-network proof.
- [Bitcoin Core 31.1 release](https://bitcoincore.org/en/releases/31.1/); [official SHA256SUMS](https://bitcoincore.org/bin/bitcoin-core-31.1/SHA256SUMS). Downloaded Linux archive checksum comparison: `b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e  bitcoin-31.1-x86_64-linux-gnu.tar.gz`. On 2026-10-24 the `SHA256SUMS.asc` signatures were checked with a scratch GPG keyring loaded from the bitcoin-core/guix.sigs builder keys: 11 good signatures. The keys' identities were not checked out of band. CI checks the SHA-256 only.

Naming check, 2026-10-24: the pinned `index.html` and README name MicroStrategy as the authoring company and never use the word "Orange" (0 matches in each, fetched from the pinned commit). Earlier wording that tied the draft to an "Orange" product is not supported by these sources and was removed.

`data/frozen/index.json` contains original-byte SHA-256 and sizes for both JSON recordings. `scripts/restore_data.py` verifies hashes before restoring. Compressed data pieces are <=16 KB. The synthetic MemChain fixtures in `test/support/` are programmatically constructed signed transactions and self-mined headers; they were never broadcast to Bitcoin Core. Only the separate regtest tests and saved regtest receipt prove node acceptance of this implementation's lifecycle.


Conformance continuation, 2026-10-22: re-read the same pinned MicroStrategy did:btc draft's
Create/Update/Deactivate sections. `test/wire-conformance.test.ts` now checks its
literal creation ScriptPubKey and stated subject bytes/flags without the local
builder. This reuses the existing external example, not a second independently
sourced lifecycle. [Core v31.1 GetScriptOp](https://github.com/bitcoin/bitcoin/blob/v31.1/src/script/script.cpp)
was checked for push decoding. Alternative revocation encodings are synthetic
tests of the documented payload interpretation; no external update/revocation
known-answer lifecycle was added. See [the improvement record](improvement-plan.md).

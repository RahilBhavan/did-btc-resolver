# did:btc resolver: a local create, update and deactivate demonstration

[![Offline verification](https://github.com/RahilBhavan/did-btc-resolver/actions/workflows/ci.yml/badge.svg)](https://github.com/RahilBhavan/did-btc-resolver/actions/workflows/ci.yml)

An independent TypeScript implementation of the single-DID subset of MicroStrategy Orange's Bitcoin inscription DID method. It resolves chain data into DID documents, creates Taproot transactions and demonstrates key rotation and credential signature verification. The upstream specification is an **unofficial early draft**, pinned here to commit `2c45a85f90ba5f013654351a3b0224c7f523d153`, verified October 21, 2026.

## What it does

- Creates a DID with an OP_RETURN subject key and optional Taproot controller UTXO; follows its spend chain through updates and deactivation.
- Resolves version IDs/times and reports malformed, missing or unsupported identifiers.
- Checks transaction IDs, header hashes/PoW targets, Merkle roots, Taproot commitments and supported Schnorr signatures. This does **not** independently establish the canonical chain.
- Exercises a real Bitcoin Core 31.1 regtest lifecycle, including subject-key rotation, rejection of the old credential signature and replay rejection. Saved node-confirmed evidence is in `results/regtest-lifecycle.json`; raw public chain responses can be replayed offline.
- Passes 78 offline tests, with two optional network tests skipped. With local regtest enabled: 79 pass, one live-Esplora test skipped. These are separate executions, not additive counts.

## How it works

`src/did.ts` and `txref.ts` parse identifiers. `protocol.ts` decodes creation outputs and update envelopes, `document.ts` applies changes, and `resolver.ts` walks confirmed DID-UTXO spends. `sources.ts` adapts Core RPC, Esplora and recorded fixtures; `verify.ts` checks supported cryptographic bindings. `creator.ts` constructs/signs local demo transactions. `vc.ts` supplies a narrow Ed25519/JCS signature demonstration.

## Run it

Tested with Node 26.8.1 and TypeScript 7.0.2; Node 24+ is required for direct TypeScript execution. Python 3 restores the compressed fixtures. Clone into a disk-backed working directory (for example `~/scratch/did-btc-resolver/clean`) and install the locked dependencies:

```bash
git clone https://github.com/RahilBhavan/did-btc-resolver.git
cd did-btc-resolver
npm ci
python3 scripts/restore_data.py
python3 -m unittest discover -s test -p '*_test.py' -v
npm run typecheck
npm test
```

For the actual node-confirmed demo, obtain [Bitcoin Core 31.1](https://bitcoincore.org/en/releases/31.1/) and verify its download checksums. Set `BITCOIN_BIN` to your extracted `bin` directory; for example:

```bash
BITCOIN_BIN="$HOME/scratch/did-btc-resolver/core/bitcoin-31.1/bin" \
  bash scripts/run-regtest.sh > "$HOME/scratch/did-btc-resolver/new-demo.json"
```

This starts a disposable regtest node on loopback port 18643 with P2P disabled, runs the integration tests, prints lifecycle JSON, restarts the same chain and checks current/historical resolution, then stops/removes that node. It mines test coins only. Port 18643 must be free. Fresh random keys and block timestamps make transaction IDs differ between runs; the lifecycle assertions are reproducible.

To resolve the upstream public testnet example read-only:

```bash
npm run resolve -- did:btc:test:xuh5-ayyy-q3q0-kp0 \
  --esplora https://blockstream.info/testnet/api --network testnet
```

That command requires network availability. Ordinary tests use frozen data. [Verification](docs/verification.md) distinguishes offline vectors from live evidence.

## Repository layout

- `src/` — method parser, resolver, adapters, creator and credential demo.
- `test/` — adversarial tests, synthetic MemChain vectors and recorded chain fixtures.
- `data/frozen/` — compressed fixture parts and original-byte hashes.
- `results/` — node-confirmed lifecycle receipt, with no keys or RPC credentials.
- `scripts/` — snapshot restoration, source recording and disposable regtest runner.
- `docs/` — scope, spec mapping, sources and verification.

## Documentation

- [Public design system](DESIGN.md): Rahil Design 3.3.0, shared tokens and visual review rules.

- [Scope and acceptance](docs/spec.md) — agreed local v1.
- [Specification mapping](docs/specification.md) — implemented subset and draft ambiguities.
- [Sources](docs/sources.md) — pinned upstream sources and recorded evidence.
- [Correctness review](docs/review.md) — proven fixes and remaining trust boundaries.
- [Conformance improvements](docs/improvement-plan.md) — property-update rollback, revocation encodings and a five-minute reproduction.
- [Verification](docs/verification.md) — exact checks and trust boundaries.
- [Publication](docs/publication.md) — fresh-clone checks and reviewed regtest receipt.

## Sources

[MicroStrategy did:btc draft](https://microstrategy.github.io/did-btc-spec/), its [pinned source](https://github.com/MicroStrategy/did-btc-spec/blob/2c45a85f90ba5f013654351a3b0224c7f523d153/index.html), [BIP-136](https://github.com/bitcoin/bips/blob/master/bip-0136.mediawiki), BIP-340/341 and [W3C EdDSA/JCS](https://www.w3.org/TR/2025/REC-vc-di-eddsa-20250515/) inform this implementation. The spec's creation example is recorded from Blockstream testnet3. Source URLs, observation dates, hashes and the regtest binary checksum are documented in [sources](docs/sources.md).

## Scope and limits

- Independent local demonstration; no affiliation with Strategy, no Orange product integration, conformance certification, security audit, mainnet use or monetary activity.
- Batch create/update/deactivate is unsupported. Regtest TxRefs are a local extension; they do not establish production interoperability.
- RPC/Esplora choose the chain, height and spend completeness. There is no independent header-chain/difficulty/most-work validation or general Bitcoin script interpreter. Cryptographic consistency checks do not make a remote provider trustless.
- Creator handles the demo's single-key Taproot paths, not arbitrary multisig controllers. Reorganizations and long-running indexing/recovery are outside v1.
- Credential verification checks a supported signature against the current assertion key. It does not establish real-world identity, claim truth, expiry, status, schema validity or full VC conformance. Historical documents remain resolvable; historical credential validity is a separate policy.

## License

[MIT](LICENSE). The license covers this project's code only. Upstream documents, vectors and dependencies retain their own rights.

Part of [Rahil Bhavan's projects](https://github.com/RahilBhavan).

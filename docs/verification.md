# Verification and evidence boundaries

Purpose: distinguish offline checks, primary-source observations and node-confirmed behavior.

Verified October 21, 2026 America/Detroit; receipt timestamps use UTC and therefore say October 22 during the local evening. Tested Node 26.8.1, TypeScript 7.0.2 and Bitcoin Core 31.1.

## Commands exercised

```bash
python3 scripts/restore_data.py
npm run typecheck
npm test
BITCOIN_BIN="$HOME/scratch/did-btc-resolver/core/bitcoin-31.1/bin" bash scripts/run-regtest.sh > "$HOME/scratch/did-btc-resolver/new-demo.json"
npm run resolve -- did:btc:test:xuh5-ayyy-q3q0-kp0 --esplora https://blockstream.info/testnet/api --network testnet
```

README dependency installation with `npm ci --prefix` was also exercised on disk under scratch. Offline tests: **55 discovered, 53 pass, 2 skipped** (Core integration and live Esplora). Disposable Core run: **55 discovered, 54 pass, 1 skipped** (live Esplora). Typecheck passes. Counts are separate runs, not additive. The live read-only CLI resolution also succeeded separately. It is not counted as an additional unit test.

The disposable runner creates a fresh local chain, waits for RPC, runs the integration test and the demo, then stops/removes its node. It disables P2P and refuses to run the lifecycle on a non-regtest chain. Multiple fresh-node runs passed, including from a clean staged-file copy. The persistent partial-work node was also stopped and restarted; latest DID resolution exactly matched its saved raw-chain recording afterward. It was then stopped. Random keys/time intentionally produce different IDs; tests assert the same lifecycle behavior. The pre-existing partial-work node on port 18543 was reused only for local evidence recording; no external network broadcast occurred.

## What the tests prove

Synthetic MemChain tests cover create/read/update/deactivate, version selection, controller moves, large update payloads, invalid updates/identifiers, prefix/checksum mismatch, unsupported batches, edited transaction bytes, swapped transaction lists, altered witness data, wrong keys and replay attempts. They check the resolver's supported cryptographic rules; MemChain is not a Bitcoin consensus engine.

A frozen real testnet3 recording replays the draft's published creation transaction (height 2582910, index 132). A separate frozen recording replays the local node-confirmed lifecycle and historical versions. `data/frozen/index.json` checks original-byte SHA-256 for both. Neither offline recording demonstrates current public-chain state.

The real Core integration asserts successful creation and update resolutions, subject-key rotation, deactivation, old/new credential verification outcomes `[true,false,true,false]`, readable history after deactivation and node rejection of an old confirmed reveal transaction. Saved `results/regtest-lifecycle.json` contains the receipt and transaction IDs. No wallet secret or RPC credential is stored there.

## Limits

No public-network lifecycle was broadcast; no public-network funds were used. No independent most-work/header-chain validation, complete Bitcoin interpreter, batch conformance, arbitrary controller scripts, witness-commitment audit, reorg service or credential semantic/status/expiry validation was exercised. Typechecking and vector agreement are not a security audit. The reference draft itself is unofficial and contains documented inconsistencies.

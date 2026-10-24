# Verification and evidence boundaries

Purpose: distinguish offline checks, primary-source observations and node-confirmed behavior.

Verified October 21, 2026 America/Detroit; receipt timestamps use UTC and therefore say October 22 during the local evening. Tested Node 26.8.1, TypeScript 7.0.2 and Bitcoin Core 31.1.

## Commands exercised

```bash
python3 scripts/restore_data.py
python3 -m unittest discover -s test -p '*_test.py' -v
npm run typecheck
npm test
mkdir -p .scratch
BITCOIN_BIN=/path/to/bitcoin-31.1/bin bash scripts/run-regtest.sh > .scratch/lifecycle.json
npm run resolve -- did:btc:test:xuh5-ayyy-q3q0-kp0 --esplora https://blockstream.info/testnet/api --network testnet
```

README dependency installation with `npm ci --prefix` was also exercised on disk under scratch. Offline tests: **58 discovered, 56 pass, 2 skipped** (Core integration and live Esplora). Disposable Core run: **58 discovered, 57 pass, 1 skipped** (live Esplora). Typecheck passes. Counts are separate runs, not additive. The live read-only CLI resolution also succeeded separately. It is not counted as an additional unit test.

The disposable runner creates a fresh local chain, waits for RPC, runs the integration test and the demo, stops and restarts the node with the same data directory, compares latest and historical resolutions against the pre-restart receipt, then stops/removes its node. It disables P2P and refuses to run the lifecycle on a non-regtest chain. Multiple fresh-node runs passed, including from a clean staged-file copy. The persistent partial-work node was also stopped and restarted; latest DID resolution exactly matched its saved raw-chain recording afterward. It was then stopped. Random keys/time intentionally produce different IDs; tests assert the same lifecycle behavior. The pre-existing partial-work node on port 18543 was reused only for local evidence recording; no external network broadcast occurred.

## What the tests prove

Synthetic MemChain tests cover create/read/update/deactivate, version selection, controller moves, large update payloads, invalid updates/identifiers, prefix/checksum mismatch, unsupported batches, edited transaction bytes, swapped transaction lists, altered witness data, wrong keys and replay attempts. They check the resolver's supported cryptographic rules; MemChain is not a Bitcoin consensus engine.

A frozen real testnet3 recording replays the draft's published creation transaction (height 2582910, index 132). A separate frozen recording replays the local node-confirmed lifecycle and historical versions. `data/frozen/index.json` checks original-byte SHA-256 for both. Neither offline recording demonstrates current public-chain state.

The real Core integration asserts successful creation and update resolutions, subject-key rotation, deactivation, old/new credential verification outcomes `[true,false,true,false]`, readable history after deactivation and node rejection of an old confirmed reveal transaction. Saved `results/regtest-lifecycle.json` contains the receipt and transaction IDs. No wallet secret or RPC credential is stored there.

## Re-run on 2026-10-24

Bitcoin Core 31.1 (Linux x86_64) was downloaded to a scratch folder with `scripts/install-bitcoin-core.sh`, which checks the SHA-256 against the official `SHA256SUMS` and a pinned hash. `bash scripts/run-regtest.sh --keep` then passed: 103 tests discovered, 102 pass, 1 skipped (live Esplora), restart proof matched. `npm run demo` ran inside that script, and `npm run resolve -- <did> --version-id 1` returned version 1 with the service entry. Offline: 103 discovered, 101 pass, 2 skipped; typecheck and the three Python tests pass. The CI `regtest` job runs the same script; it has not yet run on GitHub.


No public-network lifecycle was broadcast; no public-network funds were used. No independent most-work/header-chain validation, complete Bitcoin interpreter, batch conformance, arbitrary controller scripts, witness-commitment audit, reorg service or credential semantic/status/expiry validation was exercised. Typechecking and vector agreement are not a security audit. The reference draft itself is unofficial and contains documented inconsistencies.

## Publication review continuation

On October 21, 2026 America/Detroit (October 22 UTC), a scratch copy installed with `npm ci`, restored both hashed recordings, passed typecheck and passed the offline suite above. Three Python snapshot tests also pass: repeat restoration preserves original bytes, changed files are not overwritten, and incorrect hashes fail before writing. The dependency install reported zero known vulnerabilities; that observation is not certification.

The credential purpose regression failed before the fix (an authentication-only proof was accepted), and passes with the assertion-purpose guard. The latest disposable Core run also printed `Restart proof: latest and historical resolutions match the pre-restart receipt`. The original frozen recordings and lifecycle receipt remain unchanged; fresh runs intentionally generate different transaction IDs.

GitHub Actions uses pinned action commits, Node 26.8.1, Python 3.13.7, read-only repository permission and a 10-minute timeout. Installation uses the network; fixture restoration, typecheck and test steps use offline inputs. CI does not download or run Core and does not claim to verify the optional live Esplora API.

The publication continuation also ran the same Core demo from a fresh GitHub clone. Its new transaction IDs and results are saved in `results/reviewed-regtest-lifecycle.json`; [publication.md](publication.md) records the source commit and receipt hash.


## October 22 conformance slice

The [improvement record](improvement-plan.md) contains the bounded acceptance
conditions, failing-before/fixed-after cases, source distinctions and five-minute
example. Current suite: **80 discovered, 78 offline pass, 2 skipped**; with the
isolated Core runner, **79 pass, 1 skipped**, plus successful restart comparison.
Typecheck, hash-checked restoration and all three Python checks pass. New cases
cover JSON own-property names, atomic key rollback, recovery, historical reads,
revocation push encodings and malformed revocation payloads. Only the fixed
creation script assertion is drawn directly from an external example; the new
lifecycle cases are synthetic. Prior counts above describe earlier executions.

## October 22 reader fixes

A cold reader found that `npm run resolve -- --help` crashed with a stack trace. Every entry point now answers `--help` and rejects unknown options with a short error and usage; `test/cli.test.ts` covers this. `scripts/run-regtest.sh --keep` leaves the node running for version queries. Suite after this change: **103 discovered; offline 101 pass, 2 skipped; with the isolated Core 31.1 runner, 102 pass, 1 skipped** (live Esplora), plus the restart comparison. The three Python checks pass.

### Query a past version

With the `--keep` node running and its environment exported, resolve the demo DID as it was before deactivation. `--version-id 0` is the creation; each later update or deactivation adds one. `--version-time <ISO date-time>` selects by block time instead. Real output from one run, shortened with `jq`:

```bash
DID=did:btc:test:qq8q-qqpq-q0vh-38f   # use the DID that your run printed
npm run -s resolve -- $DID --version-id 1 | jq -c '{versionId: .didDocumentMetadata.versionId, keys: [.didDocument.verificationMethod[].publicKeyMultibase], service: [.didDocument.service[].id]}'
# {"versionId":"1","keys":["z6MkmqvGUFRTRsihD615tgkf7v7bSPACzDWaf7EX49jE6YCJ"],"service":["did:btc:test:qq8q-qqpq-q0vh-38f#demo"]}
npm run -s resolve -- $DID --version-id 0 | jq -c '{versionId: .didDocumentMetadata.versionId, keys: [.didDocument.verificationMethod[].publicKeyMultibase]}'
# {"versionId":"0","keys":["z6MknqFCGtxHEuHi4yQgnay89GCmgwHBKoFoVtZznMZXb2D9"]}
npm run -s resolve -- $DID | jq -c '{deactivated: .didDocumentMetadata.deactivated, didDocument}'
# {"deactivated":true,"didDocument":null}
```

Version 0 holds the original subject key. Version 1 holds the rotated key and the added service. The current resolution has no document, because the DID is deactivated.

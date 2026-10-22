# Publication receipt

Purpose: record public publication and reproducibility evidence without credentials or wallet data.

- Repository: https://github.com/RahilBhavan/did-btc-resolver (public).
- Default branch: `main`.
- Reviewed implementation: `f8571cd` (correctness fixes); published source/verification commit: `c492413e514c75b7e761cad46d44afb8f2452788`.
- Publication verified October 21, 2026 America/Detroit (October 22 UTC). The frozen source snapshot dates remain unchanged.
- [Source commit CI](https://github.com/RahilBhavan/did-btc-resolver/actions/runs/39718505835): passed. The following receipt commit updates action pins to Node 24 runtime releases and adds documentation/evidence; application code is unchanged. The branch's [current CI](https://github.com/RahilBhavan/did-btc-resolver/actions/workflows/ci.yml) is authoritative for its final tip.

## Fresh GitHub clone checks

A new disk-backed clone of the public URL, with no shared dependency directory, ran:

```bash
npm ci
python3 scripts/restore_data.py
python3 -m unittest discover -s test -p '*_test.py' -v
npm run typecheck
npm test
BITCOIN_BIN="$HOME/scratch/did-btc-resolver/core/bitcoin-31.1/bin" bash scripts/run-regtest.sh
```

Observed with Node 26.8.1 / TypeScript 7.0.2 / Core 31.1:

- Locked install succeeded (23 packages, zero known vulnerabilities reported at installation).
- Both original frozen recordings restored with matching SHA-256 hashes.
- Three Python snapshot checks passed, including changed-file refusal, bad-hash rejection and repeat restoration.
- Typecheck passed; 58 Node tests discovered, 56 passed and two optional tests skipped.
- Core run: 58 discovered, 57 passed, one live API test skipped. Credential results `[true,false,true,false]`; old confirmed reveal rejected as missing/spent inputs.
- Same-chain Core restart: latest and historical resolutions exactly matched pre-restart results.

[Fresh clone regtest receipt](../results/reviewed-regtest-lifecycle.json) SHA-256: `6342cc7e24e61be7387a118391a518e5a5c433ddeaecd50ed30c5e028c8ed966`. This generated receipt contains transaction IDs, public document keys and resolution/credential results; no signing keys or RPC credentials. Its `asOf` is the new run date, separate from the original frozen recordings. Random transaction IDs are intentionally not reproducible.

## Review and publication safety

Three demonstrated problems were repaired: authentication-purpose credential acceptance, small-order Ed25519 signature acceptance and future controller state leaking into historical resolution. Each regression failed before its corresponding fix. See [review.md](review.md).

Tracked files, reachable Git-history blobs and decompressed recordings were inspected for credentials, personal/contact data, databases, caches and oversized content. No private artifacts were found. Existing commit author contact metadata was confirmed already present in public GitHub commits; new commits use GitHub noreply identity. Source files remain below 20,000 bytes and commits ran the repository hook. No history was rewritten or force-pushed.

The original v1 and frozen evidence were preserved. No license was selected. No mainnet transaction, account/trade, website deployment, recurring task or message publication was performed.

## Remaining limits

The unofficial draft and supported single-DID subset remain the scope. RPC/Esplora determine chain authority, heights and spend completeness. No independent consensus-chain verifier, complete script interpreter, witness-commitment validation, batch support or reorg indexer exists. Time selection uses potentially nonmonotonic block timestamps. The credential helper checks the supported signature and assertion relationship, not identity, claim truth, expiry, status or full VC semantics. Network calls have no timeout/retry policy. See [verification.md](verification.md) and [specification.md](specification.md).

## Update 2026-10-22: license

The MIT license was added in `LICENSE`. It covers this project's code only. Earlier statements in this record that no license file existed describe the state at publication.

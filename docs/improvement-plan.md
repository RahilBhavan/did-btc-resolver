# Conformance improvement: property updates and revocation

Scope (2026-10-22): preserve the existing unofficial Orange draft subset while
making generic document-property updates act on JSON own properties, and recognizing
deactivation by its decoded one-byte payload rather than one serialization.
No glossary or ADR directory exists in this checkout; terminology and decisions are
in `docs/specification.md`. Starting checkout was clean on `main`.

Done conditions:

1. Updates can add, update and delete JSON properties named `toString`,
   `constructor` and `__proto__` without inheriting JavaScript properties or
   changing object prototypes. A later invalid operation rolls back the entire
   update, including key rotation; previous versions remain unchanged.
2. Both minimal and PUSHDATA1/PUSHDATA2 encodings of OP_RETURN with the sole
   byte `d` deactivate. Empty, different, truncated and extra payloads do not.
   Historical versions remain readable and deactivation remains terminal.
3. Tests exercise signed synthetic spend chains through `resolve`, including
   ignored malformed updates, recovery with a subsequent valid update and
   revocation after recovery. Synthetic cases are not independent interoperability.
4. Retain existing genuine external vectors (BIP-136, W3C EdDSA, recorded upstream
   testnet creation); add a fixed-byte check of the draft's published creation
   script without running this project's builder. Record exact source provenance.
5. Run full offline/type/fixture checks and isolated Core reproduction when available;
   publish a five-minute offline command, measured results and remaining limits.

Non-goals: new protocol version, batch/full-VC support, public-chain writes,
independent consensus validation, UI, dependency/schema changes or licenses.

## Result and five-minute reproduction

Implemented and verified 2026-10-22 on Node 26.8.1. From this checkout:

```bash
npm ci
python3 scripts/restore_data.py
node --test test/property-conformance.test.ts test/wire-conformance.test.ts
npm run typecheck
npm test
python3 -m unittest discover -s test -p '*_test.py' -v
```

The focused example prints 22 passes, including missing-own-property rollback,
subsequent recovery, historical reads and terminal revocation. It took 0.689 seconds
wall time in one local run, including Node startup. This is a small correctness
fixture, not a throughput or production latency benchmark; install time depends on
the network. Nine property tests and three non-minimal revocation cases failed on
the original implementation before correction.

Full offline result: 80 discovered, 78 pass, 2 optional tests skipped. Typecheck
and all three Python fixture checks pass. The isolated Core 31.1 runner also
passed (79 pass, 1 live-Esplora skip; 9.20 seconds reported by Node), then printed
`Restart proof: latest and historical resolutions match the pre-restart receipt`.
That runner confirms the existing standard lifecycle; the new property and
non-minimal-encoding cases run in MemChain, not Core. Existing frozen recordings,
upstream pin, dependencies and schemas were not changed. The runner removed its
fresh node directory after shutdown.

Optional existing node reproduction (Core binaries required):

```bash
mkdir -p .scratch
BITCOIN_BIN=/path/to/bitcoin-31.1/bin bash scripts/run-regtest.sh > .scratch/lifecycle.json
```

## Evidence and limits

Re-read on 2026-10-22: [pinned Orange draft §Create, §Update and §Deactivate](https://github.com/MicroStrategy/did-btc-spec/blob/2c45a85f90ba5f013654351a3b0224c7f523d153/index.html).
The fixed creation ScriptPubKey, expected Ed25519 bytes and flags in
`test/wire-conformance.test.ts` come directly from §Create, independently of this
project's builder. This adds a focused known-answer assertion to the same upstream
example already covered by the recorded testnet fixture; it is not a new external
lifecycle vector. The update own-member behavior is this implementation's JSON
semantics correction; the draft does not discuss JavaScript prototypes.

The draft defines revocation by OP_RETURN's single-byte payload. Accepting
alternative push encodings is our interpretation of that rule, informed by
[Core 31.1's GetScriptOp decoder](https://github.com/bitcoin/bitcoin/blob/v31.1/src/script/script.cpp).
The encoding cases are synthetic, not upstream-published vectors or evidence of
mempool acceptance. The creator still emits the minimal encoding. No new
independently published Orange update/revocation lifecycle fixture was established
by this source review; such a fixture with raw transactions, chain context and
expected documents remains the input needed for independent lifecycle comparison.

RPC/Esplora remain authorities for chain selection and complete spends. No new
consensus validation, full VC semantics, batch operations, reorg handling or
historical credential policy is claimed. No public-network write was performed.

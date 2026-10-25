# Run details

Purpose: the regtest and testnet run details that the README leaves out. Setup and the main commands are in the [README](../README.md#run-it).

## Regtest demo

Get [Bitcoin Core 31.1](https://bitcoincore.org/en/releases/31.1/) and verify its download checksums. Set `BITCOIN_BIN` to the extracted `bin` directory:

```bash
mkdir -p .scratch
BITCOIN_BIN=/path/to/bitcoin-31.1/bin bash scripts/run-regtest.sh --keep > .scratch/lifecycle.json
```

The script starts a regtest node in `.scratch/` (git-ignored) on loopback port 18643 with P2P disabled. It runs the regtest tests, then `npm run demo`. The demo creates a DID, checks a credential signature, rotates the subject key in an update, deactivates the DID, checks that replaying an old transaction is rejected and prints each step as JSON. Then it restarts the node and checks current and historical resolution again. It mines test coins only. Port 18643 must be free. Fresh random keys and block timestamps make transaction IDs differ between runs. The lifecycle assertions are the same every run.

Without `--keep`, the script stops the node and deletes its data. With `--keep`, the node stays up and the script prints the environment for `npm run resolve` and the command that stops the node. `npm run demo` also runs on its own against a regtest node started with `txindex=1` and `txospenderindex=1` (it creates its own wallet), given `DID_BTC_RPC_URL`, `DID_BTC_RPC_USER` and `DID_BTC_RPC_PASSWORD`.

The DID prints as `did:btc:test:q…`. The draft defines only `did:btc:` (mainnet) and `did:btc:test:` (testnet). This project reuses the `test:` prefix for regtest and marks the network in the TxRef. Regtest TxRefs start with `q` or `p`, testnet TxRefs with `x` or `8` (see the [glossary](glossary.md)).

Resolving a past version (`--version-id`, `--version-time`) is shown in [verification](verification.md#query-a-past-version).

## Public testnet example

To resolve the upstream public testnet example read-only:

```bash
npm run resolve -- did:btc:test:xuh5-ayyy-q3q0-kp0 \
  --esplora https://blockstream.info/testnet/api --network testnet
```

That command requires network availability. Ordinary tests use frozen data. [Verification](verification.md) distinguishes offline vectors from live evidence.


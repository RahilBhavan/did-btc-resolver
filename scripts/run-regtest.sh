#!/usr/bin/env bash
# Disposable local chain; no P2P connections, public-network coins or persistent service.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BITCOIN_BIN:?Set BITCOIN_BIN to the Bitcoin Core 31.1 bin directory}"
mkdir -p "$HOME/scratch/did-btc-resolver"
run_dir=$(mktemp -d "$HOME/scratch/did-btc-resolver/run.XXXXXX")
export DID_BTC_RPC_URL=http://127.0.0.1:18643
export DID_BTC_RPC_USER=local-demo
export DID_BTC_RPC_PASSWORD
DID_BTC_RPC_PASSWORD=$(openssl rand -hex 24)
cli=("$BITCOIN_BIN/bitcoin-cli" -regtest "-datadir=$run_dir" -rpcport=18643)
cleanup() {
  "${cli[@]}" stop >/dev/null 2>&1 || true
  # Only this script's freshly-created disposable directory is removed.
  rm -rf "$run_dir"
}
# Core reads the local config; credentials are never included in committed evidence.
umask 077
cat > "$run_dir/bitcoin.conf" <<EOF
regtest=1
server=1
txindex=1
txospenderindex=1
fallbackfee=0.0001
listen=0
dnsseed=0
discover=0
rpcuser=$DID_BTC_RPC_USER
rpcpassword=$DID_BTC_RPC_PASSWORD
[regtest]
connect=0
rpcport=18643
rpcbind=127.0.0.1
EOF
trap cleanup EXIT
"$BITCOIN_BIN/bitcoind" "-datadir=$run_dir" -daemonwait >&2
"${cli[@]}" -rpcwait -rpcwaittimeout=30 getblockchaininfo >/dev/null
npm run test:regtest >&2
node src/cli.ts demo

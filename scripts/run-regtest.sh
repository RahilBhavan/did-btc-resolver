#!/usr/bin/env bash
# Disposable local chain; no P2P connections or public-network coins. Removed on exit unless --keep.
set -euo pipefail
cd "$(dirname "$0")/.."
usage='Usage: BITCOIN_BIN=/path/to/bitcoin-31.1/bin bash scripts/run-regtest.sh [--keep]
  Start a disposable regtest node (loopback port 18643, no P2P) in .scratch/, run the
  regtest tests and the create/update/deactivate demo, restart the node and check the
  results again. Prints the lifecycle JSON on stdout and progress on stderr.

Options:
  --keep      Leave the node running with its data afterwards, and print the
              environment for `npm run resolve` and the command that stops it.
  -h, --help  Show this help.'
keep=0
for arg in "$@"; do
  case "$arg" in
    --keep) keep=1 ;;
    -h|--help) echo "$usage"; exit 0 ;;
    -*) printf 'error: unknown option %s\n\n%s\n' "$arg" "$usage" >&2; exit 2 ;;
    *) printf 'error: unexpected argument %s\n\n%s\n' "$arg" "$usage" >&2; exit 2 ;;
  esac
done
: "${BITCOIN_BIN:?Set BITCOIN_BIN to the Bitcoin Core 31.1 bin directory (see --help)}"
mkdir -p .scratch
run_dir=$(mktemp -d "$PWD/.scratch/regtest.XXXXXX")
export DID_BTC_RPC_URL=http://127.0.0.1:18643
export DID_BTC_RPC_USER=local-demo
export DID_BTC_RPC_PASSWORD
DID_BTC_RPC_PASSWORD=$(openssl rand -hex 24)
cli=("$BITCOIN_BIN/bitcoin-cli" -regtest "-datadir=$run_dir" -rpcport=18643)
stop_node() {
  "${cli[@]}" stop >/dev/null 2>&1 || true
  for ((i=0; i<300; i++)); do
    test -e "$run_dir/regtest/bitcoind.pid" || return 0
    sleep 0.1
  done
  echo 'Node shutdown timed out; retaining its data directory' >&2
  return 1
}
cleanup() {
  stop_node || return
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
node src/cli.ts demo > "$run_dir/lifecycle.json"
stop_node
"$BITCOIN_BIN/bitcoind" "-datadir=$run_dir" -daemonwait >&2
"${cli[@]}" -rpcwait -rpcwaittimeout=30 getblockchaininfo >/dev/null
node scripts/check-restart.ts "$run_dir/lifecycle.json"
cat "$run_dir/lifecycle.json"
if [ "$keep" = 1 ]; then
  trap - EXIT
  did=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).did)' "$run_dir/lifecycle.json")
  cat >&2 <<EOF

Node left running (--keep). Data: $run_dir
Resolve the demo DID from this repository directory:
  export DID_BTC_RPC_URL=$DID_BTC_RPC_URL DID_BTC_RPC_USER=$DID_BTC_RPC_USER
  export DID_BTC_RPC_PASSWORD=\$(sed -n 's/^rpcpassword=//p' "$run_dir/bitcoin.conf")
  npm run resolve -- $did --version-id 1
Stop the node and delete its data:
  "$BITCOIN_BIN/bitcoin-cli" -regtest -datadir="$run_dir" -rpcport=18643 stop && sleep 2 && rm -rf "$run_dir"
EOF
fi

#!/usr/bin/env bash
# Download Bitcoin Core 31.1 (Linux x86_64) into DEST and verify its SHA-256 twice:
# against the official SHA256SUMS and against the hash pinned below. Prints the bin directory.
# Usage: bash scripts/install-bitcoin-core.sh DEST
set -euo pipefail
dest=${1:?usage: install-bitcoin-core.sh DEST}
version=31.1
file=bitcoin-$version-x86_64-linux-gnu.tar.gz
pinned=b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e
base=https://bitcoincore.org/bin/bitcoin-core-$version
mkdir -p "$dest"
cd "$dest"
curl -fsSLO "$base/$file"
curl -fsSLO "$base/SHA256SUMS"
grep " $file\$" SHA256SUMS | sha256sum -c - >&2
echo "$pinned  $file" | sha256sum -c - >&2
tar xzf "$file"
echo "$PWD/bitcoin-$version/bin"

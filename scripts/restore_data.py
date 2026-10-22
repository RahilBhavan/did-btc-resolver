"""Restore the committed, compressed source snapshot without network access.

Data blobs are partitioned into <=16 KB pieces to keep each Git file within this
workspace's size rule. The index retains original paths, sizes and SHA-256.
Run from any directory: python scripts/restore_data.py
"""
import gzip
import hashlib
import json
import sys
from pathlib import Path

USAGE = """Usage: python3 scripts/restore_data.py
  Unpack the recorded chain fixtures in data/frozen/ into test/fixtures/, checking SHA-256."""

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT / "data/frozen"


def restore(root=ROOT):
    index = json.loads((FROZEN / "index.json").read_text())
    for item in index:
        path = (root / item["path"]).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError("snapshot path escapes repository")
        data = gzip.decompress(b"".join((FROZEN / p).read_bytes() for p in item["parts"]))
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError(f"snapshot hash mismatch: {path}")
        if path.exists() and path.read_bytes() != data:
            raise ValueError(f"refusing to overwrite changed source: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return len(index)


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--help" in args or "-h" in args:
        print(USAGE)
        sys.exit(0)
    if args:
        kind = "unknown option" if args[0].startswith("-") else "unexpected argument"
        print(f"error: {kind} {args[0]}\n\n{USAGE}", file=sys.stderr)
        sys.exit(2)
    print(f"Restored {restore()} frozen source files (SHA-256 checked)")

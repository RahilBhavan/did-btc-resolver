"""Frozen recordings must restore idempotently and fail closed on corruption."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "restore_data", Path(__file__).resolve().parents[1] / "scripts/restore_data.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        scratch = Path.home() / "scratch/did-btc-resolver"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch, prefix="snapshot-test.")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_repeat_restore_preserves_original_bytes(self):
        self.assertEqual(module.restore(self.root), 2)
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        self.assertEqual(module.restore(self.root), 2)
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_changed_source_is_never_overwritten(self):
        module.restore(self.root)
        path = self.root / "test/fixtures/regtest-recording.json"
        path.write_text("changed locally")
        with self.assertRaisesRegex(ValueError, "refusing to overwrite"):
            module.restore(self.root)
        self.assertEqual(path.read_text(), "changed locally")

    def test_wrong_hash_is_rejected_before_write(self):
        import json
        original = module.FROZEN
        index = json.loads((original / "index.json").read_text())
        for item in index:
            for part in item["parts"]:
                (self.root / part).write_bytes((original / part).read_bytes())
        index[0]["sha256"] = "0" * 64
        (self.root / "index.json").write_text(json.dumps(index))
        module.FROZEN = self.root
        self.addCleanup(setattr, module, "FROZEN", original)
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            module.restore(self.root)
        self.assertFalse((self.root / index[0]["path"]).exists())

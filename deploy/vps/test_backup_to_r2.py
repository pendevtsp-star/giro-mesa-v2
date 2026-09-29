"""Small confinement check for scheduled backup retention."""

import hashlib
import json
from pathlib import Path
import runpy
import tempfile


prune = runpy.run_path(str(Path(__file__).with_name("backup-to-r2.py")), run_name="backup_to_r2_test")["prune_scheduled"]
now = 1_000_000

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    scheduled = root / "scheduled"
    scheduled.mkdir()
    outside = root / "outside"
    outside.mkdir()
    (outside / "keep").write_text("safe")
    old = scheduled / ("20260929T000000Z-" + "a" * 32)
    old.mkdir()
    manifest = old / "manifest.json"
    manifest.write_text("signed")
    (old / ".r2-verified.json").write_text(json.dumps({
        "backupId": old.name,
        "manifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "verifiedAt": now - 24 * 60 * 60 - 1,
    }))
    incomplete = scheduled / ("20260929T000100Z-" + "b" * 32)
    incomplete.mkdir()
    (incomplete / "manifest.json").write_text("signed")
    link = scheduled / ("20260929T000200Z-" + "c" * 32)
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:  # Windows without Developer Mode cannot create test symlinks.
        pass

    prune(scheduled, now=now)
    assert not old.exists()
    assert incomplete.exists()
    assert (outside / "keep").read_text() == "safe"

print("backup retention confinement: passed")

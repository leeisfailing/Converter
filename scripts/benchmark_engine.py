"""Measure local JSON command startup without network or media processing."""
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
timings = []
for _ in range(5):
    started = time.perf_counter()
    result = subprocess.run(
        [sys.executable, str(root / "Engine/__main__.py")],
        input=json.dumps({"cmd": "detect_file", "path": str(root / "README.md")}) + "\n",
        capture_output=True, text=True, check=True,
    )
    json.loads(result.stdout)
    timings.append(time.perf_counter() - started)
print(f"Median engine command startup (5 runs): {statistics.median(timings):.3f}s")

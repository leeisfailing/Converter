"""Exercise Linux resources after copying them away from the source checkout."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True,
                            timeout=120, **kwargs)
    if result.returncode:
        raise AssertionError(f"Command failed: {args}\n{result.stderr}")
    return result


async def request_engine(command, request, resources, env):
    process = await asyncio.create_subprocess_exec(
        *(str(arg) for arg in command), cwd=resources, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    errors = asyncio.create_task(process.stderr.read())
    try:
        process.stdin.write((json.dumps(request) + "\n").encode())
        await process.stdin.drain()
        async with asyncio.timeout(120):
            while line := await process.stdout.readline():
                response = json.loads(line)
                if response.get("type") == "finished":
                    assert response["ok"], response
                    break
                if response.get("ok") is False:
                    raise AssertionError(response)
            else:
                raise AssertionError("Engine exited without a finished response")
        process.stdin.close()
        await asyncio.wait_for(process.wait(), timeout=10)
        assert process.returncode == 0, (await errors).decode()
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
        await errors


def main():
    with tempfile.TemporaryDirectory(prefix="Converter installed ") as directory:
        resources = Path(directory)
        engine = resources / "PyEngine"
        shutil.copytree(ROOT / "PyEngine", engine,
                        ignore=shutil.ignore_patterns("bin", "tests", "__pycache__", "*.pyc"))
        shutil.copytree(ROOT / "rust/src-tauri/bin/linux/python", engine / "bin/python", symlinks=True)
        shutil.copy2(ROOT / "cpp_engine/build-linux/gpu_engine", resources / "gpu_engine")
        triple = next(line.removeprefix("host: ") for line in run(["rustc", "-vV"]).stdout.splitlines()
                      if line.startswith("host: "))
        for name in ("ffmpeg", "ffprobe"):
            shutil.copy2(ROOT / f"rust/src-tauri/bin/converter-{name}-{triple}", resources / f"converter-{name}")
        env = dict(os.environ)
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        # Native engines must resolve sidecars beside their installed binary.
        env["PATH"] = str(resources)
        python = engine / "bin/python/bin/python3"
        source = resources / "source 'clip'.mp4"
        run([resources / "converter-ffmpeg", "-v", "error", "-f", "lavfi", "-i",
             "testsrc2=size=160x120:rate=10:duration=1", "-c:v", "libx264", source], env=env)
        lookup = run([python, "-B", "-c",
                      "import sys; sys.path.insert(0, '.'); "
                      "from PyEngine.core.config import find_binary; "
                      "import yt_dlp, yt_dlp_ejs, cv2, onnxruntime, numpy; "
                      "print(find_binary('ffmpeg')); print(find_binary('deno'))"], cwd=resources, env=env)
        for tool in lookup.stdout.splitlines():
            assert Path(tool).is_file() and Path(tool).resolve().is_relative_to(resources)
        run([engine / "bin/python/bin/deno", "--version"], env=env)
        for backend, command in (("python", [python, "-B", engine / "__main__.py"]),
                                 ("cpp", [resources / "gpu_engine"])):
            output = resources / f"{backend} output.mp4"
            request = {"cmd": "start_convert", "input": str(source), "output": str(output),
                       "format": "mp4", "use_gpu": False, "preferred_encoder": ""}
            asyncio.run(request_engine(command, request, resources, env))
            metadata = json.loads(run([resources / "converter-ffprobe", "-v", "error", "-show_streams",
                                       "-of", "json", output], env=env).stdout)
            assert metadata["streams"][0]["width"] == 160
            reduced = resources / f"{backend} reduced.mp4"
            request.update(cmd="start_transcoder", output=str(reduced), file_type="video", quality=60)
            asyncio.run(request_engine(command, request, resources, env))
            assert reduced.stat().st_size > 0
    print("Detached Linux Python, native engine, tool lookup, conversion and reduction passed.")


if __name__ == "__main__":
    main()

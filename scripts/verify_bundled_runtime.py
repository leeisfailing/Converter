"""Smoke-test the configured Windows resources from a detached installation tree."""
import glob
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

ROOT = Path(__file__).resolve().parent.parent
TAURI = ROOT / "rust/src-tauri"


def main():
    config = json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="Converter installed ") as directory:
        installed = Path(directory)
        # Match Tauri resource-map semantics: directory entries recurse; globs
        # select files and flatten them into the specified target directory.
        for pattern, target in config["bundle"]["resources"].items():
            source = TAURI / pattern
            destination = installed / target
            if glob.has_magic(pattern):
                matches = [Path(path) for path in glob.glob(str(source)) if Path(path).is_file()]
                assert matches, f"Resource pattern matched no files: {pattern}"
                destination.mkdir(parents=True, exist_ok=True)
                for path in matches:
                    shutil.copy2(path, destination / path.name)
            elif source.is_dir():
                shutil.copytree(source, destination, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        for sidecar in config["bundle"]["externalBin"]:
            source = TAURI / f"{sidecar}-x86_64-pc-windows-msvc.exe"
            shutil.copy2(source, installed / (Path(sidecar).name + ".exe"))

        runtime = installed / "Engine/bin/python"
        python = runtime / "python.exe"
        environment = dict(os.environ)
        environment["PATH"] = str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32")
        for key in ("PYTHONHOME", "PYTHONPATH", "VSSCRIPT_PATH", "VAPOURSYNTH_EXTRA_PLUGIN_PATH"):
            environment.pop(key, None)

        def run(arguments, **kwargs):
            result = subprocess.run(arguments, cwd=installed, env=environment, text=True,
                                    capture_output=True, timeout=60, **kwargs)
            if result.returncode:
                raise AssertionError(f"{arguments}\n{result.stdout}\n{result.stderr}")
            return result

        probe = run([str(python), "-I", "-B", "-c",
            "import json, sys, pathlib, yt_dlp.version, yt_dlp_ejs, vapoursynth as vs; "
            "from Engine.core.config import find_binary; "
            "print(json.dumps({'python':sys.executable, 'yt_dlp':yt_dlp.version.__version__, "
            "'vapoursynth':str(vs.__version__), 'tools':{n:find_binary(n) for n in "
            "('ffmpeg','ffprobe','vspipe','deno')}}))"])
        details = json.loads(probe.stdout)
        for path in [details["python"], *details["tools"].values()]:
            assert Path(path).is_relative_to(installed), f"Tool escaped installed resources: {path}"
        assert "site-packages" in details["tools"]["vspipe"]
        for name in ("ffmpeg", "ffprobe"):
            run([details["tools"][name], "-version"])
        run([details['tools']['deno'], '--version'])

        audio = installed / "test audio ไทย.wav"
        with wave.open(str(audio), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\0" * 1600)
        detected = run([str(python), "-I", "-B", "-u", "-X", "utf8", str(installed / "Engine/__main__.py")],
                       input=json.dumps({"cmd": "detect_file", "path": str(audio)}) + "\n")
        response = json.loads(detected.stdout)
        assert response["ok"], response

        script = installed / "blank.vpy"
        script.write_text("import vapoursynth as vs\nvs.core.std.BlankClip(width=16, height=16, length=1).set_output()\n")
        vspipe = Path(details["tools"]["vspipe"])
        environment["VSSCRIPT_PATH"] = str(vspipe.with_name("vsscript.dll"))
        run([str(vspipe), "--info", str(script), "-"])
        # Exercise an actual encode using the packaged tools with system PATH removed.
        converted = installed / 'converted.mp3'
        run([details['tools']['ffmpeg'], '-v', 'error', '-i', str(audio), '-c:a', 'libmp3lame', str(converted)])
        assert converted.stat().st_size > 0
        print("Detached bundle smoke test passed: Python, yt-dlp/EJS, Deno, ffmpeg, ffprobe, engine IPC, audio encoding, VapourSynth/vspipe.")
        print(json.dumps({key: details[key] for key in ("yt_dlp", "vapoursynth")}))


if __name__ == "__main__":
    main()

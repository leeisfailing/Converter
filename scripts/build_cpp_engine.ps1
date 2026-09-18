$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# Use a fresh build tree instead of the machine-specific tracked CMake cache.
$build = Join-Path $root '.runtime-downloads/cpp-ci'
cmake -S (Join-Path $root 'cpp_engine') -B $build -A x64
if ($LASTEXITCODE -ne 0) { throw 'C++ engine configuration failed.' }
cmake --build $build --config Release --parallel
if ($LASTEXITCODE -ne 0) { throw 'C++ engine build failed.' }
ctest --test-dir $build -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'C++ engine tests failed.' }
$destination = Join-Path $root 'cpp_engine/build'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'Release/gpu_engine.exe') -Destination (Join-Path $destination 'gpu_engine.exe')

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# Use a fresh build tree instead of the machine-specific tracked CMake cache.
$build = Join-Path $root '.runtime-downloads/cpp-ci'
# Match Linux's bounded default; allow CI and developers to choose a job budget.
$jobs = [Math]::Min([Environment]::ProcessorCount, 4)
if ($env:CMAKE_BUILD_PARALLEL_LEVEL) {
    $configuredJobs = 0
    if (-not [int]::TryParse($env:CMAKE_BUILD_PARALLEL_LEVEL, [ref]$configuredJobs) -or $configuredJobs -lt 1) {
        throw 'CMAKE_BUILD_PARALLEL_LEVEL must be a positive integer.'
    }
    $jobs = $configuredJobs
}
cmake -S (Join-Path $root 'cpp_engine') -B $build -A x64
if ($LASTEXITCODE -ne 0) { throw 'C++ engine configuration failed.' }
cmake --build $build --config Release --parallel $jobs
if ($LASTEXITCODE -ne 0) { throw 'C++ engine build failed.' }
ctest --test-dir $build -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'C++ engine tests failed.' }
$destination = Join-Path $root 'cpp_engine/build'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'Release/gpu_engine.exe') -Destination (Join-Path $destination 'gpu_engine.exe')

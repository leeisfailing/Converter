cmake_minimum_required(VERSION 3.20)
project(gpu_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# nlohmann/json is vendored as a single header in include/nlohmann/json.hpp

add_executable(gpu_engine
    src/main.cpp
    src/config.cpp
    src/security.cpp
    src/formats.cpp
    src/ipc.cpp
    src/gpu.cpp
    src/media.cpp
    src/ffmpeg_worker.cpp
    src/converter.cpp
    src/reducer.cpp
    src/upscaler.cpp
    src/target_size.cpp
    src/handlers.cpp
)

target_include_directories(gpu_engine PRIVATE include)


if(WIN32)
    target_link_libraries(gpu_engine PRIVATE shell32 shlwapi ole32)
    target_compile_definitions(gpu_engine PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

include(CTest)
if(BUILD_TESTING)
    add_executable(worker_tests tests/worker_tests.cpp src/ffmpeg_worker.cpp)
    target_include_directories(worker_tests PRIVATE include)
    if(WIN32)
        target_compile_definitions(worker_tests PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
    endif()
    add_test(NAME worker_lifecycle COMMAND worker_tests)
    set_tests_properties(worker_lifecycle PROPERTIES TIMEOUT 30)
endif()

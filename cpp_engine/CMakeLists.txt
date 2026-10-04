cmake_minimum_required(VERSION 3.20)
project(gpu_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Surface unused code and ignored return values without failing the build;
# -Werror is deliberately not set.
if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra)
endif()

# nlohmann/json is vendored as a single header in include/nlohmann/json.hpp

# Compile the worker once for both the engine and its lifecycle tests.
add_library(ffmpeg_worker STATIC src/ffmpeg_worker.cpp)
target_include_directories(ffmpeg_worker PUBLIC include)
if(UNIX)
    find_package(Threads REQUIRED)
    target_link_libraries(ffmpeg_worker PUBLIC Threads::Threads)
endif()
if(WIN32)
    target_compile_definitions(ffmpeg_worker PUBLIC UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

add_executable(gpu_engine
    src/main.cpp
    src/config.cpp
    src/security.cpp
    src/formats.cpp
    src/ipc.cpp
    src/gpu.cpp
    src/media.cpp
    src/converter.cpp
    src/reducer.cpp
    src/upscaler.cpp
    src/target_size.cpp
    src/handlers.cpp
)

target_include_directories(gpu_engine PRIVATE include)
target_link_libraries(gpu_engine PRIVATE ffmpeg_worker)


if(WIN32)
    target_link_libraries(gpu_engine PRIVATE shell32 shlwapi ole32)
    target_compile_definitions(gpu_engine PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

include(CTest)
if(BUILD_TESTING)
    add_executable(worker_tests tests/worker_tests.cpp src/media.cpp src/config.cpp src/security.cpp)
    target_link_libraries(worker_tests PRIVATE ffmpeg_worker)
    if(WIN32)
        target_link_libraries(worker_tests PRIVATE shlwapi)
    endif()
    add_test(NAME worker_lifecycle COMMAND worker_tests)
    set_tests_properties(worker_lifecycle PROPERTIES TIMEOUT 30)
    add_test(NAME ipc_invalid_commands COMMAND ${CMAKE_COMMAND}
        -DENGINE=$<TARGET_FILE:gpu_engine>
        -DREQUESTS=${CMAKE_CURRENT_SOURCE_DIR}/tests/ipc_requests.jsonl
        -P ${CMAKE_CURRENT_SOURCE_DIR}/tests/ipc_tests.cmake)
endif()

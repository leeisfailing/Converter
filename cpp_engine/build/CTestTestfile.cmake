# CMake generated Testfile for 
# Source directory: C:/Users/Lee/Desktop/Converter/cpp_engine
# Build directory: C:/Users/Lee/Desktop/Converter/cpp_engine/build
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
if(CTEST_CONFIGURATION_TYPE MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
  add_test("worker_lifecycle" "C:/Users/Lee/Desktop/Converter/cpp_engine/build/Debug/worker_tests.exe")
  set_tests_properties("worker_lifecycle" PROPERTIES  TIMEOUT "30" _BACKTRACE_TRIPLES "C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;40;add_test;C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
  add_test("worker_lifecycle" "C:/Users/Lee/Desktop/Converter/cpp_engine/build/Release/worker_tests.exe")
  set_tests_properties("worker_lifecycle" PROPERTIES  TIMEOUT "30" _BACKTRACE_TRIPLES "C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;40;add_test;C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
  add_test("worker_lifecycle" "C:/Users/Lee/Desktop/Converter/cpp_engine/build/MinSizeRel/worker_tests.exe")
  set_tests_properties("worker_lifecycle" PROPERTIES  TIMEOUT "30" _BACKTRACE_TRIPLES "C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;40;add_test;C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
  add_test("worker_lifecycle" "C:/Users/Lee/Desktop/Converter/cpp_engine/build/RelWithDebInfo/worker_tests.exe")
  set_tests_properties("worker_lifecycle" PROPERTIES  TIMEOUT "30" _BACKTRACE_TRIPLES "C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;40;add_test;C:/Users/Lee/Desktop/Converter/cpp_engine/CMakeLists.txt;0;")
else()
  add_test("worker_lifecycle" NOT_AVAILABLE)
endif()

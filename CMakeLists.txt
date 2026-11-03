cmake_minimum_required(VERSION 3.21)

project(Nexus
    VERSION 0.1.0
    DESCRIPTION "NEXUS — native GPU-accelerated command environment for AI coding agents"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(NEXUS_BUILD_TESTS "Build unit tests" ON)

# Qt 6.7 is the minimum (public QQuickRhiItem). 6.8 LTS is the reference version.
find_package(Qt6 6.7 REQUIRED COMPONENTS
    Core Gui Quick QuickControls2 ShaderTools Sql Network Concurrent)

qt_standard_project_setup(REQUIRES 6.7)

if(MSVC)
    add_compile_options(/W4 /permissive-)
else()
    add_compile_options(-Wall -Wextra -Wno-unused-parameter)
endif()

if(EXISTS ${CMAKE_SOURCE_DIR}/relay/CMakeLists.txt)
    add_subdirectory(relay)
endif()
add_subdirectory(src)

if(NEXUS_BUILD_TESTS AND EXISTS ${CMAKE_SOURCE_DIR}/tests/CMakeLists.txt)
    enable_testing()
    add_subdirectory(tests)
endif()

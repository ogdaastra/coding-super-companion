# nexus-relay: tiny forwarder executed by Claude Code hooks. Depends only on QtCore and
# QtNetwork so that it starts quickly.
qt_add_executable(nexus-relay
    main.cpp
    ${CMAKE_SOURCE_DIR}/src/core/Paths.cpp
    ${CMAKE_SOURCE_DIR}/src/core/Paths.h
)
target_include_directories(nexus-relay PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_definitions(nexus-relay PRIVATE NEXUS_VERSION="${PROJECT_VERSION}")
target_link_libraries(nexus-relay PRIVATE Qt6::Core Qt6::Network)
set_target_properties(nexus-relay PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/src)   # next to the nexus executable
install(TARGETS nexus-relay RUNTIME DESTINATION bin)

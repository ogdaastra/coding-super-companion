# ---------------------------------------------------------------------------------------
# nexus_core: GUI-independent logic (events, ingest, store, sessions, project analysis,
# integration). Linked by the application and by the unit tests.
# ---------------------------------------------------------------------------------------
file(GLOB NEXUS_CORE_SOURCES CONFIGURE_DEPENDS
    core/*.cpp core/*.h
    ingest/*.cpp ingest/*.h
    store/*.cpp store/*.h
    session/*.cpp session/*.h
    project/*.cpp project/*.h
    graph/*.cpp graph/*.h
    integration/*.cpp integration/*.h
    sim/*.cpp sim/*.h)

if(NEXUS_CORE_SOURCES)
    qt_add_library(nexus_core STATIC ${NEXUS_CORE_SOURCES})
    target_include_directories(nexus_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(nexus_core PUBLIC Qt6::Core Qt6::Gui Qt6::Network Qt6::Sql Qt6::Concurrent)
    target_compile_definitions(nexus_core PUBLIC NEXUS_VERSION="${PROJECT_VERSION}")
endif()

# ---------------------------------------------------------------------------------------
# nexus: the desktop application
# ---------------------------------------------------------------------------------------
qt_add_executable(nexus
    app/main.cpp
)

file(GLOB NEXUS_APP_SOURCES CONFIGURE_DEPENDS app/*.cpp app/*.h render/*.cpp render/*.h ui/*.cpp ui/*.h)
list(REMOVE_ITEM NEXUS_APP_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/app/main.cpp)

file(GLOB_RECURSE NEXUS_QML_FILES RELATIVE ${CMAKE_CURRENT_SOURCE_DIR} CONFIGURE_DEPENDS qml/*.qml)

# Singletons (design tokens)
file(GLOB NEXUS_QML_SINGLETONS RELATIVE ${CMAKE_CURRENT_SOURCE_DIR} qml/theme/*.qml)
set_source_files_properties(${NEXUS_QML_SINGLETONS} PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

# Flatten resource paths so every QML type resolves within the single "Nexus" module.
foreach(f ${NEXUS_QML_FILES})
    get_filename_component(base ${f} NAME)
    set_source_files_properties(${f} PROPERTIES QT_RESOURCE_ALIAS ${base})
endforeach()

qt_add_qml_module(nexus
    URI Nexus
    VERSION 1.0
    QML_FILES ${NEXUS_QML_FILES}
    SOURCES ${NEXUS_APP_SOURCES}
)

target_include_directories(nexus PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/render ${CMAKE_CURRENT_SOURCE_DIR}/ui ${CMAKE_CURRENT_SOURCE_DIR}/app)
target_compile_definitions(nexus PRIVATE NEXUS_VERSION="${PROJECT_VERSION}")
target_link_libraries(nexus PRIVATE
    Qt6::Core Qt6::Gui Qt6::GuiPrivate Qt6::Quick Qt6::QuickControls2 Qt6::Network Qt6::Sql Qt6::Concurrent)
if(TARGET nexus_core)
    target_link_libraries(nexus PRIVATE nexus_core)
endif()

# Shaders: Vulkan-style GLSL 440 compiled by qsb to SPIR-V, GLSL (ES 3.0/330/430), HLSL and MSL.
file(GLOB NEXUS_SHADERS CONFIGURE_DEPENDS
    ${CMAKE_SOURCE_DIR}/shaders/*.vert
    ${CMAKE_SOURCE_DIR}/shaders/*.frag
    ${CMAKE_SOURCE_DIR}/shaders/*.comp)
set(NEXUS_GRAPHICS_SHADERS ${NEXUS_SHADERS})
list(FILTER NEXUS_GRAPHICS_SHADERS EXCLUDE REGEX "\\.comp$")
set(NEXUS_COMPUTE_SHADERS ${NEXUS_SHADERS})
list(FILTER NEXUS_COMPUTE_SHADERS INCLUDE REGEX "\\.comp$")

qt_add_shaders(nexus "nexus_shaders"
    PREFIX "/shaders"
    BASE ${CMAKE_SOURCE_DIR}/shaders
    GLSL "330,300es,430"
    FILES ${NEXUS_GRAPHICS_SHADERS})

qt_add_shaders(nexus "nexus_compute_shaders"
    PREFIX "/shaders"
    BASE ${CMAKE_SOURCE_DIR}/shaders
    GLSL "430,310es"
    COMPUTE
    FILES ${NEXUS_COMPUTE_SHADERS})

# Fonts (OFL / Apache-2.0, licences in assets/fonts)
file(GLOB NEXUS_FONTS ${CMAKE_SOURCE_DIR}/assets/fonts/*.otf ${CMAKE_SOURCE_DIR}/assets/fonts/*.ttf)
qt_add_resources(nexus "nexus_fonts"
    PREFIX "/fonts"
    BASE ${CMAKE_SOURCE_DIR}/assets/fonts
    FILES ${NEXUS_FONTS})

set_target_properties(nexus PROPERTIES
    WIN32_EXECUTABLE ON
    MACOSX_BUNDLE ON
    OUTPUT_NAME nexus)

install(TARGETS nexus BUNDLE DESTINATION . RUNTIME DESTINATION bin)

# NEXUS MCP server (Python, standard library only) ships next to the executable.
configure_file(${CMAKE_SOURCE_DIR}/integration/mcp/nexus_mcp.py ${CMAKE_CURRENT_BINARY_DIR}/nexus_mcp.py COPYONLY)
install(FILES ${CMAKE_SOURCE_DIR}/integration/mcp/nexus_mcp.py DESTINATION bin)

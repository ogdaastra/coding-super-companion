#pragma once

#include <QString>

class QQuickWindow;

namespace nexus::app {

struct GraphicsChoice {
    QString requested;   // "auto", "vulkan", "opengl", "metal", "d3d11", "d3d12"
    QString effective;   // what we asked Qt Quick for
};

// Must run before QGuiApplication is constructed (sets the default surface format and
// the scene graph graphics API). Reads --backend=<api> and NEXUS_BACKEND.
GraphicsChoice configureGraphicsBeforeApp(int argc, char *argv[]);

// Applies per-window configuration (GPU timestamps for frame-time measurement).
void configureWindow(QQuickWindow *window, const GraphicsChoice &choice);

} // namespace nexus::app

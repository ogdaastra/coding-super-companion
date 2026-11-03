#include "GraphicsSetup.h"

#include <QQuickGraphicsConfiguration>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSurfaceFormat>
#include <cstring>

namespace nexus::app {

GraphicsChoice configureGraphicsBeforeApp(int argc, char *argv[])
{
    GraphicsChoice choice;
    choice.requested = qEnvironmentVariable("NEXUS_BACKEND", QStringLiteral("auto")).toLower();
    for (int i = 1; i < argc; ++i) {
        if (std::strncmp(argv[i], "--backend=", 10) == 0)
            choice.requested = QString::fromLocal8Bit(argv[i] + 10).toLower();
    }

    QSGRendererInterface::GraphicsApi api = QSGRendererInterface::Unknown;
    if (choice.requested == QLatin1String("vulkan"))
        api = QSGRendererInterface::Vulkan;
    else if (choice.requested == QLatin1String("opengl") || choice.requested == QLatin1String("gl"))
        api = QSGRendererInterface::OpenGL;
    else if (choice.requested == QLatin1String("metal"))
        api = QSGRendererInterface::Metal;
    else if (choice.requested == QLatin1String("d3d11"))
        api = QSGRendererInterface::Direct3D11;
    else if (choice.requested == QLatin1String("d3d12"))
        api = QSGRendererInterface::Direct3D12;

    if (api != QSGRendererInterface::Unknown)
        QQuickWindow::setGraphicsApi(api);

    // OpenGL needs 4.3 core for compute shaders (GPU particles). Platforms that default
    // to other APIs ignore this. On drivers without 4.3 the CPU particle path is used.
    QSurfaceFormat fmt = QSurfaceFormat::defaultFormat();
#ifndef Q_OS_MACOS
    fmt.setVersion(4, 3);
    fmt.setProfile(QSurfaceFormat::CoreProfile);
#endif
    fmt.setDepthBufferSize(24);
    fmt.setStencilBufferSize(8);
    fmt.setSwapInterval(1);
    QSurfaceFormat::setDefaultFormat(fmt);

    switch (api) {
    case QSGRendererInterface::Vulkan: choice.effective = QStringLiteral("vulkan"); break;
    case QSGRendererInterface::OpenGL: choice.effective = QStringLiteral("opengl"); break;
    case QSGRendererInterface::Metal: choice.effective = QStringLiteral("metal"); break;
    case QSGRendererInterface::Direct3D11: choice.effective = QStringLiteral("d3d11"); break;
    case QSGRendererInterface::Direct3D12: choice.effective = QStringLiteral("d3d12"); break;
    default: choice.effective = QStringLiteral("platform default"); break;
    }
    return choice;
}

void configureWindow(QQuickWindow *window, const GraphicsChoice &)
{
    QQuickGraphicsConfiguration config = window->graphicsConfiguration();
    config.setTimestamps(true);  // enables QRhiCommandBuffer::lastCompletedGpuTime()
    window->setGraphicsConfiguration(config);
    window->setColor(QColor(2, 4, 10));
}

} // namespace nexus::app

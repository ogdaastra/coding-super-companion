#include "AppController.h"

#include <QCommandLineParser>
#include <QCoreApplication>
#include <QImage>
#include <QQuickWindow>
#include <QTimer>
#include <cstdio>

namespace nexus::app {

AppController::AppController(const GraphicsChoice &gfx, QObject *parent)
    : QObject(parent), m_gfx(gfx)
{
}

AppController::~AppController() = default;

QString AppController::version() const
{
    return QCoreApplication::applicationVersion();
}

bool AppController::parseCommandLine(const QStringList &args)
{
    QCommandLineParser p;
    p.setApplicationDescription(QStringLiteral("NEXUS — native command environment for AI coding agents"));
    p.addHelpOption();
    p.addVersionOption();
    p.addOption({ QStringLiteral("backend"), QStringLiteral("Graphics API: auto, vulkan, opengl, metal, d3d11, d3d12."), QStringLiteral("api") });
    p.addOption({ QStringLiteral("project"), QStringLiteral("Open this project directory on start."), QStringLiteral("path") });
    p.addOption({ QStringLiteral("screenshot"), QStringLiteral("Save a screenshot to <file> and quit (for automated visual review)."), QStringLiteral("file") });
    p.addOption({ QStringLiteral("screenshot-delay"), QStringLiteral("Delay before the screenshot in ms (default 4000)."), QStringLiteral("ms") });
    p.process(args);
    m_screenshotPath = p.value(QStringLiteral("screenshot"));
    if (p.isSet(QStringLiteral("screenshot-delay")))
        m_screenshotDelayMs = p.value(QStringLiteral("screenshot-delay")).toInt();
    m_initialProject = p.value(QStringLiteral("project"));
    return true;
}

void AppController::attachWindow(QQuickWindow *window)
{
    m_window = window;
}

void AppController::start()
{
    if (!m_screenshotPath.isEmpty())
        scheduleScreenshot();
}

void AppController::scheduleScreenshot()
{
    QTimer::singleShot(m_screenshotDelayMs, this, [this]() {
        if (!m_window)
            return;
        const QImage img = m_window->grabWindow();
        const bool ok = img.save(m_screenshotPath);
        std::fprintf(stderr, "NEXUS: screenshot %s -> %s\n", ok ? "saved" : "FAILED", qPrintable(m_screenshotPath));
        QCoreApplication::quit();
    });
}

} // namespace nexus::app

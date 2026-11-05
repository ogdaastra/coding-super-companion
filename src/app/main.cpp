#include "AppController.h"
#include "GraphicsSetup.h"
#include "core/Paths.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QMutex>
#include <algorithm>
#include <QFontDatabase>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>

namespace {

// Info, warnings and errors also go to <data>/nexus.log. On Windows the app has no console
// (WIN32 subsystem), so without this a graphics failure would leave no trace at all.
QtMessageHandler g_previousHandler = nullptr;
QFile *g_logFile = nullptr;
QMutex g_logMutex;

void logToFile(QtMsgType type, const QMessageLogContext &ctx, const QString &msg)
{
    if (type != QtDebugMsg) {
        QMutexLocker lock(&g_logMutex);
        // Capped: a per-frame warning must not fill the disk.
        if (g_logFile && g_logFile->isOpen() && g_logFile->size() < 4 * 1024 * 1024) {
            static const char *const names[] = { "debug", "warning", "critical", "fatal", "info" };
            const QByteArray line = QDateTime::currentDateTime().toString(Qt::ISODateWithMs).toUtf8()
                + ' ' + names[std::min<int>(int(type), 4)] + ": " + msg.toUtf8() + '\n';
            g_logFile->write(line);
            g_logFile->flush();
        }
    }
    if (g_previousHandler)
        g_previousHandler(type, ctx, msg);
}

void installFileLog()
{
    if (!nexus::core::Paths::ensurePrivateDir(nexus::core::Paths::dataDir()))
        return;
    g_logFile = new QFile(nexus::core::Paths::logFile());
    // One log per launch, so it never grows without bound.
    if (!g_logFile->open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
        delete g_logFile;
        g_logFile = nullptr;
        return;
    }
    g_previousHandler = qInstallMessageHandler(logToFile);
}

} // namespace

int main(int argc, char *argv[])
{
    QCoreApplication::setOrganizationName(QStringLiteral("Nexus"));
    QCoreApplication::setOrganizationDomain(QStringLiteral("nexus.local"));
    QCoreApplication::setApplicationName(QStringLiteral("NEXUS"));
    QCoreApplication::setApplicationVersion(QStringLiteral(NEXUS_VERSION));

    const nexus::app::GraphicsChoice gfx = nexus::app::configureGraphicsBeforeApp(argc, argv);

    QGuiApplication app(argc, argv);
    installFileLog();
    qInfo("NEXUS %s, graphics: requested %s, using %s", NEXUS_VERSION, qPrintable(gfx.requested),
          qPrintable(gfx.effective));

    for (const char *font : { "Inter-Light.otf", "Inter-Regular.otf", "Inter-Medium.otf", "Inter-SemiBold.otf",
                              "InterDisplay-Light.otf", "JetBrainsMono-Regular.ttf", "JetBrainsMono-Medium.ttf" })
        QFontDatabase::addApplicationFont(QStringLiteral(":/fonts/") + QLatin1String(font));
    QFont base(QStringLiteral("Inter"));
    base.setPixelSize(13);
    base.setHintingPreference(QFont::PreferVerticalHinting);
    QGuiApplication::setFont(base);

    nexus::app::AppController controller(gfx);
    if (!controller.parseCommandLine(app.arguments()))
        return 0;

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("nexus"), &controller);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app,
                     []() { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.loadFromModule("Nexus", "Main");
    if (engine.rootObjects().isEmpty())
        return 1;

    auto *window = qobject_cast<QQuickWindow *>(engine.rootObjects().constFirst());
    if (!window)
        return 1;
    nexus::app::configureWindow(window, gfx);
    controller.attachWindow(window);
    window->show();
    controller.start();
    return app.exec();
}

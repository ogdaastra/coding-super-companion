#include "AppController.h"
#include "GraphicsSetup.h"

#include <QDir>
#include <QFontDatabase>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>

int main(int argc, char *argv[])
{
    QCoreApplication::setOrganizationName(QStringLiteral("Nexus"));
    QCoreApplication::setOrganizationDomain(QStringLiteral("nexus.local"));
    QCoreApplication::setApplicationName(QStringLiteral("NEXUS"));
    QCoreApplication::setApplicationVersion(QStringLiteral(NEXUS_VERSION));

    const nexus::app::GraphicsChoice gfx = nexus::app::configureGraphicsBeforeApp(argc, argv);

    QGuiApplication app(argc, argv);

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

#pragma once

#include "GraphicsSetup.h"

#include <QObject>
#include <QPointer>
#include <QString>
#include <QStringList>

class QQuickWindow;

namespace nexus::app {

// Composition root: owns the subsystems and exposes them to QML as `nexus`.
class AppController : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(QString graphicsRequest READ graphicsRequest CONSTANT)

public:
    explicit AppController(const GraphicsChoice &gfx, QObject *parent = nullptr);
    ~AppController() override;

    // Returns false when the process should exit (e.g. --help).
    bool parseCommandLine(const QStringList &args);
    void attachWindow(QQuickWindow *window);
    void start();

    QString version() const;
    QString graphicsRequest() const { return m_gfx.effective; }

private:
    void scheduleScreenshot();

    GraphicsChoice m_gfx;
    QPointer<QQuickWindow> m_window;
    QString m_screenshotPath;
    int m_screenshotDelayMs = 4000;
    QString m_initialProject;
};

} // namespace nexus::app

#pragma once

#include <QString>

namespace nexus::core {

// Filesystem locations shared by the application and nexus-relay. Both processes use
// the same Qt organisation/application names so QStandardPaths resolves identically.
namespace Paths {

void setApplicationIdentity();   // org "Nexus", app "NEXUS" (relay calls this too)

QString dataDir();               // events.db, spool/, safety/
QString spoolDir();
QString safetyDir();             // copies of files before any discard
QString relayConfigFile();       // relay.json (0600): socket path + token
QString socketName();            // per-user local socket name/path
QString logFile();

bool ensurePrivateDir(const QString &dir);    // mkpath + 0700
bool writePrivateFile(const QString &path, const QByteArray &data);  // atomic, 0600

} // namespace Paths

} // namespace nexus::core

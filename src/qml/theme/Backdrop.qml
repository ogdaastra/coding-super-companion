pragma Singleton
import QtQuick

// Shared references for glass materials: the blurred viewport texture and the item it
// was captured from (for mapping panel rectangles into texture coordinates).
QtObject {
    property var source: null
    property Item viewport: null
    property bool enabled: true
}

import QtQuick
import Nexus

// Flickable with a thin NEXUS scroll indicator. Put a Column (or similar) inside.
Flickable {
    id: fl
    default property alias content: inner.data
    property real padding: 0
    contentWidth: width
    contentHeight: inner.childrenRect.height + padding * 2
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    flickableDirection: Flickable.VerticalFlick

    Item {
        id: inner
        x: fl.padding
        y: fl.padding
        width: fl.width - fl.padding * 2
    }

    Rectangle {
        id: bar
        parent: fl
        visible: fl.contentHeight > fl.height + 1
        x: fl.width - 3
        width: 2
        y: fl.height * fl.visibleArea.yPosition
        height: Math.max(24, fl.height * fl.visibleArea.heightRatio)
        color: Theme.alpha(Theme.ice, fl.moving || hover.containsMouse ? 0.45 : 0.16)
        Behavior on color { ColorAnimation { duration: 200 } }
    }
    MouseArea {
        id: hover
        parent: fl
        anchors.right: parent.right
        width: 10; height: parent.height
        hoverEnabled: true
        acceptedButtons: Qt.NoButton
    }
}

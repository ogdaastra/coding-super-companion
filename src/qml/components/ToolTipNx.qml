import QtQuick
import Nexus

// Lightweight tooltip attached to a MouseArea with hoverEnabled.
Item {
    id: tip
    property var target: null
    property string text: ""
    visible: false
    z: 1000

    Timer {
        id: delay
        interval: 550
        onTriggered: if (tip.target && tip.target.containsMouse && tip.text.length) popup.open()
    }
    Connections {
        target: tip.target
        function onContainsMouseChanged() {
            if (tip.target.containsMouse) delay.restart()
            else { delay.stop(); popup.close() }
        }
    }

    QtObject {
        id: popup
        property var item: null
        function open() {
            const w = tip.target ? tip.target.Window.window : null
            if (!w || !w.contentItem) return
            if (!item) item = bubble.createObject(w.contentItem)
            const p = tip.target.mapToItem(w.contentItem, tip.target.width / 2, tip.target.height)
            item.text = tip.text
            item.x = Math.max(8, Math.min(w.width - item.width - 8, p.x - item.width / 2))
            item.y = p.y + 8 + item.height > w.height ? p.y - tip.target.height - item.height - 8 : p.y + 8
            item.opacity = 1
        }
        function close() { if (item) item.opacity = 0 }
    }

    Component {
        id: bubble
        Rectangle {
            property alias text: label.text
            z: 10000
            width: label.implicitWidth + 18
            height: label.implicitHeight + 10
            color: Theme.alpha(Theme.graphiteHigh, 0.97)
            border.color: Theme.hairlineStrong
            opacity: 0
            Behavior on opacity { NumberAnimation { duration: 140 } }
            Label {
                id: label
                anchors.centerIn: parent
                font.pixelSize: Theme.sizeCaption
                color: Theme.textPrimary
            }
        }
    }
}

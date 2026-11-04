import QtQuick
import Nexus

// Transient notifications (bottom-right above the dock).
Item {
    id: host
    width: 320
    property int maxToasts: 3

    function push(level, title, body) {
        // coalesce repeats of the same notification
        for (let i = 0; i < model.count; ++i)
            if (model.get(i).title === title && model.get(i).body === body) { model.remove(i); break }
        model.insert(0, { level: level, title: title, body: body, born: Date.now() })
        while (model.count > maxToasts) model.remove(model.count - 1)
    }

    ListModel { id: model }

    Column {
        anchors.bottom: parent.bottom
        anchors.right: parent.right
        spacing: 8
        Repeater {
            model: model
            delegate: Glass {
                id: t
                width: host.width
                height: col.implicitHeight + 16
                fill: 0.95
                accent: level === "error" ? Theme.alert : (level === "attention" ? Theme.amber : Theme.cyan)
                accentMix: 0.7
                opacity: 0
                Component.onCompleted: opacity = 1
                Behavior on opacity { NumberAnimation { duration: Theme.standard } }
                Timer {
                    interval: level === "error" ? 9000 : 5500
                    running: true
                    onTriggered: if (index >= 0 && index < model.count) model.remove(index)
                }
                Rectangle {
                    x: 0; y: 8; width: 2; height: parent.height - 16
                    color: t.accent
                }
                Column {
                    id: col
                    x: 14; y: 8
                    width: parent.width - 32
                    spacing: 3
                    Label { text: title; font.weight: Font.DemiBold; width: parent.width }
                    Label {
                        visible: body.length > 0
                        text: body
                        color: Theme.textSecondary
                        font.pixelSize: Theme.sizeCaption
                        width: parent.width
                        wrapMode: Text.WordWrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                }
                MouseArea { anchors.fill: parent; onClicked: model.remove(index) }
            }
        }
    }
}

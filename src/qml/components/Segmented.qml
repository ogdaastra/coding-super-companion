import QtQuick
import Nexus

// Segmented selector; model is a list of strings (or {label, value}).
Item {
    id: seg
    property var model: []
    property int currentIndex: 0
    signal activated(int index)
    implicitHeight: 26
    implicitWidth: row.implicitWidth

    Chamfer {
        anchors.fill: parent
        cut: 4
        fill: Theme.alpha(Theme.ice, 0.03)
        stroke: Theme.hairline
    }
    Row {
        id: row
        anchors.fill: parent
        anchors.margins: 2
        Repeater {
            model: seg.model
            Item {
                width: lbl.implicitWidth + 20
                height: row.height
                readonly property bool active: index === seg.currentIndex
                Rectangle {
                    anchors.fill: parent
                    color: parent.active ? Theme.alpha(Theme.cyan, 0.16) : (sm.containsMouse ? Theme.alpha(Theme.ice, 0.06) : "transparent")
                    Behavior on color { ColorAnimation { duration: Theme.micro } }
                    Rectangle {
                        visible: parent.parent.active
                        anchors.bottom: parent.bottom
                        width: parent.width; height: 1
                        color: Theme.cyan
                    }
                }
                Label {
                    id: lbl
                    anchors.centerIn: parent
                    text: typeof modelData === "string" ? modelData : modelData.label
                    font.pixelSize: Theme.sizeCaption
                    font.weight: parent.active ? Font.DemiBold : Font.Normal
                    color: parent.active ? Theme.glacier : Theme.textSecondary
                }
                MouseArea {
                    id: sm
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: { seg.currentIndex = index; seg.activated(index) }
                }
            }
        }
    }
}

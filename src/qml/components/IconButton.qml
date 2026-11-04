import QtQuick
import Nexus

Item {
    id: ib
    property string icon: "dot"
    property string tooltip: ""
    property bool checked: false
    property bool enabled_: true
    property color tint: Theme.textSecondary
    property real iconSize: 18
    signal clicked()
    implicitWidth: 32
    implicitHeight: 32
    opacity: enabled_ ? 1 : 0.35

    Chamfer {
        anchors.fill: parent
        cut: 5
        fill: ib.checked ? Theme.alpha(Theme.cyan, 0.13) : Theme.alpha(Theme.ice, ma.pressed ? 0.12 : (ma.containsMouse ? 0.07 : 0))
        stroke: ib.checked ? Theme.alpha(Theme.cyan, 0.5) : (ma.containsMouse ? Theme.hairlineStrong : "transparent")
        Behavior on fill { ColorAnimation { duration: Theme.micro } }
    }
    Icon {
        anchors.centerIn: parent
        name: ib.icon
        size: ib.iconSize
        color: ib.checked ? Theme.cyan : (ma.containsMouse ? Theme.textPrimary : ib.tint)
        Behavior on color { ColorAnimation { duration: Theme.micro } }
    }
    MouseArea {
        id: ma
        anchors.fill: parent
        hoverEnabled: true
        enabled: ib.enabled_
        cursorShape: Qt.PointingHandCursor
        onClicked: ib.clicked()
    }
    ToolTipNx { target: ma; text: ib.tooltip }
}

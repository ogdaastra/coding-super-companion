import QtQuick
import Nexus

// Titled section inside a panel: micro heading, hairline, content.
Column {
    id: sec
    property string title: ""
    property string trailing: ""
    default property alias content: body.data
    spacing: 8
    width: parent ? parent.width : 200

    Item {
        width: parent.width
        height: 14
        Micro { text: sec.title; anchors.verticalCenter: parent.verticalCenter }
        Micro {
            text: sec.trailing
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            color: Theme.textFaint
        }
    }
    Rectangle { width: parent.width; height: 1; color: Theme.hairline }
    Column {
        id: body
        width: parent.width
        spacing: 6
    }
}

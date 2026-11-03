import QtQuick
import Nexus

// Renders diff rows {t: "+"|"-"|" "|"h"|"~", s, o?, n?}.
Column {
    id: d
    property var lines: []
    property int maxLines: 2000
    property bool numbers: false
    spacing: 0
    Repeater {
        model: d.lines.slice(0, d.maxLines)
        Rectangle {
            width: d.width
            height: Math.max(16, txt.implicitHeight + 2)
            color: modelData.t === "+" ? Theme.alpha(Theme.aurora, 0.09) : modelData.t === "-" ? Theme.alpha(Theme.alert, 0.09)
                 : modelData.t === "h" ? Theme.alpha(Theme.indigo, 0.12) : "transparent"
            Rectangle { visible: modelData.t === "+" || modelData.t === "-"; width: 2; height: parent.height; color: modelData.t === "+" ? Theme.aurora : Theme.alert }
            Text {
                id: num
                visible: d.numbers
                x: 6
                width: 64
                anchors.verticalCenter: parent.verticalCenter
                text: (modelData.o !== undefined ? modelData.o : "") + "  " + (modelData.n !== undefined ? modelData.n : "")
                color: Theme.textFaint
                font.family: Theme.fontMono
                font.pixelSize: 10
                horizontalAlignment: Text.AlignRight
            }
            Text {
                id: txt
                x: d.numbers ? 80 : 8
                width: parent.width - x - 4
                anchors.verticalCenter: parent.verticalCenter
                text: (modelData.t === "h" || modelData.t === "~" ? "" : modelData.t + " ") + modelData.s
                color: modelData.t === "+" ? "#bff5e6" : modelData.t === "-" ? "#ffc6cc" : modelData.t === "h" ? Theme.violet : Theme.textSecondary
                font.family: Theme.fontMono
                font.pixelSize: 11
                wrapMode: Text.WrapAnywhere
                textFormat: Text.PlainText
            }
        }
    }
    Label {
        visible: d.lines.length > d.maxLines
        text: "… " + (d.lines.length - d.maxLines) + " more lines"
        color: Theme.textTertiary
        font.pixelSize: 11
    }
}

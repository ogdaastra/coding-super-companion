import QtQuick
import Nexus

// Label over a tabular value, optional unit and qualifier ("observed", "inferred", …).
Column {
    id: m
    property string label: ""
    property string value: "—"
    property string unit: ""
    property string qualifier: ""
    property color tone: Theme.textPrimary
    property bool large: false
    spacing: 3
    Micro { text: m.label }
    Row {
        spacing: 4
        Label {
            text: m.value
            mono: true
            color: m.tone
            font.pixelSize: m.large ? Theme.sizeMetric : 14
            font.weight: Font.Medium
        }
        Label {
            visible: m.unit.length > 0
            text: m.unit
            color: Theme.textTertiary
            font.pixelSize: Theme.sizeCaption
            anchors.baseline: parent.children[0].baseline
        }
    }
    Label {
        visible: m.qualifier.length > 0
        text: m.qualifier
        color: Theme.textFaint
        font.pixelSize: 10
        font.italic: true
    }
}

import QtQuick
import QtQuick.Shapes
import Nexus

// Chamfered shape (top-left and bottom-right corners cut) for controls and chips.
Shape {
    id: ch
    property real cut: Theme.chamferControl
    property color fill: "transparent"
    property color stroke: Theme.hairlineStrong
    property real strokeWidth: 1
    preferredRendererType: Shape.CurveRenderer
    ShapePath {
        fillColor: ch.fill
        strokeColor: ch.stroke
        strokeWidth: ch.strokeWidth
        startX: ch.cut + 0.5; startY: 0.5
        PathLine { x: ch.width - 0.5; y: 0.5 }
        PathLine { x: ch.width - 0.5; y: ch.height - 0.5 - ch.cut }
        PathLine { x: ch.width - 0.5 - ch.cut; y: ch.height - 0.5 }
        PathLine { x: 0.5; y: ch.height - 0.5 }
        PathLine { x: 0.5; y: ch.cut + 0.5 }
        PathLine { x: ch.cut + 0.5; y: 0.5 }
    }
}

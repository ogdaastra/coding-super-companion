import QtQuick
import QtQuick.Shapes
import Nexus

// Custom stroke icon set on a 20 × 20 grid, 1.5 px stroke, rendered as vector paths.
Item {
    id: icon
    property string name: "core"
    property color color: Theme.textSecondary
    property real size: 20
    property real stroke: 1.5
    implicitWidth: size
    implicitHeight: size

    readonly property var paths: ({
        "core": "M10 3.2a6.8 6.8 0 1 1 -0.01 0 M10 7.6a2.4 2.4 0 1 1 -0.01 0 M2 10h3.2 M14.8 10h3.2",
        "universe": "M10 8.4a1.6 1.6 0 1 1 -0.01 0 M3.5 7.5c2.2-4.5 10.5-4.2 12.4 0.6 M16.5 12.5c-2.2 4.5-10.5 4.2-12.4-0.6 M5 15.5l0.01 0 M15 4.5l0.01 0",
        "observatory": "M2 11h3.2l2-5.5 3 10 2.2-7.5 1.8 3h3.8",
        "changes": "M6 3.5v7 M6 13a2 2 0 1 1 -0.01 0 M14 4.5a2 2 0 1 1 -0.01 0 M14 8.5c0 3.5-8 2.5-8 6",
        "command": "M3.5 5l5 5-5 5 M10.5 15h6",
        "agents": "M10 3.5a2 2 0 1 1 -0.01 0 M4 14a2 2 0 1 1 -0.01 0 M16 14a2 2 0 1 1 -0.01 0 M8.9 7.2l-3.6 5.4 M11.1 7.2l3.6 5.4 M6.4 16h7.2",
        "atlas": "M10 2.5l7 4v7l-7 4-7-4v-7z M10 2.5v15 M3 6.5l7 4 7-4",
        "settings": "M3.5 5.5h13 M3.5 10h13 M3.5 14.5h13 M7 3.5v4 M13 8v4 M9 12.5v4",
        "search": "M13.8 8.6a5.2 5.2 0 1 1 -10.4 0a5.2 5.2 0 1 1 10.4 0 M12.4 12.4l4.6 4.6",
        "play": "M6.5 4.5l9 5.5-9 5.5z",
        "pause": "M7 4.5v11 M13 4.5v11",
        "stop": "M5.5 5.5h9v9h-9z",
        "plus": "M10 4v12 M4 10h12",
        "close": "M5.5 5.5l9 9 M14.5 5.5l-9 9",
        "check": "M4 10.5l3.8 3.8 8.2-8.6",
        "alert": "M10 3l8 14H2z M10 8.2v4 M10 14.6v0.4",
        "file": "M5 2.5h6.5l3.5 3.5v11.5H5z M11.5 2.5v3.5H15",
        "folder": "M2.5 5h5.5l1.8 2H17.5v9H2.5z",
        "branch": "M6 3.5v13 M14 3.5a2 2 0 1 1 -0.01 0 M14 7.5c0 4-8 2-8 6",
        "arrow": "M4 10h12 M11 5l5 5-5 5",
        "external": "M11.5 3.5h5v5 M16.5 3.5l-7.5 7.5 M14.5 12v4.5h-11v-11H8",
        "refresh": "M16 10a6 6 0 1 1 -1.8-4.3 M16.2 3.5v3.6h-3.6",
        "target": "M10 2.5v4 M10 13.5v4 M2.5 10h4 M13.5 10h4 M10 7.2a2.8 2.8 0 1 1 -0.01 0",
        "layers": "M10 3l8 4-8 4-8-4z M2 11l8 4 8-4 M2 14.5l8 4 8-4",
        "fit": "M3 7.5V3h4.5 M12.5 3H17v4.5 M17 12.5V17h-4.5 M7.5 17H3v-4.5",
        "cinema": "M2.5 5h15v10h-15z M8.5 8l4 2-4 2z",
        "bookmark": "M5.5 2.5h9v15l-4.5-3.5-4.5 3.5z",
        "shield": "M10 2.5l6.5 2.7v4.6c0 3.9-2.7 6.6-6.5 7.7-3.8-1.1-6.5-3.8-6.5-7.7V5.2z",
        "flask": "M7.5 2.5h5 M8.6 2.5v5l-4.6 8.5h12l-4.6-8.5v-5",
        "pulse": "M2 10h4l1.5-3 3 6 1.5-3h6",
        "terminal": "M2.5 4h15v12h-15z M5.5 8l2.5 2-2.5 2 M9.5 12.5h4",
        "link": "M8.5 11.5l3-3 M7 9l-1.8 1.8a2.8 2.8 0 0 0 4 4L11 13 M13 11l1.8-1.8a2.8 2.8 0 0 0 -4-4L9 7",
        "eye": "M2 10c2.2-3.8 5-5.5 8-5.5s5.8 1.7 8 5.5c-2.2 3.8-5 5.5-8 5.5s-5.8-1.7-8-5.5z M10 7.8a2.2 2.2 0 1 1 -0.01 0",
        "stack": "M4 5h12 M4 10h12 M4 15h12",
        "clock": "M10 3a7 7 0 1 1 -0.01 0 M10 6.5v4l2.6 1.6",
        "sim": "M3 10h2.5 M14.5 10H17 M10 3v2.5 M10 14.5V17 M6 6l1.6 1.6 M12.4 12.4L14 14 M14 6l-1.6 1.6 M7.6 12.4L6 14",
        "trash": "M4 5.5h12 M8 5.5V3.5h4v2 M5.5 5.5l0.8 11h7.4l0.8-11",
        "chevron": "M7.5 5l5 5-5 5",
        "chevronDown": "M5 7.5l5 5 5-5",
        "dot": "M10 8.6a1.4 1.4 0 1 1 -0.01 0",
        "live": "M10 7.5a2.5 2.5 0 1 1 -0.01 0 M5.6 5.6a6.2 6.2 0 0 0 0 8.8 M14.4 5.6a6.2 6.2 0 0 1 0 8.8",
        "stepBack": "M14.5 5l-6 5 6 5z M5.5 5v10",
        "stepFwd": "M5.5 5l6 5-6 5z M14.5 5v10",
        "copy": "M7 7h9.5v9.5H7z M4 13V4h9",
        "gpu": "M3 6h14v8H3z M6 9h3v2H6z M11 9h3v2h-3z M5 14v2.5 M10 14v2.5 M15 14v2.5",
        "hook": "M10 2.5v7.5a3.5 3.5 0 1 1 -7 0 M10 2.5l-2 2 M10 2.5l2 2"
    })

    Shape {
        anchors.centerIn: parent
        width: 20
        height: 20
        scale: icon.size / 20
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
            strokeColor: icon.color
            strokeWidth: icon.stroke
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            joinStyle: ShapePath.RoundJoin
            PathSvg { path: icon.paths[icon.name] || icon.paths["dot"] }
        }
    }
}

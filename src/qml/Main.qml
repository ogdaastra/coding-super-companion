import QtQuick
import QtQuick.Window
import Nexus

Window {
    id: root
    width: 1680
    height: 1000
    minimumWidth: 1100
    minimumHeight: 700
    visible: false
    color: Theme.void_
    title: "NEXUS" + (nexus.project.hasProject ? " — " + nexus.project.projectName : "")

    readonly property bool panelsVisible: !Ui.cinematic
    readonly property real leftWidth: 320
    readonly property real rightWidth: 380
    readonly property real gutter: 12
    readonly property bool leftVisible: panelsVisible && !Ui.compact && Ui.module !== "changes" && Ui.module !== "setup"
    readonly property bool inspectorVisible: panelsVisible && inspector.hasContent && Ui.module !== "setup"
    readonly property real dockHeight: Ui.dockOpen ? (Ui.module === "observatory" ? 330 : 236) : 34

    // ------------------------------------------------------------------ 3D environment
    NexusViewport {
        id: viewport
        objectName: "viewport"
        anchors.fill: parent
        quality: settingsStore.quality
        autoRotate: settingsStore.autoRotate || Ui.cinematic
        onNodeClicked: (g, key) => {
            if (key.startsWith("agent:")) {
                Ui.select("session", key.substring(6))
                nexus.sessions.activeSession = key.substring(6)
            } else {
                Ui.select("node", key)
                nexus.project.focus(key)
            }
        }
        onBackgroundClicked: {
            Ui.clearSelection()
            nexus.project.clearFocus()
        }
    }

    ShaderEffectSource {
        id: sceneBlur
        sourceItem: viewport
        textureSize: Qt.size(Math.max(64, Math.round(viewport.width / 4)), Math.max(64, Math.round(viewport.height / 4)))
        mipmap: true
        smooth: true
        live: true
        hideSource: false
        visible: false
    }

    QtObject {
        id: settingsStore
        property int quality: 2
        property bool autoRotate: true
    }

    Component.onCompleted: {
        Backdrop.source = sceneBlur
        Backdrop.viewport = viewport
        Ui.confirmHost = confirm
        Ui.toastHost = toasts
        Ui.paletteHost = palette
        if (nexus.startupModule.length) Ui.module = nexus.startupModule
    }

    // labels are confined to the unobstructed part of the viewport
    LabelsOverlay {
        viewport: viewport
        x: root.panelsVisible ? (root.leftVisible ? leftPanel.x + leftPanel.width + 4 : rail.width) : 0
        y: root.panelsVisible ? topBar.height : 0
        width: (root.panelsVisible && root.inspectorVisible ? inspector.x - 4 : root.width) - x
        height: (root.panelsVisible ? dock.y - 4 : root.height) - y
        opacity: Ui.cinematic ? 0.75 : 1
    }

    // subtle frame vignette lines around the working area
    Rectangle {
        anchors.fill: parent
        color: "transparent"
        border.color: Theme.alpha(Theme.cyan, 0.05)
        border.width: 1
    }

    // ------------------------------------------------------------------ command layer
    TopBar {
        id: topBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        viewport: viewport
        opacity: root.panelsVisible ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    NavRail {
        id: rail
        anchors.top: topBar.bottom
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        opacity: root.panelsVisible ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    // ------------------------------------------------------------------ left: navigation & module
    LeftPanel {
        id: leftPanel
        x: root.leftVisible ? rail.width + root.gutter : rail.width - width - 20
        y: topBar.height + root.gutter
        width: root.leftWidth
        height: root.height - y - dock.height - root.gutter * 2
        opacity: root.leftVisible ? 1 : 0
        visible: opacity > 0.01
        viewport: viewport
        Behavior on x { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    // ------------------------------------------------------------------ right: intelligence
    Inspector {
        id: inspector
        width: root.rightWidth
        x: root.inspectorVisible ? root.width - width - root.gutter : root.width + 20
        y: topBar.height + root.gutter
        height: root.height - y - dock.height - root.gutter * 2
        opacity: root.inspectorVisible ? 1 : 0
        visible: opacity > 0.01
        viewport: viewport
        Behavior on x { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    // ------------------------------------------------------------------ center modules
    ChangesView {
        id: changesView
        x: rail.width + root.gutter
        y: topBar.height + root.gutter
        width: root.width - x - (root.inspectorVisible ? root.rightWidth + root.gutter * 2 : root.gutter)
        height: root.height - y - dock.height - root.gutter * 2
        opacity: Ui.module === "changes" && root.panelsVisible ? 1 : 0
        visible: opacity > 0.01
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    SetupView {
        id: setupView
        x: rail.width + root.gutter
        y: topBar.height + root.gutter
        width: root.width - x - root.gutter
        height: root.height - y - dock.height - root.gutter * 2
        opacity: Ui.module === "setup" && root.panelsVisible ? 1 : 0
        visible: opacity > 0.01
        viewport: viewport
        settings: settingsStore
        Behavior on opacity { NumberAnimation { duration: Theme.emphasis } }
    }

    ViewportControls {
        id: viewControls
        viewport: viewport
        anchors.top: topBar.bottom
        anchors.topMargin: root.gutter + 4
        x: (root.inspectorVisible ? inspector.x : root.width) - width - root.gutter
        opacity: root.panelsVisible && Ui.module !== "changes" && Ui.module !== "setup" ? 1 : 0
        visible: opacity > 0.01
        Behavior on x { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        Behavior on opacity { NumberAnimation { duration: Theme.standard } }
    }

    Hud {
        id: hud
        viewport: viewport
        x: (root.leftVisible ? leftPanel.x + leftPanel.width : rail.width) + root.gutter + 4
        y: dock.y - height - 10
        opacity: root.panelsVisible && Ui.module !== "changes" && Ui.module !== "setup" ? 1 : 0.0
        Behavior on opacity { NumberAnimation { duration: Theme.standard } }
    }

    // ------------------------------------------------------------------ bottom: activity
    ActivityDock {
        id: dock
        x: rail.width + root.gutter
        width: root.width - x - root.gutter
        height: root.dockHeight
        y: root.panelsVisible ? root.height - height - root.gutter : root.height + 10
        Behavior on height { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
    }

    // ------------------------------------------------------------------ cinematic title card
    CinematicOverlay {
        anchors.fill: parent
        visible: Ui.cinematic
    }

    // ------------------------------------------------------------------ overlays
    Toasts {
        id: toasts
        anchors.right: parent.right
        anchors.rightMargin: root.gutter + (root.inspectorVisible ? root.rightWidth + root.gutter : 0)
        anchors.bottom: dock.top
        anchors.bottomMargin: root.gutter
        height: 400
        z: 800
    }

    CommandPalette { id: palette; anchors.fill: parent; viewport: viewport }
    ConfirmDialog { id: confirm }

    Connections {
        target: nexus.sessions
        function onNotify(level, title, body) { toasts.push(level, title, body) }
    }
    Connections {
        target: nexus.integration
        function onToast(level, title, body) { toasts.push(level, title, body) }
    }

    // ------------------------------------------------------------------ keyboard
    Shortcut { sequences: ["Ctrl+K", "Ctrl+P"]; onActivated: palette.show() }
    Shortcut { sequence: "Escape"; onActivated: { if (palette.open) palette.hide(); else if (Ui.cinematic) Ui.cinematic = false; else { Ui.clearSelection(); nexus.project.clearFocus() } } }
    Shortcut { sequence: "F11"; onActivated: root.visibility = root.visibility === Window.FullScreen ? Window.Windowed : Window.FullScreen }
    Shortcut { sequence: "C"; onActivated: Ui.cinematic = !Ui.cinematic }
    Shortcut { sequence: "R"; onActivated: viewport.resetView() }
    Shortcut { sequence: "Ctrl+J"; onActivated: Ui.dockOpen = !Ui.dockOpen }
    Shortcut { sequence: "Ctrl+B"; onActivated: Ui.compact = !Ui.compact }
    Shortcut { sequence: "Space"; onActivated: nexus.timeline.playing ? nexus.timeline.pause() : nexus.timeline.play() }
    Shortcut { sequence: "L"; onActivated: nexus.timeline.goLive() }
    Repeater {
        model: ["core", "universe", "observatory", "changes", "command", "agents", "atlas", "setup"]
        Item { Shortcut { sequence: "Ctrl+" + (index + 1); onActivated: Ui.module = modelData } }
    }
}

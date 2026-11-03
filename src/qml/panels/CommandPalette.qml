import QtQuick
import Nexus

// Ctrl+K: search files, symbols and sessions; run commands. Keyboard-first.
Item {
    id: pal
    property var viewport
    property bool open: false
    property int current: 0
    visible: opacity > 0
    opacity: open ? 1 : 0
    z: 850
    Behavior on opacity { NumberAnimation { duration: Theme.standard } }

    function show() { open = true; field.text = ""; current = 0; field.input.forceActiveFocus() }
    function hide() { open = false }

    readonly property var commands: [
        { title: "Go to Core", detail: "Module", run: () => Ui.module = "core" },
        { title: "Go to Universe", detail: "Module", run: () => Ui.module = "universe" },
        { title: "Go to Observatory", detail: "Module", run: () => Ui.module = "observatory" },
        { title: "Review changes", detail: "Module", run: () => Ui.module = "changes" },
        { title: "Command Centre — start a session", detail: "Module", run: () => Ui.module = "command" },
        { title: "Multi-agent network", detail: "Module", run: () => Ui.module = "agents" },
        { title: "Knowledge atlas", detail: "Module", run: () => Ui.module = "atlas" },
        { title: "Setup & integration", detail: "Module", run: () => Ui.module = "setup" },
        { title: "Layout: hierarchical galaxy", detail: "Layout", run: () => nexus.project.layout = 0 },
        { title: "Layout: dependency constellation", detail: "Layout", run: () => nexus.project.layout = 1 },
        { title: "Layout: force-directed", detail: "Layout", run: () => nexus.project.layout = 2 },
        { title: "Layout: layered architecture", detail: "Layout", run: () => nexus.project.layout = 3 },
        { title: "Layout: directory tree", detail: "Layout", run: () => nexus.project.layout = 4 },
        { title: "Layout: activity heatmap", detail: "Layout", run: () => nexus.project.layout = 5 },
        { title: "Camera: reset view", detail: "Camera", run: () => pal.viewport.resetView() },
        { title: "Camera: focus core", detail: "Camera", run: () => pal.viewport.preset("core") },
        { title: "Camera: top-down", detail: "Camera", run: () => pal.viewport.preset("top") },
        { title: "Toggle cinematic mode", detail: "View", run: () => Ui.cinematic = !Ui.cinematic },
        { title: "Replay history", detail: "Timeline", run: () => nexus.timeline.play() },
        { title: "Return to live", detail: "Timeline", run: () => nexus.timeline.goLive() },
        { title: "Start simulation", detail: "Simulation (labelled)", run: () => nexus.integration.startSimulation(2) },
        { title: "Stop simulation", detail: "Simulation", run: () => nexus.integration.stopSimulation() },
        { title: "Send telemetry test event", detail: "Integration", run: () => nexus.integration.runProbe() }
    ]

    readonly property var results: {
        const q = field.text.trim().toLowerCase()
        let out = []
        const cmds = pal.commands.filter(c => !q.length || c.title.toLowerCase().indexOf(q) >= 0)
        for (const c of cmds.slice(0, q.length ? 6 : 10)) out.push({ kind: "command", title: c.title, detail: c.detail, run: c.run })
        if (q.length) {
            for (const r of nexus.project.search(q, 16))
                out.push({ kind: r.type, title: r.title, detail: r.detail, key: r.key })
        }
        return out
    }

    function activate(i) {
        const r = results[i]
        if (!r) return
        hide()
        if (r.kind === "command") { r.run(); return }
        const g = nexus.project.globalForKey(r.key)
        if (g >= 0) {
            if (Ui.module === "changes" || Ui.module === "setup") Ui.module = "universe"
            pal.viewport.select(g)
            pal.viewport.flyToNode(g)
            nexus.project.focus(r.key)
            Ui.select("node", r.key)
        }
    }

    Rectangle { anchors.fill: parent; color: Theme.alpha(Theme.void_, 0.5) }
    MouseArea { anchors.fill: parent; onClicked: pal.hide() }

    Glass {
        width: Math.min(640, parent.width - 120)
        height: Math.min(480, 66 + list.contentHeight + 16)
        anchors.horizontalCenter: parent.horizontalCenter
        y: parent.height * 0.16 + (pal.open ? 0 : -10)
        Behavior on y { NumberAnimation { duration: Theme.emphasis; easing.type: Easing.OutCubic } }
        fill: 0.97
        ticks: true
        MouseArea { anchors.fill: parent }

        NxField {
            id: field
            x: 14; y: 14
            width: parent.width - 28
            height: 38
            icon: "search"
            placeholder: "Search files, symbols, or type a command"
            onTextChanged: pal.current = 0
            onAccepted: pal.activate(pal.current)
            input.Keys.onDownPressed: pal.current = Math.min(pal.results.length - 1, pal.current + 1)
            input.Keys.onUpPressed: pal.current = Math.max(0, pal.current - 1)
            input.Keys.onEscapePressed: pal.hide()
        }
        ListView {
            id: list
            x: 14
            y: 62
            width: parent.width - 28
            height: parent.height - 72
            clip: true
            model: pal.results
            currentIndex: pal.current
            delegate: Item {
                width: list.width
                height: 36
                readonly property bool cur: index === pal.current
                Rectangle { anchors.fill: parent; color: parent.cur ? Theme.alpha(Theme.cyan, 0.12) : (pm.containsMouse ? Theme.alpha(Theme.ice, 0.05) : "transparent") }
                Rectangle { visible: parent.cur; width: 2; height: parent.height; color: Theme.cyan }
                Icon {
                    x: 10; anchors.verticalCenter: parent.verticalCenter; size: 15
                    name: modelData.kind === "command" ? "arrow" : modelData.kind === "directory" ? "folder" : modelData.kind === "symbol" ? "link" : "file"
                    color: modelData.kind === "command" ? Theme.cyan : modelData.kind === "symbol" ? Theme.violet : Theme.ice
                }
                Label { x: 34; width: parent.width * 0.55; anchors.verticalCenter: parent.verticalCenter; text: modelData.title; mono: modelData.kind === "symbol"; font.pixelSize: 12 }
                Label { anchors.right: parent.right; anchors.rightMargin: 10; width: parent.width * 0.4; horizontalAlignment: Text.AlignRight; anchors.verticalCenter: parent.verticalCenter; text: modelData.detail; color: Theme.textTertiary; font.pixelSize: 11; elide: Text.ElideLeft }
                MouseArea { id: pm; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: pal.activate(index) }
            }
        }
    }
}

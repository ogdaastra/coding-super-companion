#include "graph/Layouts.h"

#include <QTest>
#include <cmath>

using namespace nexus::graph;

class TestLayouts : public QObject
{
    Q_OBJECT
private:
    LayoutRequest makeTree(int dirs, int filesPerDir)
    {
        LayoutRequest req;
        for (int d = 0; d < dirs; ++d) {
            LayoutNode dn;
            dn.isDir = true;
            dn.parent = d == 0 ? -1 : (d - 1) / 3;
            dn.order = int(req.nodes.size());
            req.nodes.push_back(dn);
        }
        for (int d = 0; d < dirs; ++d) {
            for (int f = 0; f < filesPerDir; ++f) {
                LayoutNode fn;
                fn.parent = d;
                fn.size = 0.7f;
                fn.order = int(req.nodes.size());
                req.nodes.push_back(fn);
                req.edges.push_back({ d, int(req.nodes.size()) - 1, true, 1.f });
            }
        }
        for (int d = 1; d < dirs; ++d)
            req.edges.push_back({ (d - 1) / 3, d, true, 1.f });
        // imports between files of neighbouring directories (with a cycle)
        const int firstFile = dirs;
        for (int i = firstFile; i + filesPerDir < int(req.nodes.size()); i += 3)
            req.edges.push_back({ i, i + filesPerDir, false, 1.f });
        req.edges.push_back({ int(req.nodes.size()) - 1, firstFile, false, 1.f });
        return req;
    }

private slots:
    void allLayoutsProduceFinitePositions_data()
    {
        QTest::addColumn<int>("kind");
        for (int k = 0; k <= 5; ++k)
            QTest::newRow(qPrintable(layoutName(LayoutKind(k)))) << k;
    }
    void allLayoutsProduceFinitePositions()
    {
        QFETCH(int, kind);
        LayoutRequest req = makeTree(13, 9);
        req.kind = LayoutKind(kind);
        const LayoutResult r = computeLayout(req);
        QCOMPARE(r.positions.size(), req.nodes.size());
        for (const QVector3D &p : r.positions) {
            QVERIFY(std::isfinite(p.x()) && std::isfinite(p.y()) && std::isfinite(p.z()));
            QVERIFY(p.length() < 2000.f);
        }
        if (req.kind != LayoutKind::Tree && req.kind != LayoutKind::Layered)
            for (const QVector3D &p : r.positions)
                QVERIFY2(p.length() >= req.coreExclusion - 0.01f, "nodes must stay outside the NEXUS core");
    }

    void layeredHandlesCyclesAndOrdersDependencies()
    {
        LayoutRequest req;
        for (int i = 0; i < 4; ++i) { LayoutNode n; n.order = i; req.nodes.push_back(n); }
        // 0 → 1 → 2, plus a cycle 2 → 3 → 2
        req.edges = { { 0, 1, false, 1.f }, { 1, 2, false, 1.f }, { 2, 3, false, 1.f }, { 3, 2, false, 1.f } };
        req.kind = LayoutKind::Layered;
        const LayoutResult r = computeLayout(req);
        QCOMPARE(int(r.layerOf.size()), 4);
        QVERIFY(r.layerOf[0] > r.layerOf[1]);
        QVERIFY(r.layerOf[1] > r.layerOf[2]);
        QCOMPARE(r.layerOf[2], r.layerOf[3]);   // same strongly connected component
    }
};

QTEST_GUILESS_MAIN(TestLayouts)
#include "tst_layouts.moc"

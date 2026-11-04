#include "Layouts.h"

#include <QElapsedTimer>
#include <QHash>
#include <QRandomGenerator>
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <memory>
#include <numeric>

namespace nexus::graph {

namespace {

constexpr float kPi = 3.14159265f;
constexpr float kGolden = 2.39996323f;

float hashf(unsigned x)
{
    x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
    return float(x & 0xFFFFFF) / float(0xFFFFFF);
}

struct Tree {
    std::vector<std::vector<int>> children;
    std::vector<int> roots;
    std::vector<float> weight;   // subtree weight
    std::vector<int> depth;
};

Tree buildTree(const std::vector<LayoutNode> &nodes)
{
    Tree t;
    const size_t n = nodes.size();
    t.children.assign(n, {});
    t.weight.assign(n, 1.f);
    t.depth.assign(n, 0);
    for (size_t i = 0; i < n; ++i) {
        const int p = nodes[i].parent;
        if (p >= 0 && p < int(n) && p != int(i))
            t.children[size_t(p)].push_back(int(i));
        else
            t.roots.push_back(int(i));
    }
    // order children: directories first (bigger first), then files by order
    auto cmp = [&](int a, int b) {
        if (nodes[size_t(a)].isDir != nodes[size_t(b)].isDir) return nodes[size_t(a)].isDir;
        return nodes[size_t(a)].order < nodes[size_t(b)].order;
    };
    for (auto &c : t.children) std::sort(c.begin(), c.end(), cmp);
    std::sort(t.roots.begin(), t.roots.end(), cmp);
    // post-order weights, pre-order depth
    std::function<float(int, int)> walk = [&](int i, int d) -> float {
        t.depth[size_t(i)] = d;
        float w = 1.f;
        for (int c : t.children[size_t(i)]) w += walk(c, d + 1);
        t.weight[size_t(i)] = w;
        return w;
    };
    for (int r : t.roots) walk(r, 0);
    return t;
}

// Places `count` points in a small cluster (Fibonacci sphere, flattened).
QVector3D clusterOffset(int k, int count, float radius, float flatten)
{
    if (count <= 1) return { 0, 0, 0 };
    const float y = 1.f - (float(k) + 0.5f) / float(count) * 2.f;
    const float r = std::sqrt(std::max(0.f, 1.f - y * y));
    const float th = kGolden * float(k);
    return QVector3D(std::cos(th) * r, y * flatten, std::sin(th) * r) * radius;
}

void enforceExclusion(std::vector<QVector3D> &pos, float minR)
{
    for (QVector3D &p : pos) {
        const float r = p.length();
        if (r < minR) {
            if (r < 1e-3f) p = QVector3D(minR, 0, 0);
            else p *= minR / r;
        }
    }
}

// ------------------------------------------------------------------- galaxy
// Unit vectors spread over a spherical cap of half-angle `cap` around `axis`.
std::vector<QVector3D> capDirections(const QVector3D &axis, int count, float cap, float twist)
{
    std::vector<QVector3D> out;
    const QVector3D a = axis.normalized();
    const QVector3D helper = std::abs(a.y()) < 0.9f ? QVector3D(0, 1, 0) : QVector3D(1, 0, 0);
    const QVector3D u = QVector3D::crossProduct(a, helper).normalized();
    const QVector3D v = QVector3D::crossProduct(a, u).normalized();
    if (count == 1) { out.push_back(a); return out; }
    const float cosCap = std::cos(cap);
    for (int k = 0; k < count; ++k) {
        // area-uniform rings on the cap, golden-angle around the axis
        const float t = (float(k) + 0.5f) / float(count);
        const float c = 1.f - t * (1.f - cosCap);
        const float s = std::sqrt(std::max(0.f, 1.f - c * c));
        const float ph = float(k) * kGolden + twist;
        out.push_back((a * c + (u * std::cos(ph) + v * std::sin(ph)) * s).normalized());
    }
    return out;
}

// Pushes apart overlapping nodes (spatial hash), preserving the overall structure.
void relaxCollisions(std::vector<QVector3D> &pos, const std::vector<LayoutNode> &nodes, int iterations)
{
    const size_t n = pos.size();
    if (n < 2) return;
    const float cell = 6.f;
    for (int it = 0; it < iterations; ++it) {
        QHash<qint64, std::vector<int>> grid;
        auto keyOf = [cell](const QVector3D &p, int dx, int dy, int dz) {
            const qint64 x = qint64(std::floor(p.x() / cell)) + dx, y = qint64(std::floor(p.y() / cell)) + dy,
                         z = qint64(std::floor(p.z() / cell)) + dz;
            return (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
        };
        for (size_t i = 0; i < n; ++i) grid[keyOf(pos[i], 0, 0, 0)].push_back(int(i));
        std::vector<QVector3D> push(n);
        for (size_t i = 0; i < n; ++i) {
            const float ri = nodes[i].size + 0.9f;
            for (int dx = -1; dx <= 1; ++dx)
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dz = -1; dz <= 1; ++dz) {
                        auto it2 = grid.constFind(keyOf(pos[i], dx, dy, dz));
                        if (it2 == grid.constEnd()) continue;
                        for (int j : *it2) {
                            if (j <= int(i)) continue;
                            QVector3D d = pos[size_t(j)] - pos[i];
                            const float minD = ri + nodes[size_t(j)].size + 0.9f;
                            const float dist = d.length();
                            if (dist >= minD) continue;
                            if (dist < 1e-4f) d = QVector3D(hashf(unsigned(i * 7 + j)) - 0.5f, 0.3f, hashf(unsigned(j * 13 + i)) - 0.5f);
                            const QVector3D dir = d.normalized();
                            const float overlap = (minD - dist) * 0.5f;
                            push[i] -= dir * overlap;
                            push[size_t(j)] += dir * overlap;
                        }
                    }
        }
        for (size_t i = 0; i < n; ++i) pos[i] += push[i];
    }
}

std::vector<QVector3D> galaxy(const LayoutRequest &req, const Tree &t)
{
    const auto &nodes = req.nodes;
    std::vector<QVector3D> pos(nodes.size());
    const float base = req.coreExclusion + 10.f;

    // Each directory blooms outward: files cluster around its hub, subdirectories fan out
    // over a spherical cap around the outward direction.
    std::function<void(int, const QVector3D &, const QVector3D &)> place =
        [&](int i, const QVector3D &p, const QVector3D &outward) {
        pos[size_t(i)] = p;
        std::vector<int> dirs, files;
        for (int c : t.children[size_t(i)]) (nodes[size_t(c)].isDir ? dirs : files).push_back(c);
        const float clusterR = 2.8f + 1.25f * std::sqrt(float(files.size()));
        for (size_t k = 0; k < files.size(); ++k)
            pos[size_t(files[k])] = p + clusterOffset(int(k), int(files.size()), clusterR, 0.62f);
        if (dirs.empty()) return;
        const float cap = std::min(1.25f, 0.45f + 0.20f * std::sqrt(float(dirs.size())));
        const auto dirsOut = capDirections(outward, int(dirs.size()), cap, float(i) * 0.37f);
        for (size_t k = 0; k < dirs.size(); ++k) {
            const int d = dirs[k];
            const float step = clusterR + 7.f + 2.6f * std::sqrt(t.weight[size_t(d)]);
            const QVector3D dir = (dirsOut[k] * 0.75f + outward * 0.25f).normalized();
            place(d, p + dir * step, dir);
        }
    };

    std::vector<int> topDirs, topFiles;
    for (int r : t.roots) (nodes[size_t(r)].isDir ? topDirs : topFiles).push_back(r);
    float total = 0.f;
    for (int d : topDirs) total += std::sqrt(t.weight[size_t(d)]);
    const float filesShare = topFiles.empty() ? 0.f : std::max(0.12f * total, std::sqrt(float(topFiles.size())));
    total += filesShare;
    if (total <= 0.f) total = 1.f;
    float acc = 0.f;
    const float twoPi = 2.f * kPi;
    for (size_t k = 0; k < topDirs.size(); ++k) {
        const int d = topDirs[k];
        const float w = std::sqrt(t.weight[size_t(d)]) / total;
        const float theta = (acc + w * 0.5f) * twoPi;
        acc += w;
        const float lift = (float(k % 3) - 1.f) * 0.22f;
        const QVector3D outward = QVector3D(std::cos(theta), lift, std::sin(theta)).normalized();
        const float r = base + 2.5f * std::sqrt(t.weight[size_t(d)]);
        place(d, outward * r, outward);
    }
    if (!topFiles.empty()) {
        const float a = (acc + filesShare / total * 0.5f) * twoPi;
        const QVector3D anchor(std::cos(a) * base, 0.f, std::sin(a) * base);
        const float r = 2.8f + 1.3f * std::sqrt(float(topFiles.size()));
        for (size_t k = 0; k < topFiles.size(); ++k)
            pos[size_t(topFiles[k])] = anchor + clusterOffset(int(k), int(topFiles.size()), r, 0.6f);
    }

    relaxCollisions(pos, nodes, 12);

    // Radial normalisation: keep the universe within a comfortable shell around the core.
    const float maxTarget = std::clamp(70.f + 9.f * std::sqrt(float(nodes.size())), 110.f, 320.f);
    float maxR = 0.f;
    for (const QVector3D &p : pos) maxR = std::max(maxR, p.length());
    const float excl = req.coreExclusion;
    if (maxR > maxTarget) {
        const float s = (maxTarget - excl) / std::max(maxR - excl, 1.f);
        for (QVector3D &p : pos) {
            const float r = p.length();
            if (r > excl) p *= (excl + (r - excl) * s) / r;
        }
    }
    return pos;
}

// ------------------------------------------------------------------- force (Barnes–Hut)
struct Octree {
    struct Cell {
        QVector3D centre;
        float half;
        QVector3D mass;   // centre-of-mass accumulator
        float count = 0.f;
        std::array<int, 8> child{ -1, -1, -1, -1, -1, -1, -1, -1 };
        int body = -1;
    };
    std::vector<Cell> cells;
    const std::vector<QVector3D> *pts = nullptr;

    void build(const std::vector<QVector3D> &p)
    {
        pts = &p;
        cells.clear();
        cells.reserve(p.size() * 2 + 1);
        QVector3D lo(1e9f, 1e9f, 1e9f), hi(-1e9f, -1e9f, -1e9f);
        for (const QVector3D &v : p) {
            lo = QVector3D(std::min(lo.x(), v.x()), std::min(lo.y(), v.y()), std::min(lo.z(), v.z()));
            hi = QVector3D(std::max(hi.x(), v.x()), std::max(hi.y(), v.y()), std::max(hi.z(), v.z()));
        }
        Cell root;
        root.centre = (lo + hi) * 0.5f;
        root.half = std::max({ hi.x() - lo.x(), hi.y() - lo.y(), hi.z() - lo.z(), 1.f }) * 0.5f + 1.f;
        cells.push_back(root);
        for (int i = 0; i < int(p.size()); ++i) insert(0, i, 0);
    }

    int octant(const Cell &c, const QVector3D &v) const
    {
        return (v.x() > c.centre.x() ? 1 : 0) | (v.y() > c.centre.y() ? 2 : 0) | (v.z() > c.centre.z() ? 4 : 0);
    }

    int makeChild(int ci, int oct)
    {
        Cell c;
        const Cell &parent = cells[size_t(ci)];
        c.half = parent.half * 0.5f;
        c.centre = parent.centre + QVector3D((oct & 1) ? c.half : -c.half, (oct & 2) ? c.half : -c.half, (oct & 4) ? c.half : -c.half);
        cells.push_back(c);
        const int idx = int(cells.size()) - 1;
        cells[size_t(ci)].child[size_t(oct)] = idx;
        return idx;
    }

    void insert(int ci, int body, int depth)
    {
        const QVector3D v = (*pts)[size_t(body)];
        cells[size_t(ci)].mass += v;
        cells[size_t(ci)].count += 1.f;
        if (cells[size_t(ci)].count == 1.f) { cells[size_t(ci)].body = body; return; }
        if (depth > 24) return;  // coincident points
        if (cells[size_t(ci)].body >= 0) {
            const int old = cells[size_t(ci)].body;
            cells[size_t(ci)].body = -1;
            const int o = octant(cells[size_t(ci)], (*pts)[size_t(old)]);
            int ch = cells[size_t(ci)].child[size_t(o)];
            if (ch < 0) ch = makeChild(ci, o);
            insert(ch, old, depth + 1);
        }
        const int o = octant(cells[size_t(ci)], v);
        int ch = cells[size_t(ci)].child[size_t(o)];
        if (ch < 0) ch = makeChild(ci, o);
        insert(ch, body, depth + 1);
    }

    QVector3D force(int body, float theta2, float k) const
    {
        QVector3D f;
        const QVector3D p = (*pts)[size_t(body)];
        int stack[256];
        int sp = 0;
        stack[sp++] = 0;
        while (sp > 0) {
            const Cell &c = cells[size_t(stack[--sp])];
            if (c.count == 0.f) continue;
            const QVector3D com = c.mass / c.count;
            QVector3D d = p - com;
            float d2 = d.lengthSquared() + 0.25f;
            const float size = c.half * 2.f;
            if (c.body >= 0 || size * size / d2 < theta2) {
                if (c.body == body) continue;
                f += d * (k * c.count / (d2 * std::sqrt(d2)));
            } else {
                for (int ch : c.child)
                    if (ch >= 0 && sp < 255) stack[sp++] = ch;
            }
        }
        return f;
    }
};

std::vector<QVector3D> force(const LayoutRequest &req, std::vector<QVector3D> pos, float springImport, float lenImport,
                             float springContain, float lenContain, int iterations)
{
    const size_t n = pos.size();
    if (n == 0) return pos;
    std::vector<QVector3D> disp(n);
    Octree tree;
    float step = 3.5f;
    const float repulse = 180.f;
    for (int it = 0; it < iterations; ++it) {
        tree.build(pos);
        for (size_t i = 0; i < n; ++i)
            disp[i] = tree.force(int(i), 0.81f, repulse);
        for (const LayoutEdge &e : req.edges) {
            if (e.a < 0 || e.b < 0 || size_t(e.a) >= n || size_t(e.b) >= n) continue;
            const float k = e.containment ? springContain : springImport * e.weight;
            const float len = e.containment ? lenContain : lenImport;
            if (k <= 0.f) continue;
            QVector3D d = pos[size_t(e.b)] - pos[size_t(e.a)];
            const float dist = std::max(d.length(), 0.01f);
            const QVector3D f = d / dist * ((dist - len) * k);
            disp[size_t(e.a)] += f;
            disp[size_t(e.b)] -= f;
        }
        for (size_t i = 0; i < n; ++i) {
            QVector3D &p = pos[i];
            // gentle gravity toward a flattened disc around the core
            disp[i] += -QVector3D(p.x() * 0.0025f, p.y() * 0.010f, p.z() * 0.0025f);
            const float r = p.length();
            if (r < req.coreExclusion)
                disp[i] += p.normalized() * (req.coreExclusion - r) * 0.5f;
            const float m = disp[i].length();
            if (m > 1e-6f)
                p += disp[i] / m * std::min(m, step);
        }
        step = std::max(0.15f, step * 0.985f);
    }
    return pos;
}

// ------------------------------------------------------------------- layered
LayoutResult layered(const LayoutRequest &req, const Tree &t)
{
    const auto &nodes = req.nodes;
    const int n = int(nodes.size());
    std::vector<std::vector<int>> out(static_cast<size_t>(n));
    for (const LayoutEdge &e : req.edges)
        if (!e.containment && e.a >= 0 && e.b >= 0 && e.a < n && e.b < n)
            out[size_t(e.a)].push_back(e.b);

    // Tarjan SCC (iterative) to break import cycles
    std::vector<int> index(size_t(n), -1), low(size_t(n), 0), comp(size_t(n), -1);
    std::vector<bool> onStack(size_t(n), false);
    std::vector<int> stack;
    int idx = 0, ncomp = 0;
    for (int s = 0; s < n; ++s) {
        if (index[size_t(s)] >= 0) continue;
        std::vector<std::pair<int, size_t>> call{ { s, 0 } };
        index[size_t(s)] = low[size_t(s)] = idx++;
        stack.push_back(s); onStack[size_t(s)] = true;
        while (!call.empty()) {
            auto &[v, ei] = call.back();
            if (ei < out[size_t(v)].size()) {
                const int w = out[size_t(v)][ei++];
                if (index[size_t(w)] < 0) {
                    index[size_t(w)] = low[size_t(w)] = idx++;
                    stack.push_back(w); onStack[size_t(w)] = true;
                    call.push_back({ w, 0 });
                } else if (onStack[size_t(w)]) {
                    low[size_t(v)] = std::min(low[size_t(v)], index[size_t(w)]);
                }
            } else {
                if (low[size_t(v)] == index[size_t(v)]) {
                    int w;
                    do { w = stack.back(); stack.pop_back(); onStack[size_t(w)] = false; comp[size_t(w)] = ncomp; } while (w != v);
                    ++ncomp;
                }
                const int done = v;
                call.pop_back();
                if (!call.empty())
                    low[size_t(call.back().first)] = std::min(low[size_t(call.back().first)], low[size_t(done)]);
            }
        }
    }
    // longest path from sinks over the condensed DAG (memoised DFS)
    std::vector<std::vector<int>> condOut(static_cast<size_t>(ncomp));
    for (int v = 0; v < n; ++v)
        for (int w : out[size_t(v)])
            if (comp[size_t(v)] != comp[size_t(w)]) condOut[size_t(comp[size_t(v)])].push_back(comp[size_t(w)]);
    std::vector<int> clayer(size_t(ncomp), -1);
    std::function<int(int)> depthOf = [&](int c) -> int {
        if (clayer[size_t(c)] >= 0) return clayer[size_t(c)];
        clayer[size_t(c)] = 0;
        int d = 0;
        for (int w : condOut[size_t(c)]) d = std::max(d, depthOf(w) + 1);
        clayer[size_t(c)] = d;
        return d;
    };
    LayoutResult res;
    res.layerOf.assign(size_t(n), 0);
    int maxLayer = 0;
    for (int v = 0; v < n; ++v) {
        if (nodes[size_t(v)].isDir) continue;
        res.layerOf[size_t(v)] = std::min(depthOf(comp[size_t(v)]), 9);
        maxLayer = std::max(maxLayer, res.layerOf[size_t(v)]);
    }
    // directories sit on the layer of their deepest-reaching file, rounded
    for (int v = n - 1; v >= 0; --v) {
        if (!nodes[size_t(v)].isDir) continue;
        int sum = 0, cnt = 0;
        for (int c : t.children[size_t(v)]) { sum += res.layerOf[size_t(c)]; ++cnt; }
        res.layerOf[size_t(v)] = cnt ? int(std::lround(float(sum) / float(cnt))) : 0;
    }
    res.layers = maxLayer + 1;

    // top-level group of each node gives its angular sector
    std::vector<int> group(size_t(n), 0);
    for (int v = 0; v < n; ++v) {
        int g = v;
        while (nodes[size_t(g)].parent >= 0) g = nodes[size_t(g)].parent;
        group[size_t(v)] = g;
    }
    std::vector<std::vector<int>> perLayer(size_t(res.layers));
    for (int v = 0; v < n; ++v) perLayer[size_t(res.layerOf[size_t(v)])].push_back(v);
    res.positions.assign(size_t(n), {});
    const float spacing = 17.f;
    for (int L = 0; L < res.layers; ++L) {
        auto &items = perLayer[size_t(L)];
        std::sort(items.begin(), items.end(), [&](int a, int b) {
            if (group[size_t(a)] != group[size_t(b)]) return group[size_t(a)] < group[size_t(b)];
            return nodes[size_t(a)].order < nodes[size_t(b)].order;
        });
        const float y = (float(L) - float(res.layers - 1) * 0.5f) * spacing;
        // annulus Fermat spiral: inner radius = core exclusion
        const float inner = req.coreExclusion + 4.f;
        const float area = 7.5f;
        for (size_t k = 0; k < items.size(); ++k) {
            const float r = std::sqrt(inner * inner + area * float(k) * 4.f);
            const float th = float(k) * kGolden;
            res.positions[size_t(items[k])] = QVector3D(std::cos(th) * r, y, std::sin(th) * r);
        }
    }
    return res;
}

// ------------------------------------------------------------------- cone tree
std::vector<QVector3D> coneTree(const LayoutRequest &req, const Tree &t)
{
    const auto &nodes = req.nodes;
    std::vector<QVector3D> pos(nodes.size());
    const float top = 95.f;
    const float levelGap = 24.f;
    std::function<void(int, const QVector3D &)> place = [&](int i, const QVector3D &p) {
        pos[size_t(i)] = p;
        const auto &kids = t.children[size_t(i)];
        if (kids.empty()) return;
        float total = 0.f;
        for (int c : kids) total += std::sqrt(t.weight[size_t(c)]);
        const float ringR = 4.f + 2.2f * total;
        float acc = 0.f;
        for (int c : kids) {
            const float w = std::sqrt(t.weight[size_t(c)]) / total;
            const float th = (acc + w * 0.5f) * 2.f * kPi + float(t.depth[size_t(i)]) * 0.7f;
            acc += w;
            const bool dir = nodes[size_t(c)].isDir;
            const float rr = dir ? ringR : ringR * 0.55f;
            place(c, p + QVector3D(std::cos(th) * rr, dir ? -levelGap : -levelGap * 0.45f, std::sin(th) * rr));
        }
    };
    float total = 0.f;
    for (int r : t.roots) total += std::sqrt(t.weight[size_t(r)]);
    const float rootR = req.coreExclusion + 6.f + 1.6f * total;
    float acc = 0.f;
    for (int r : t.roots) {
        const float w = std::sqrt(t.weight[size_t(r)]) / std::max(total, 1.f);
        const float th = (acc + w * 0.5f) * 2.f * kPi;
        acc += w;
        const float rr = nodes[size_t(r)].isDir ? rootR : rootR * 0.8f;
        place(r, QVector3D(std::cos(th) * rr, top - (nodes[size_t(r)].isDir ? 0.f : 10.f), std::sin(th) * rr));
    }
    // recentre vertically so the cone straddles the core
    float minY = 1e9f, maxY = -1e9f;
    for (const QVector3D &p : pos) { minY = std::min(minY, p.y()); maxY = std::max(maxY, p.y()); }
    const float shift = -(minY + maxY) * 0.5f;
    for (QVector3D &p : pos) p.setY(p.y() + shift);
    return pos;
}

// ------------------------------------------------------------------- heatmap disc
std::vector<QVector3D> heatDisc(const LayoutRequest &req, const Tree &t)
{
    const auto &nodes = req.nodes;
    std::vector<int> files;
    std::vector<int> order(nodes.size());
    std::iota(order.begin(), order.end(), 0);
    std::sort(order.begin(), order.end(), [&](int a, int b) { return nodes[size_t(a)].order < nodes[size_t(b)].order; });
    for (int v : order) if (!nodes[size_t(v)].isDir) files.push_back(v);
    std::vector<QVector3D> pos(nodes.size());
    const float inner = req.coreExclusion + 2.f;
    for (size_t k = 0; k < files.size(); ++k) {
        const float r = std::sqrt(inner * inner + 9.5f * float(k));
        const float th = float(k) * kGolden;
        pos[size_t(files[k])] = QVector3D(std::cos(th) * r, 0.f, std::sin(th) * r);
    }
    // directories hover above the centroid of their direct files
    for (int v = int(nodes.size()) - 1; v >= 0; --v) {
        if (!nodes[size_t(v)].isDir) continue;
        QVector3D c;
        int cnt = 0;
        for (int ch : t.children[size_t(v)]) { c += pos[size_t(ch)]; ++cnt; }
        pos[size_t(v)] = cnt ? c / float(cnt) + QVector3D(0, 6.f + 2.f * float(t.depth[size_t(v)]), 0) : QVector3D(inner, 8.f, 0);
    }
    return pos;
}

} // namespace

QString layoutName(LayoutKind k)
{
    switch (k) {
    case LayoutKind::Galaxy: return QStringLiteral("Hierarchical galaxy");
    case LayoutKind::Constellation: return QStringLiteral("Dependency constellation");
    case LayoutKind::Force: return QStringLiteral("Force-directed");
    case LayoutKind::Layered: return QStringLiteral("Layered architecture");
    case LayoutKind::Tree: return QStringLiteral("Directory tree");
    case LayoutKind::Heatmap: return QStringLiteral("Activity heatmap");
    }
    return {};
}

LayoutResult computeLayout(const LayoutRequest &req)
{
    QElapsedTimer timer;
    timer.start();
    const Tree t = buildTree(req.nodes);
    LayoutResult res;
    res.kind = req.kind;
    switch (req.kind) {
    case LayoutKind::Galaxy:
        res.positions = galaxy(req, t);
        break;
    case LayoutKind::Force: {
        auto init = req.initial.size() == req.nodes.size() ? req.initial : galaxy(req, t);
        res.positions = force(req, std::move(init), 0.035f, 18.f, 0.09f, 7.f, req.nodes.size() > 6000 ? 120 : 240);
        break;
    }
    case LayoutKind::Constellation: {
        auto init = galaxy(req, t);
        res.positions = force(req, std::move(init), 0.07f, 11.f, 0.012f, 24.f, req.nodes.size() > 6000 ? 120 : 260);
        break;
    }
    case LayoutKind::Layered: {
        LayoutResult l = layered(req, t);
        res.positions = std::move(l.positions);
        res.layers = l.layers;
        res.layerOf = std::move(l.layerOf);
        break;
    }
    case LayoutKind::Tree:
        res.positions = coneTree(req, t);
        break;
    case LayoutKind::Heatmap:
        res.positions = heatDisc(req, t);
        break;
    }
    if (req.kind != LayoutKind::Tree && req.kind != LayoutKind::Layered)
        enforceExclusion(res.positions, req.coreExclusion);
    res.elapsedMs = timer.elapsed();
    return res;
}

} // namespace nexus::graph

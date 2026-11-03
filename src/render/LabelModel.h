#pragma once

#include <QAbstractListModel>
#include <QColor>
#include <QPointF>
#include <QString>
#include <QtQml/qqmlregistration.h>
#include <vector>

namespace nexus::render {

struct LabelData {
    QPointF pos;
    QString text;
    QString sub;
    QColor accent;
    float opacity = 0.f;
    int kind = 0;        // 0 file, 1 directory, 2 agent, 3 selected
    int nodeIndex = -1;  // global instance index
    bool visible = false;
};

// Fixed-size pool of screen-space labels. Rows never get inserted or removed, so QML
// delegates are created once and only their roles change from frame to frame.
class LabelModel : public QAbstractListModel
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Provided by NexusViewport")
public:
    enum Roles { XRole = Qt::UserRole + 1, YRole, TextRole, SubRole, AccentRole, OpacityRole, KindRole, VisibleRole, NodeRole };

    explicit LabelModel(int capacity = 48, QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = {}) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    int capacity() const { return int(m_rows.size()); }
    void update(std::vector<LabelData> labels);

private:
    std::vector<LabelData> m_rows;
};

} // namespace nexus::render

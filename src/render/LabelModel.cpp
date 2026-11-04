#include "LabelModel.h"

namespace nexus::render {

LabelModel::LabelModel(int capacity, QObject *parent)
    : QAbstractListModel(parent), m_rows(size_t(capacity))
{
}

int LabelModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : int(m_rows.size());
}

QVariant LabelModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= int(m_rows.size()))
        return {};
    const LabelData &l = m_rows[size_t(index.row())];
    switch (role) {
    case XRole: return l.pos.x();
    case YRole: return l.pos.y();
    case TextRole: return l.text;
    case SubRole: return l.sub;
    case AccentRole: return l.accent;
    case OpacityRole: return l.opacity;
    case KindRole: return l.kind;
    case VisibleRole: return l.visible;
    case NodeRole: return l.nodeIndex;
    default: return {};
    }
}

QHash<int, QByteArray> LabelModel::roleNames() const
{
    return {
        { XRole, "lx" }, { YRole, "ly" }, { TextRole, "text" }, { SubRole, "sub" }, { AccentRole, "accent" },
        { OpacityRole, "labelOpacity" }, { KindRole, "kind" }, { VisibleRole, "shown" }, { NodeRole, "node" },
    };
}

void LabelModel::update(std::vector<LabelData> labels)
{
    labels.resize(m_rows.size());
    m_rows.swap(labels);
    if (!m_rows.empty())
        emit dataChanged(index(0), index(int(m_rows.size()) - 1));
}

} // namespace nexus::render

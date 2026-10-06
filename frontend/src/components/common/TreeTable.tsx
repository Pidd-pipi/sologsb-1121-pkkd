import { InputNumber, Table, Tag, Tooltip, Typography, type TableProps } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { diameterClassLabel } from '../../utils/forestCalc';
import { isDbhAbnormal, type TreeRecord } from '../../types/tree';

export interface TreeTableProps {
  /** 本期样木 */
  items: TreeRecord[];
  /** 同批全部样木（用于胸径异常值比较） */
  peers?: TreeRecord[];
  /** 行内改胸径 */
  onDbhChange?: (id: string, dbhCm: number) => void;
  /** 是否展示径阶分组统计 */
  showClassSummary?: boolean;
  emptyText?: string;
}

type Columns = NonNullable<TableProps<TreeRecord>['columns']>;

/** 样木表格：径阶分组、行内编辑胸径、胸径异常值提示 */
export default function TreeTable({
  items,
  peers,
  onDbhChange,
  showClassSummary = true,
  emptyText = '暂无样木记录',
}: TreeTableProps) {
  const reference = peers && peers.length > 0 ? peers : items;

  const sorted = [...items].sort((a, b) => {
    const ca = diameterClassLabel(a.dbhCm);
    const cb = diameterClassLabel(b.dbhCm);
    if (ca !== cb) return ca.localeCompare(cb, 'zh-Hans-CN', { numeric: true });
    return a.treeNo.localeCompare(b.treeNo, 'zh-Hans-CN', { numeric: true });
  });

  const columns: Columns = [
    { title: '树号', dataIndex: 'treeNo', width: 80, fixed: 'left' },
    { title: '树种', dataIndex: 'species', width: 110 },
    {
      title: '径阶 cm',
      width: 110,
      render: (_: unknown, row: TreeRecord) => <Tag color="green">{diameterClassLabel(row.dbhCm)}</Tag>,
    },
    {
      title: '胸径 cm',
      width: 150,
      render: (_: unknown, row: TreeRecord) => {
        const abnormal = isDbhAbnormal(row, reference);
        return (
          <span>
            {onDbhChange ? (
              <InputNumber
                size="small"
                min={0}
                max={200}
                step={0.1}
                value={row.dbhCm}
                status={abnormal ? 'warning' : undefined}
                onChange={(v) => onDbhChange(row.id, Number(v ?? 0))}
                style={{ width: 96 }}
              />
            ) : (
              row.dbhCm
            )}
            {abnormal ? (
              <Tooltip title="胸径异常：超出 0~200 cm 或与本树种同期均值偏离超过 60%">
                <WarningOutlined style={{ color: '#d4380d', marginLeft: 6 }} />
              </Tooltip>
            ) : null}
          </span>
        );
      },
    },
    { title: '树高 m', dataIndex: 'heightM', width: 90 },
    { title: '枝下高 m', dataIndex: 'underBranchH', width: 100 },
    { title: '冠幅 m', dataIndex: 'crownWidth', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (
        <Tag color={value === '活立木' ? 'green' : value === '采伐' ? 'red' : 'orange'}>{value}</Tag>
      ),
    },
    { title: '起源', dataIndex: 'origin', width: 80 },
    { title: '健康等级', dataIndex: 'healthClass', width: 100 },
    { title: '倾斜 °', dataIndex: 'tiltDeg', width: 90 },
    { title: '位置描述', dataIndex: 'remark', ellipsis: true },
    {
      title: '期次',
      dataIndex: 'round',
      width: 90,
      render: (value: number) => `第 ${value} 期`,
    },
  ];

  const classStats = showClassSummary
    ? Array.from(
        sorted.reduce((map, tree) => {
          const label = diameterClassLabel(tree.dbhCm);
          map.set(label, (map.get(label) ?? 0) + 1);
          return map;
        }, new Map<string, number>()),
      )
    : [];

  return (
    <div data-testid="tree-table">
      {showClassSummary && classStats.length > 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          径阶分组：
          {classStats.map(([label, count]) => (
            <Tag key={label} style={{ marginLeft: 6 }}>
              {label} cm · {count} 株
            </Tag>
          ))}
        </Typography.Paragraph>
      ) : null}
      <Table<TreeRecord>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={sorted}
        pagination={false}
        scroll={{ x: 1300 }}
        locale={{ emptyText }}
        rowClassName={(row) => (isDbhAbnormal(row, reference) ? 'tree-row-abnormal' : '')}
      />
    </div>
  );
}

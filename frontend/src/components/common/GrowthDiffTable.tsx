import { Table, Tag, Typography, type TableProps } from 'antd';
import { growthRate, isDiffAbnormal, type RecheckDiff } from '../../types/recheck';

export interface GrowthDiffTableProps {
  diffs: RecheckDiff[];
  emptyText?: string;
}

type Columns = NonNullable<TableProps<RecheckDiff>['columns']>;

/** 两期逐株差值表，生长量为负或缺失时高亮 */
export default function GrowthDiffTable({ diffs, emptyText = '暂无复查比对结果' }: GrowthDiffTableProps) {
  const sorted = [...diffs].sort((a, b) =>
    a.treeNo.localeCompare(b.treeNo, 'zh-Hans-CN', { numeric: true }),
  );

  const columns: Columns = [
    { title: '树号', dataIndex: 'treeNo', width: 80 },
    { title: '树种', dataIndex: 'species', width: 110 },
    {
      title: '上期胸径 cm',
      dataIndex: 'baseDbhCm',
      width: 120,
      render: (value?: number) => (value === undefined ? <Tag color="red">缺测</Tag> : value),
    },
    {
      title: '本期胸径 cm',
      dataIndex: 'targetDbhCm',
      width: 120,
      render: (value?: number) => (value === undefined ? <Tag color="red">缺测</Tag> : value),
    },
    {
      title: '胸径生长量 cm',
      dataIndex: 'dbhGrowth',
      width: 140,
      render: (value: number) => (
        <Typography.Text type={value < 0 ? 'danger' : value > 0 ? 'success' : undefined}>
          {value > 0 ? `+${value}` : value}
        </Typography.Text>
      ),
    },
    {
      title: '树高生长量 m',
      dataIndex: 'heightGrowth',
      width: 140,
      render: (value: number) => (
        <Typography.Text type={value < 0 ? 'danger' : value > 0 ? 'success' : undefined}>
          {value > 0 ? `+${value}` : value}
        </Typography.Text>
      ),
    },
    {
      title: '保留木生长率',
      width: 130,
      render: (_: unknown, row: RecheckDiff) => {
        const rate = growthRate(row);
        return rate === 0 ? '—' : `${rate} %`;
      },
    },
    {
      title: '状态变化',
      dataIndex: 'statusChange',
      width: 170,
      render: (value: string) => (value ? <Tag color="orange">{value}</Tag> : '—'),
    },
    {
      title: '缺失原因',
      dataIndex: 'missingReason',
      width: 160,
      render: (value: string) => (value ? <Tag color="red">{value}</Tag> : '—'),
    },
  ];

  return (
    <div data-testid="growth-diff-table">
      <Table<RecheckDiff>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={sorted}
        pagination={false}
        scroll={{ x: 1200 }}
        locale={{ emptyText }}
        rowClassName={(row) => (isDiffAbnormal(row) ? 'diff-row-abnormal' : '')}
      />
    </div>
  );
}

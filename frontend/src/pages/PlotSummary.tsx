import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { usePlotStore } from '../stores/plotStore';
import { useRegenStore } from '../stores/regenStore';
import { useTreeStore } from '../stores/treeStore';
import { useTreeStats } from '../hooks/useTreeStats';
import RoundTag from '../components/common/RoundTag';
import PlotCard from '../components/common/PlotCard';
import { canopyFromCrown, formHeight, heightClassStats } from '../utils/forestCalc';
import type { TreeRecord } from '../types/tree';

type Columns = NonNullable<TableProps<TreeRecord>['columns']>;

interface SpeciesRow {
  key: string;
  species: string;
  count: number;
  meanDbh: number;
  meanHeight: number;
}

/** /summary/:plotId 林分因子汇总，可导出调查记录文本 */
export default function PlotSummary() {
  const { plotId = '' } = useParams();
  const plot = usePlotStore((s) => s.items.find((p) => p.id === plotId));
  const trees = useTreeStore((s) => s.items);
  const regens = useRegenStore((s) => s.items);
  const stats = useTreeStats(plotId);

  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const plotRegens = useMemo(
    () => regens.filter((r) => r.plotId === plotId && r.round === (plot?.surveyRound ?? 1)),
    [regens, plotId, plot?.surveyRound],
  );

  const speciesRows = useMemo(() => {
    const map = new Map<string, { species: string; count: number; dbh: number; height: number }>();
    stats.trees
      .filter((t) => t.status === '活立木')
      .forEach((t) => {
        const row = map.get(t.species) ?? { species: t.species, count: 0, dbh: 0, height: 0 };
        row.count += 1;
        row.dbh += t.dbhCm;
        row.height += t.heightM;
        map.set(t.species, row);
      });
    return Array.from(map.values()).map((r) => ({
      key: r.species,
      species: r.species,
      count: r.count,
      meanDbh: Math.round((r.dbh / r.count) * 100) / 100,
      meanHeight: Math.round((r.height / r.count) * 100) / 100,
    }));
  }, [stats.trees]);

  const speciesColumns: NonNullable<TableProps<SpeciesRow>['columns']> = [
    { title: '树种', dataIndex: 'species' },
    { title: '株数', dataIndex: 'count', width: 100 },
    { title: '平均胸径 cm', dataIndex: 'meanDbh', width: 140 },
    { title: '平均树高 m', dataIndex: 'meanHeight', width: 140 },
    {
      title: '形高',
      width: 120,
      render: (_: unknown, row: SpeciesRow) =>
        formHeight({ dbhCm: row.meanDbh, heightM: row.meanHeight } as TreeRecord),
    },
  ];

  const report = useMemo(() => {
    if (!plot) return '';
    const lines: string[] = [];
    lines.push('森林样地调查记录');
    lines.push(`样地号：${plot.plotNo}`);
    lines.push(`地点：${plot.locality}（${plot.lng}, ${plot.lat}）`);
    lines.push(`形状/面积：${plot.shape} / ${plot.area} m²`);
    lines.push(`海拔：${plot.elevation} m；坡度 ${plot.slope}°；坡向 ${plot.aspect}`);
    lines.push(`林型：${plot.forestType}；优势树种：${plot.dominantSpecies}`);
    lines.push(`复查期次：第 ${plot.surveyRound} 期；调查时间：${new Date(plot.surveyedAt).toLocaleDateString('zh-CN')}`);
    lines.push(`调查组：${plot.crew}`);
    lines.push('');
    lines.push(`每公顷株数：${stats.perHa} 株/hm²`);
    lines.push(`平均胸径：${stats.meanDbh} cm`);
    lines.push(`平均树高：${stats.meanHeight} m`);
    lines.push(`断面积合计：${stats.basalArea} m²（${stats.basalAreaPerHa} m²/hm²）`);
    lines.push(`郁闭度（录入）：${plot.canopyDensity}；按冠幅折算：${canopyFromCrown(stats.trees, plot)}`);
    lines.push(`更新苗密度：${stats.regenPerHa} 株/hm²；灌木密度：${stats.shrubPerHa} 株/hm²`);
    lines.push('');
    lines.push('径阶分布：' + stats.diameterDist.map((d) => `${d.label}cm=${d.count}`).join('，'));
    lines.push('高度级株数：' + heightClassStats(plotRegens).map((h) => `${h.label}=${h.count}`).join('，'));
    lines.push('');
    lines.push('分树种统计：');
    speciesRows.forEach((r) => {
      lines.push(`  ${r.species}：${r.count} 株，平均胸径 ${r.meanDbh} cm，平均树高 ${r.meanHeight} m`);
    });
    lines.push('');
    lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
    return lines.join('\n');
  }, [plot, stats, plotRegens, speciesRows]);

  if (!plot) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该样地" />
        <Link to="/plots">返回样地台账</Link>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          林分因子汇总 · {plot.plotNo}
        </Typography.Title>
        <RoundTag round={plot.surveyRound} locked={plot.locked} />
        <Tag color="green">{plot.forestType}</Tag>
        <div style={{ flex: 1 }} />
        <Button type="link">
          <Link to={`/plots/${plot.id}/trees`}>样木录入</Link>
        </Button>
        <Button type="link">
          <Link to={`/plots/${plot.id}/regen`}>更新与灌木</Link>
        </Button>
        <Button type="link">
          <Link to={`/plots/${plot.id}/recheck`}>复查比对</Link>
        </Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}

      <Row gutter={12}>
        <Col span={8}>
          <PlotCard plot={plot} treeCount={stats.count} />
        </Col>
        <Col span={16}>
          <Row gutter={[12, 12]}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="每公顷株数" value={stats.perHa} suffix="株/hm²" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="平均胸径" value={stats.meanDbh} precision={2} suffix="cm" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="平均树高" value={stats.meanHeight} precision={2} suffix="m" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="断面积合计" value={stats.basalArea} precision={4} suffix="m²" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="每公顷断面积" value={stats.basalAreaPerHa} precision={3} suffix="m²/hm²" />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="郁闭度（冠幅折算）" value={canopyFromCrown(stats.trees, plot)} precision={3} />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Statistic title="更新苗密度" value={stats.regenPerHa} suffix="株/hm²" />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Statistic title="灌木密度" value={stats.shrubPerHa} suffix="株/hm²" />
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>

      <Card size="small" title="径阶分布与高度级">
        <Space direction="vertical" size={6}>
          <div>
            {stats.diameterDist.map((d) => (
              <Tag key={d.label} color={d.count > 0 ? 'green' : 'default'}>
                {d.label} cm · {d.count} 株
              </Tag>
            ))}
          </div>
          <div>
            {heightClassStats(plotRegens).map((h) => (
              <Tag key={h.label} color={h.count > 0 ? 'cyan' : 'default'}>
                {h.label} · {h.count} 株
              </Tag>
            ))}
          </div>
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="活立木">{stats.aliveCount} 株</Descriptions.Item>
            <Descriptions.Item label="样木记录">{stats.count} 条</Descriptions.Item>
            <Descriptions.Item label="样方记录">{plotRegens.length} 条</Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card size="small" title="分树种统计">
        <Table<SpeciesRow>
          rowKey="key"
          size="small"
          columns={speciesColumns}
          dataSource={speciesRows}
          pagination={false}
          locale={{ emptyText: '暂无活立木数据' }}
        />
      </Card>

      <Card
        size="small"
        title="调查记录文本"
        extra={
          <Space>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report);
                  setToast('调查记录已复制到剪贴板');
                } catch {
                  setToast('浏览器未授权剪贴板，请手动复制下方文本');
                }
              }}
            >
              复制
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => {
                const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `调查记录_${plot.plotNo}.txt`;
                a.click();
                URL.revokeObjectURL(url);
                setToast('调查记录已导出为 txt');
              }}
            >
              导出
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{report}</pre>
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}

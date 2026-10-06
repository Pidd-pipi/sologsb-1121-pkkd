import type { ReactNode } from 'react';
import { Card, Descriptions, Progress, Space, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { Plot } from '../../types/plot';
import RoundTag from './RoundTag';

export interface PlotCardProps {
  plot: Plot;
  treeCount?: number;
  onOpen?: (id: string) => void;
  footer?: ReactNode;
}

/** 样地摘要卡（样地号、地点、面积、郁闭度、优势树种），被样地台账与汇总页消费 */
export default function PlotCard({ plot, treeCount, onOpen, footer }: PlotCardProps) {
  return (
    <Card
      size="small"
      hoverable={!!onOpen}
      onClick={onOpen ? () => onOpen(plot.id) : undefined}
      title={
        <Space size={6} wrap>
          <span data-testid={`plot-card-${plot.plotNo}`}>{plot.plotNo}</span>
          <RoundTag round={plot.surveyRound} locked={plot.locked} />
        </Space>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 6 }} type="secondary" ellipsis={{ rows: 1 }}>
        <EnvironmentOutlined /> {plot.locality}
      </Typography.Paragraph>
      <Descriptions size="small" column={2} colon={false}>
        <Descriptions.Item label="面积">{plot.area} m²</Descriptions.Item>
        <Descriptions.Item label="形状">{plot.shape}</Descriptions.Item>
        <Descriptions.Item label="林型">{plot.forestType}</Descriptions.Item>
        <Descriptions.Item label="海拔">{plot.elevation} m</Descriptions.Item>
        <Descriptions.Item label="坡度/坡向">
          {plot.slope}° / {plot.aspect}
        </Descriptions.Item>
        <Descriptions.Item label="优势树种">{plot.dominantSpecies}</Descriptions.Item>
        <Descriptions.Item label="已录样木" span={2}>
          {treeCount === undefined ? '—' : `${treeCount} 株`}
        </Descriptions.Item>
      </Descriptions>
      <div style={{ marginTop: 6 }}>
        <Typography.Text type="secondary">郁闭度 {plot.canopyDensity.toFixed(2)}</Typography.Text>
        <Progress percent={Math.round(plot.canopyDensity * 100)} size="small" showInfo={false} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        调查组：{plot.crew} · 调查时间 {new Date(plot.surveyedAt).toLocaleDateString('zh-CN')}
      </Typography.Text>
      {footer ? <div style={{ marginTop: 8 }}>{footer}</div> : null}
    </Card>
  );
}

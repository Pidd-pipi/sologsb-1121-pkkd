import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  type TableProps,
  type UploadProps,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  RetweetOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { usePlotStore } from '../stores/plotStore';
import { useTreeStore } from '../stores/treeStore';
import {
  commitBatch,
  discardBatch,
  listBatches,
  loadStaging,
  parseReceipt,
  previewReceipt,
  ReceiptError,
  persistResolution,
  setResolution,
  type CommitResult,
} from '../utils/receiptService';
import { FIELD_LABELS, type CompareField } from '../utils/reconcile';
import { newId } from '../utils/id';
import type { ImportBatch, Receipt, Resolution, StagingRow } from '../types/receipt';

const STATUS_META: Record<
  StagingRow['status'],
  { label: string; color: string; resolutionLabel: string }
> = {
  equal: { label: '预检一致', color: 'green', resolutionLabel: '唯一匹配、无差异' },
  conflict: { label: '值不同·人工选择', color: 'orange', resolutionLabel: '' },
  local_only: { label: '本地独有·保留', color: 'blue', resolutionLabel: '不删除' },
  remote_only: { label: '回执独有', color: 'purple', resolutionLabel: '' },
};

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}

function sampleReceipt(): Receipt {
  const now = Date.now();
  return {
    batchId: `X${newId('b').slice(-6)}`,
    source: '县连续清查系统检查回执（示例）',
    exportedAt: now,
    trees: [
      { plotNo: 'FP-4102', round: 2, treeNo: '1', dbhCm: 36.5, heightM: 19.9 },
      { plotNo: 'FP-4102', round: 2, treeNo: '2', dbhCm: 28.2 },
      { plotNo: 'FP-4102', round: 2, treeNo: '3', dbhCm: 43.7, heightM: 22.6 },
      { plotNo: 'FP-4102', round: 2, treeNo: '7', species: '红皮云杉', dbhCm: 8.4, heightM: 6.8 },
      // 旧备份缺树号：靠树种/胸径模糊核对
      { plotNo: 'FP-4115', round: 1, species: '蒙古栎', dbhCm: 22.4, heightM: 13.2 },
    ],
  };
}

/** /receipts 清查回执对账合入中心 */
export default function ReceiptImport() {
  const plots = usePlotStore((s) => s.items);
  const trees = useTreeStore((s) => s.items);
  const reloadPlots = usePlotStore((s) => s.load);
  const reloadTrees = useTreeStore((s) => s.load);

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [staging, setStaging] = useState<StagingRow[]>([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCommit, setLastCommit] = useState<CommitResult | null>(null);

  const refreshBatches = async () => setBatches(await listBatches());

  useEffect(() => {
    void refreshBatches();
  }, []);

  const activeBatch = batches.find((b) => b.id === activeId);

  const openBatch = async (batch: ImportBatch) => {
    setError('');
    setLastCommit(null);
    setActiveId(batch.id);
    setStaging(await loadStaging(batch.id));
  };

  const handleText = async (text: string) => {
    setBusy(true);
    setError('');
    try {
      const receipt = parseReceipt(text);
      const result = await previewReceipt(receipt, plots, trees);
      await refreshBatches();
      if (result.duplicated) {
        setError(
          `回执批次指纹 ${result.batch.fingerprint} 已合入（${result.batch.source}），重复导入已拦截`,
        );
        setActiveId(result.batch.id);
        setStaging([]);
      } else {
        setActiveId(result.batch.id);
        setStaging(result.staging);
        setToast(
          `预检完成：${countBy(result.staging, 'equal')} 株一致、${countBy(result.staging, 'conflict')} 株值不同、` +
            `${countBy(result.staging, 'remote_only')} 株回执独有、${countBy(result.staging, 'local_only')} 株本地独有`,
        );
      }
    } catch (err) {
      setError(err instanceof ReceiptError ? err.message : `预检失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    beforeUpload: async (file: UploadFile) => {
      try {
        const text = await (file as unknown as File).text();
        await handleText(text);
      } catch (err) {
        setError(`读取回执失败：${String(err)}`);
      }
      return false;
    },
  };

  const choose = (id: string, resolution: Resolution) => {
    setStaging((prev) => setResolution(prev, id, resolution));
    void persistResolution(id, resolution);
  };

  const unresolved = staging.filter((r) => r.resolution === 'pending');
  const canCommit = !!activeBatch && ['preview', 'failed'].includes(activeBatch.state) && unresolved.length === 0;

  const commit = async () => {
    if (!activeBatch) return;
    setBusy(true);
    setError('');
    try {
      // 暂存里的人工选择先落库，保证“确认后整批合入”
      const chosen = staging.map((r) => ({ ...r }));
      const result = await commitBatch(activeBatch, chosen, trees);
      await Promise.all([reloadTrees(), reloadPlots(), refreshBatches()]);
      setLastCommit(result);
      setStaging([]);
      setActiveId('');
      setToast(
        `整批合入成功：更新 ${result.updated} 株、新增 ${result.inserted} 株、保留本地 ${result.kept} 株、` +
          `跳过 ${result.skipped} 株；${result.recomputed} 条复查比对已用新数据重算`,
      );
    } catch (err) {
      await refreshBatches();
      setError(err instanceof ReceiptError ? err.message : `合入失败：${String(err)}`);
      setToast('合入事务已回滚，预检结果原样保留，可调整后重试');
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (!activeBatch) return;
    Modal.confirm({
      title: '放弃本批预检结果？',
      content: '暂存对账单将被清除；已合入的批次不受影响。',
      okText: '放弃',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await discardBatch(activeBatch.id);
        await refreshBatches();
        setActiveId('');
        setStaging([]);
      },
    });
  };

  const columns: NonNullable<TableProps<StagingRow>['columns']> = [
    {
      title: '样地号 / 期次 / 树号',
      width: 190,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{r.plotNo || '（缺样地号）'}</Typography.Text>
          <Typography.Text type="secondary">
            第 {r.round || '?'} 期 · {r.treeNo || '无树号（旧备份）'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '对账结论',
      width: 150,
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_META[r.status].color}>{STATUS_META[r.status].label}</Tag>
          {r.fuzzyMatched ? <Tag color="gold">模糊核对</Tag> : null}
        </Space>
      ),
    },
    {
      title: '差异字段（本地 → 回执）',
      render: (_, r) => (
        <Space size={[4, 4]} wrap>
          {r.status === 'local_only' ? (
            <Typography.Text type="secondary">{r.note}</Typography.Text>
          ) : r.diffFields.length === 0 ? (
            <Typography.Text type="secondary">{r.note || '参与字段全部一致'}</Typography.Text>
          ) : (
            r.diffFields.map((f) => (
              <Tag key={f} color={r.status === 'conflict' ? 'orange' : 'default'}>
                {FIELD_LABELS[f as CompareField]}：{fmt(r.local?.[f as CompareField])} →{' '}
                {fmt(r.remote[f as CompareField])}
              </Tag>
            ))
          )}
          {r.note && r.status !== 'local_only' ? (
            <Typography.Text type="warning">{r.note}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '人工选择',
      width: 240,
      render: (_, r) => {
        if (r.status === 'equal') {
          return <Typography.Text type="success"><CheckCircleOutlined /> 预检通过</Typography.Text>;
        }
        if (r.status === 'local_only') {
          return <Typography.Text type="secondary">保留不删</Typography.Text>;
        }
        return (
          <Radio.Group
            size="small"
            value={r.resolution === 'pending' ? undefined : r.resolution}
            onChange={(e) => choose(r.id, e.target.value as Resolution)}
          >
            <Space direction="vertical" size={2}>
              {r.status === 'conflict' ? (
                <>
                  <Radio value="use_remote">采用回执值</Radio>
                  <Radio value="keep_local">保留本地值</Radio>
                </>
              ) : (
                <>
                  <Radio value="insert_new">作为新样木合入</Radio>
                  <Radio value="skip">跳过（不合入）</Radio>
                </>
              )}
            </Space>
          </Radio.Group>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          清查回执对账合入中心
        </Typography.Title>
        <Tag>按 样地号 + 期次 + 树号 对账</Tag>
        <div style={{ flex: 1 }} />
        <Upload {...uploadProps}>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={busy}>
            导入检查回执（JSON）
          </Button>
        </Upload>
        <Button icon={<FileSearchOutlined />} onClick={() => void handleText(JSON.stringify(sampleReceipt()))}>
          载入示例回执
        </Button>
      </Space>

      {toast ? (
        <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} />
      ) : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}
      {lastCommit ? (
        <Alert
          type="info"
          showIcon
          message="合入后联动已完成"
          description={
            <Space wrap>
              <Tag color="green">复查比对重算 {lastCommit.recomputed} 条</Tag>
              <Tag>受影响样地 {lastCommit.invalidatedPlotIds.length} 个</Tag>
              <Typography.Text type="secondary">
                林分汇总与调查记录导出将自动跟随新结果，无需手工刷新口径
              </Typography.Text>
            </Space>
          }
        />
      ) : null}

      <Row gutter={12}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="预检批次" value={batches.length} suffix="批" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已合入" value={batches.filter((b) => b.state === 'committed').length} suffix="批" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="待确认 / 失败可重试" value={batches.filter((b) => b.state !== 'committed').length} suffix="批" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="当前批次待人工选择"
              value={unresolved.length}
              suffix="株"
              valueStyle={unresolved.length > 0 ? { color: '#d46b08' } : undefined}
            />
          </Card>
        </Col>
      </Row>

      {batches.length > 0 ? (
        <Card size="small" title="回执批次（指纹去重）">
          <Table<ImportBatch>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={batches}
            columns={[
              {
                title: '来源 / 批次号',
                render: (_, b) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{b.source}</Typography.Text>
                    <Typography.Text type="secondary" code>
                      {b.sourceBatchId || '无批次号'} · {b.fingerprint}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '覆盖范围',
                render: (_, b) =>
                  `${b.plotNos.join('、') || '—'}；第 ${b.rounds.join('/')} 期；${b.treeCount} 株` +
                  (b.legacyNoTreeNo > 0 ? `；旧备份缺树号 ${b.legacyNoTreeNo} 株` : ''),
              },
              {
                title: '状态',
                width: 130,
                render: (_, b) => (
                  <Badge
                    status={b.state === 'committed' ? 'success' : b.state === 'failed' ? 'error' : 'warning'}
                    text={b.state === 'committed' ? '已合入' : b.state === 'failed' ? `失败${b.lastError ? '（可重试）' : ''}` : '待确认'}
                  />
                ),
              },
              {
                title: '操作',
                width: 200,
                render: (_, b) => (
                  <Space size={4}>
                    {b.state === 'committed' ? (
                      <Typography.Text type="secondary">指纹已挡重复</Typography.Text>
                    ) : (
                      <>
                        <Button size="small" type="link" onClick={() => void openBatch(b)}>
                          打开对账单
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() =>
                            b.id === activeId
                              ? discard()
                              : discardBatch(b.id).then(() => refreshBatches())
                          }
                        >
                          弃批
                        </Button>
                      </>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      {activeBatch && staging.length > 0 ? (
        <Card
          size="small"
          title={
            <Space wrap>
              <span>对账单 · {activeBatch.source}</span>
              <Tag>{staging.length} 行</Tag>
              {activeBatch.state === 'failed' ? (
                <Tag color="error">上次失败：{activeBatch.lastError}</Tag>
              ) : null}
              {unresolved.length > 0 ? <Tag color="orange">待人工选择 {unresolved.length} 株</Tag> : null}
            </Space>
          }
          extra={
            <Space>
              <Button icon={<RetweetOutlined />} onClick={discard}>
                放弃预检
              </Button>
              <Button
                type="primary"
                disabled={!canCommit}
                loading={busy}
                onClick={commit}
              >
                {activeBatch.state === 'failed' ? '重试整批合入' : '确认后整批合入'}
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 10 }}
            message="合入规则：唯一匹配且值一致的预检通过；值不同的保留两份等人工选择；本地多出的记录不删；整批同事务，失败原样保留可重试；受影响复查比对立即失效重算。"
          />
          <Table<StagingRow>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={staging}
            pagination={false}
            scroll={{ x: 1050 }}
            rowClassName={(r) =>
              r.resolution === 'pending'
                ? 'recon-row-pending'
                : r.status === 'conflict'
                  ? 'recon-row-conflict'
                  : ''
            }
          />
        </Card>
      ) : activeBatch ? (
        <Empty description="该批次已合入，暂存对账单已清理" />
      ) : (
        <Empty description="导入县清查系统检查回执后，这里显示按样地号/期次/树号的对账单" />
      )}
    </Space>
  );
}

function countBy(rows: StagingRow[], status: StagingRow['status']): number {
  return rows.filter((r) => r.status === status).length;
}

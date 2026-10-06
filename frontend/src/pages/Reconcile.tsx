import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Modal,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  ExperimentOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { usePlotStore } from '../stores/plotStore';
import { useTreeStore } from '../stores/treeStore';
import { useReceiptStore } from '../stores/receiptStore';
import {
  buildSampleReceipt,
  computeFingerprint,
  mergeReceipt,
  parseReceipt,
  reconcile,
  type MergeOutcome,
} from '../utils/receipt';
import {
  CONFLICT_CHOICE_LABELS,
  RECONCILE_KIND_LABELS,
  type ConflictChoice,
  type ReceiptFile,
  type ReconcileItem,
  type ReconcileKind,
  type ReconcileResult,
} from '../types/receipt';
import type { TreeRecord } from '../types/tree';

type Columns = NonNullable<TableProps<ReconcileItem>['columns']>;

const KIND_COLOR: Record<ReconcileKind, string> = {
  identical: 'default',
  autoMerge: 'green',
  conflict: 'orange',
  receiptOnly: 'blue',
  unmatchedPlot: 'red',
};

/** 检查回执对账合入：按样地号+期次+树号对账，预检分类，整批合入，失败可重试 */
export default function Reconcile() {
  const plots = usePlotStore((s) => s.items);
  const trees = useTreeStore((s) => s.items);
  const mergeItems = useTreeStore((s) => s.mergeItems);
  const receiptBatches = useReceiptStore((s) => s.batches);
  const loadReceipts = useReceiptStore((s) => s.load);

  const [file, setFile] = useState<ReceiptFile | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [merging, setMerging] = useState(false);
  const [outcome, setOutcome] = useState<MergeOutcome | null>(null);
  const [toast, setToast] = useState('');
  const [showLocalOnly, setShowLocalOnly] = useState(false);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const fpExists = useMemo(
    () => (fp: string) => receiptBatches.some((b) => b.fingerprint === fp),
    [receiptBatches],
  );

  const handleText = (text: string, name: string) => {
    const { file: parsed, error } = parseReceipt(text);
    if (error || !parsed) {
      setParseError(error ?? '回执解析失败');
      setFile(null);
      setResult(null);
      return;
    }
    setParseError('');
    setFileName(name);
    setFile(parsed);
    setOutcome(null);
    const fp = computeFingerprint(parsed);
    setFingerprint(fp);
    setDuplicate(fpExists(fp));
    setResult(reconcile(parsed, plots, trees));
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => handleText(String(reader.result ?? ''), f.name);
    reader.readAsText(f);
    e.target.value = '';
  };

  const loadSample = () => {
    const sample = buildSampleReceipt(plots, trees);
    handleText(JSON.stringify(sample, null, 2), '示例回执.json');
  };

  const setChoice = (idx: number, choice: ConflictChoice) => {
    setResult((prev) => {
      if (!prev) return prev;
      const items = [...prev.items];
      items[idx] = { ...items[idx], choice };
      return { ...prev, items };
    });
  };

  const doMerge = async () => {
    if (!file || !result) return;
    setMerging(true);
    setOutcome(null);
    const batchMeta = {
      fingerprint,
      batchNo: file.batchNo ?? fileName,
      source: file.source ?? '检查回执',
      issuedAt: file.issuedAt ?? Date.now(),
      plotNos: Array.from(new Set(file.trees.map((t) => t.plotNo))),
      recordCount: file.trees.length,
    };
    const res = await mergeReceipt(file, result, plots, batchMeta);
    setMerging(false);
    setOutcome(res);
    if (!res.failed) {
      mergeItems(res.putRecords);
      setToast(`合入完成：更新 ${res.mergedCount - res.addedCount} 株，新增 ${res.addedCount} 株`);
      setDuplicate(true);
      void loadReceipts();
    }
  };

  const conflictItems = result?.items.filter((i) => i.kind === 'conflict') ?? [];
  const autoMergeItems = result?.items.filter((i) => i.kind === 'autoMerge') ?? [];
  const receiptOnlyItems = result?.items.filter((i) => i.kind === 'receiptOnly') ?? [];
  const identicalItems = result?.items.filter((i) => i.kind === 'identical') ?? [];

  const columns: Columns = [
    {
      title: '对账结果',
      dataIndex: 'kind',
      width: 140,
      render: (kind: ReconcileKind) => <Tag color={KIND_COLOR[kind]}>{RECONCILE_KIND_LABELS[kind]}</Tag>,
    },
    {
      title: '样地号',
      width: 120,
      render: (_: unknown, row: ReconcileItem) => row.receipt.plotNo,
    },
    {
      title: '期次',
      width: 80,
      render: (_: unknown, row: ReconcileItem) => `第 ${row.receipt.round} 期`,
    },
    { title: '树号', width: 90, render: (_: unknown, row: ReconcileItem) => row.receipt.treeNo },
    {
      title: '树种（本地 → 回执）',
      width: 180,
      render: (_: unknown, row: ReconcileItem) =>
        row.local ? `${row.local.species} → ${row.receipt.species}` : row.receipt.species,
    },
    {
      title: '胸径 cm（本地 → 回执）',
      width: 180,
      render: (_: unknown, row: ReconcileItem) =>
        row.local ? `${row.local.dbhCm} → ${row.receipt.dbhCm}` : row.receipt.dbhCm,
    },
    {
      title: '树高 m（本地 → 回执）',
      width: 180,
      render: (_: unknown, row: ReconcileItem) =>
        row.local ? `${row.local.heightM} → ${row.receipt.heightM}` : row.receipt.heightM,
    },
    {
      title: '状态（本地 → 回执）',
      width: 160,
      render: (_: unknown, row: ReconcileItem) =>
        row.local ? `${row.local.status} → ${row.receipt.status ?? '活立木'}` : (row.receipt.status ?? '活立木'),
    },
  ];

  const conflictColumns: Columns = [
    ...columns.slice(1),
    {
      title: '人工选择',
      width: 320,
      render: (_: unknown, row: ReconcileItem) => {
        const idx = result?.items.indexOf(row) ?? -1;
        return (
          <Radio.Group
            value={row.choice ?? 'local'}
            onChange={(e) => setChoice(idx, e.target.value as ConflictChoice)}
            optionType="button"
            buttonStyle="solid"
            size="small"
            options={(Object.keys(CONFLICT_CHOICE_LABELS) as ConflictChoice[]).map((c) => ({
              value: c,
              label: CONFLICT_CHOICE_LABELS[c],
            }))}
          />
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          检查回执对账合入
        </Typography.Title>
        <Tag color="blue">按样地号 + 期次 + 树号对账</Tag>
        <div style={{ flex: 1 }} />
        <Button type="link">
          <Link to="/plots">返回台账</Link>
        </Button>
      </Space>

      <Alert
        type="info"
        showIcon
        message="不整库覆盖，逐株对账合入"
        description="县里连续清查系统传回检查回执后，按样地号、期次、树号逐株对账：唯一匹配且差异明确的自动合入；双方值不同的保留两份等人工选择；本地多出的记录不删除。合入后受影响的复查比对立即失效重算，汇总和导出跟随新结果。"
      />

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}

      <Card size="small" title="1. 导入检查回执（JSON）">
        <Space wrap>
          <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => document.getElementById('reconcile-file')?.click()}>
            选择回执文件
          </Button>
          <input id="reconcile-file" type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFileChange} />
          <Button icon={<ExperimentOutlined />} onClick={loadSample}>
            载入示例回执
          </Button>
          {fileName ? <Tag color="green">已读入：{fileName}</Tag> : null}
        </Space>
        {parseError ? (
          <Alert style={{ marginTop: 10 }} type="error" showIcon message={parseError} />
        ) : null}
        {file ? (
          <Descriptions size="small" column={4} style={{ marginTop: 10 }}>
            <Descriptions.Item label="批次号">{file.batchNo ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="来源">{file.source ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="记录数">{file.trees.length} 株</Descriptions.Item>
            <Descriptions.Item label="批次指纹">
              <Typography.Text code>{fingerprint}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        ) : null}
        {duplicate ? (
          <Alert
            style={{ marginTop: 10 }}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="该回执已导入过（批次指纹重复）"
            description="同一回执按批次指纹挡住重复导入。如需重新合入，请先更换回执内容或批次号。"
          />
        ) : null}
      </Card>

      {result ? (
        <>
          <Card size="small" title="2. 预检结果">
            <Row gutter={12}>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="完全一致" value={result.counts.identical} suffix="株" />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="可自动合入" value={result.counts.autoMerge} suffix="株" valueStyle={{ color: '#3f8600' }} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="待人工选择" value={result.counts.conflict} suffix="株" valueStyle={{ color: '#d46b08' }} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="回执新增" value={result.counts.receiptOnly} suffix="株" valueStyle={{ color: '#1677ff' }} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="本地多出（不删）" value={result.counts.localOnly} suffix="株" />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="样地未匹配" value={result.counts.unmatchedPlot} suffix="株" valueStyle={{ color: '#cf1322' }} />
                </Card>
              </Col>
            </Row>
            {result.counts.localOnly > 0 ? (
              <Alert
                style={{ marginTop: 10 }}
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`本地多出 ${result.counts.localOnly} 株记录，合入时原样保留、不删除`}
                description="这些样木在回执覆盖的样地内无对应回执记录，属于本地保留数据，整批合入不会动它们。"
              />
            ) : null}
          </Card>

          {conflictItems.length > 0 ? (
            <Card size="small" title={`3. 人工选择（双方值不同，${conflictItems.length} 株）`}>
              <Alert
                style={{ marginBottom: 10 }}
                type="warning"
                showIcon
                message="以下样木回执值与本地值差异不属于明确更新（如树种不符或胸径异常缩水），请选择处理方式"
                description="「保留本地」不动；「采用回执」用回执值覆盖；「两份都留」保留本地并把回执作为新记录（树号加「（回执）」后缀），稍后可在样木清单删除多余一份。"
              />
              <Table<ReconcileItem>
                rowKey={(row) => `${row.receipt.plotNo}-${row.receipt.round}-${row.receipt.treeNo}`}
                size="small"
                columns={conflictColumns}
                dataSource={conflictItems}
                pagination={false}
                scroll={{ x: 1400 }}
              />
            </Card>
          ) : null}

          <Card size="small" title="4. 合入明细">
            <Table<ReconcileItem>
              rowKey={(row) => `${row.receipt.plotNo}-${row.receipt.round}-${row.receipt.treeNo}`}
              size="small"
              columns={columns}
              dataSource={result.items}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              scroll={{ x: 1200 }}
              locale={{ emptyText: '无对账记录' }}
            />
          </Card>

          <Card size="small" title="5. 确认合入">
            <Space wrap>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                loading={merging}
                disabled={duplicate || !file}
                onClick={doMerge}
              >
                整批合入（自动合入 {autoMergeItems.length} 株 · 新增 {receiptOnlyItems.length} 株 · 冲突 {conflictItems.length} 株）
              </Button>
              <Typography.Text type="secondary">
                合入在事务中整批提交：失败则原样保留，可重试。
              </Typography.Text>
            </Space>
            {outcome ? (
              outcome.failed ? (
                <Alert
                  style={{ marginTop: 10 }}
                  type="error"
                  showIcon
                  message="合入失败，已原样保留（事务回滚）"
                  description={`原因：${outcome.error ?? '未知错误'}。数据未改动，可修正后重新点击合入。`}
                />
              ) : (
                <Alert
                  style={{ marginTop: 10 }}
                  type="success"
                  showIcon
                  message={`合入成功：更新 ${outcome.mergedCount - outcome.addedCount} 株，新增 ${outcome.addedCount} 株`}
                  description="受影响样地的复查比对已失效并重算最新两期；林分汇总与导出跟随新结果。可前往复查比对页查看。"
                />
              )
            ) : null}
          </Card>

          {result.localOnly.length > 0 ? (
            <Card size="small" title={`本地多出记录（${result.localOnly.length} 株，原样保留不删除）`}>
              <Button size="small" onClick={() => setShowLocalOnly((v) => !v)}>
                {showLocalOnly ? '收起' : '查看'}本地保留的样木
              </Button>
              {showLocalOnly ? (
                <Table<TreeRecord>
                  style={{ marginTop: 10 }}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '样地号', width: 120, render: (_: unknown, t: TreeRecord) => plots.find((p) => p.id === t.plotId)?.plotNo ?? '—' },
                    { title: '期次', width: 80, render: (_: unknown, t: TreeRecord) => `第 ${t.round} 期` },
                    { title: '树号', dataIndex: 'treeNo', width: 90 },
                    { title: '树种', dataIndex: 'species', width: 120 },
                    { title: '胸径 cm', dataIndex: 'dbhCm', width: 100 },
                    { title: '树高 m', dataIndex: 'heightM', width: 100 },
                  ]}
                  dataSource={result.localOnly}
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  locale={{ emptyText: '无' }}
                />
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <Card size="small">
          <Empty description="导入回执后开始对账预检" />
        </Card>
      )}
    </Space>
  );
}

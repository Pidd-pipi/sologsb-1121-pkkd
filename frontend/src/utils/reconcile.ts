import type { Plot } from '../types/plot';
import type { TreeRecord } from '../types/tree';
import type { ReceiptTree, ReconStatus, Resolution, StagingRow } from '../types/receipt';
import { newId } from './id';

/** 参与逐株核对的字段及中文名 */
export const COMPARE_FIELDS = [
  'species',
  'dbhCm',
  'heightM',
  'underBranchH',
  'crownWidth',
  'status',
  'origin',
  'healthClass',
  'tiltDeg',
  'remark',
] as const;

export type CompareField = (typeof COMPARE_FIELDS)[number];

export const FIELD_LABELS: Record<CompareField, string> = {
  species: '树种',
  dbhCm: '胸径(cm)',
  heightM: '树高(m)',
  underBranchH: '枝下高(m)',
  crownWidth: '冠幅(m)',
  status: '状态',
  origin: '起源',
  healthClass: '健康等级',
  tiltDeg: '倾斜度(°)',
  remark: '备注',
};

/** 数值字段（比对时留容差，规避 0.1+0.2 类浮点噪声） */
const NUMERIC_FIELDS: CompareField[] = [
  'dbhCm',
  'heightM',
  'underBranchH',
  'crownWidth',
  'tiltDeg',
];

function numericEqual(a: unknown, b: unknown): boolean {
  const x = typeof a === 'number' ? a : Number(a);
  const y = typeof b === 'number' ? b : Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) < 0.005;
}

/** 只对回执明确给出的字段做比对；返回双方不同的字段名 */
export function diffFields(local: TreeRecord | undefined, remote: ReceiptTree): CompareField[] {
  return COMPARE_FIELDS.filter((field) => {
    if (remote[field] === undefined || remote[field] === null || remote[field] === '') return false;
    if (!local) return true;
    const lv = local[field];
    const rv = remote[field];
    if (NUMERIC_FIELDS.includes(field)) return !numericEqual(lv, rv);
    return String(lv ?? '') !== String(rv ?? '');
  });
}

function fuzzyScore(local: TreeRecord, remote: ReceiptTree): number {
  let score = 0;
  if (remote.species && local.species === remote.species) score += 2;
  if (typeof remote.dbhCm === 'number' && Math.abs(local.dbhCm - remote.dbhCm) <= 0.6) score += 2;
  if (typeof remote.heightM === 'number' && Math.abs(local.heightM - remote.heightM) <= 0.5) score += 1;
  return score;
}

/** 旧备份缺树号：同期同地按树种/胸径/树高找唯一相似木 */
export function fuzzyFind(
  trees: TreeRecord[],
  plotId: string,
  round: number,
  remote: ReceiptTree,
): { candidates: TreeRecord[] } {
  const sameRound = trees.filter((t) => t.plotId === plotId && t.round === round);
  const scored = sameRound
    .map((t) => ({ t, score: fuzzyScore(t, remote) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return { candidates: scored.filter((x) => x.score === best).map((x) => x.t) };
}

export interface ReconInput {
  batchId: string;
  plots: Plot[];
  trees: TreeRecord[];
  rows: ReceiptTree[];
  createdAt?: number;
}

/**
 * 按 样地号 + 期次 + 树号 对账：
 * - equal       唯一匹配、回执给出的字段全部一致（预检通过，可直接合）
 * - conflict    唯一匹配但值不同，或旧备份模糊匹配命中 → 保留两份等人工选择
 * - local_only  本地有、回执无（不删不动）
 * - remote_only 回执多（含旧备份无树号无法定位），人工选择新增 / 跳过
 */
export function reconcile({ batchId, plots, trees, rows, createdAt }: ReconInput): StagingRow[] {
  const now = createdAt ?? Date.now();
  const staging: StagingRow[] = [];

  // 本地按 样地号+期次+树号 建索引
  const plotNoToId = new Map(plots.map((p) => [p.plotNo.trim(), p.id]));
  const localIndex = new Map<string, TreeRecord[]>();
  trees.forEach((t) => {
    const plot = plots.find((p) => p.id === t.plotId);
    if (!plot) return;
    const key = `${plot.plotNo.trim()}|${t.round}|${t.treeNo.trim()}`;
    localIndex.set(key, [...(localIndex.get(key) ?? []), t]);
  });

  const usedLocalIds = new Set<string>();

  rows.forEach((remote, remoteIndex) => {
    const plotNo = String(remote.plotNo ?? '').trim();
    const plotId = plotNoToId.get(plotNo) ?? '';
    const round = Number(remote.round);
    const rawTreeNo = remote.treeNo === undefined || remote.treeNo === null ? '' : String(remote.treeNo).trim();
    let local: TreeRecord | undefined;
    let fuzzyMatched = false;
    let note = '';
    let status: ReconStatus;

    if (!plotId) {
      // 回执里的样地本地没有：先按本地独有之外的新样地处理，页面引导建样地
      status = 'remote_only';
      note = '本地无此样地号，需先建档后再合入';
    } else if (!Number.isFinite(round) || round < 1) {
      status = 'remote_only';
      note = '回执缺少有效期次';
    } else if (rawTreeNo) {
      const pair = localIndex.get(`${plotNo}|${round}|${rawTreeNo}`) ?? [];
      if (pair.length === 1) {
        local = pair[0];
      } else if (pair.length > 1) {
        note = `本地同键存在 ${pair.length} 条重复记录，请先清理本地数据`;
      }
      if (local) {
        const fields = diffFields(local, remote);
        status = fields.length === 0 ? 'equal' : 'conflict';
      } else {
        status = 'remote_only';
      }
    } else {
      // 旧备份缺树号来源：模糊核对
      const { candidates } = fuzzyFind(trees, plotId, round, remote);
      if (candidates.length === 1) {
        local = candidates[0];
        fuzzyMatched = true;
        const fields = diffFields(local, remote);
        status = fields.length === 0 ? 'equal' : 'conflict';
        note =
          fields.length === 0
            ? '旧备份缺树号，按树种/胸径/树高唯一比对一致'
            : '旧备份缺树号，按树种/胸径/树高模糊命中唯一相似木，请确认';
      } else if (candidates.length > 1) {
        status = 'remote_only';
        note = `旧备份缺树号，找到 ${candidates.length} 株相似木，无法唯一确认`;
      } else {
        status = 'remote_only';
        note = '旧备份缺树号，未找到相似木，按新增或跳过处理';
      }
    }

    if (local) usedLocalIds.add(local.id);

    let resolution: Resolution = status === 'equal' ? 'use_remote' : 'pending';

    staging.push({
      id: newId('stg'),
      batchId,
      plotNo,
      plotId,
      round,
      treeNo: rawTreeNo || local?.treeNo || '',
      status,
      resolution,
      fuzzyMatched,
      note,
      diffFields: local ? diffFields(local, remote) : COMPARE_FIELDS.filter((f) => remote[f] !== undefined),
      local: local ? treeToReceipt(local) : undefined,
      localRecordId: local?.id,
      remote,
      remoteIndex,
      createdAt: now,
    });
  });

  // 本地多出的记录：不删，仅挂账展示
  trees.forEach((t) => {
    if (usedLocalIds.has(t.id)) return;
    const plot = plots.find((p) => p.id === t.plotId);
    if (!plot) return;
    // 只把本批回执涉及的（样地号, 期次）范围内的本地记录列为 local_only
    const touched = rows.some(
      (r) =>
        String(r.plotNo ?? '').trim() === plot.plotNo.trim() && Number(r.round) === t.round,
    );
    if (!touched) return;
    staging.push({
      id: newId('stg'),
      batchId,
      plotNo: plot.plotNo,
      plotId: plot.id,
      round: t.round,
      treeNo: t.treeNo,
      status: 'local_only',
      resolution: 'keep_local',
      fuzzyMatched: false,
      note: '本地多出的记录，合入时保留不删',
      diffFields: [],
      local: treeToReceipt(t),
      localRecordId: t.id,
      remote: {} as ReceiptTree,
      remoteIndex: -1,
      createdAt: now,
    });
  });

  return staging;
}

function treeToReceipt(t: TreeRecord): ReceiptTree {
  return {
    plotNo: '',
    round: t.round,
    treeNo: t.treeNo,
    species: t.species,
    dbhCm: t.dbhCm,
    heightM: t.heightM,
    underBranchH: t.underBranchH,
    crownWidth: t.crownWidth,
    status: t.status,
    origin: t.origin,
    healthClass: t.healthClass,
    tiltDeg: t.tiltDeg,
    remark: t.remark,
    measuredAt: t.measuredAt,
  };
}

/** 归一化行用于批次指纹（树号缺失的旧备份按内容归一化，仍可识别同份回执） */
function canonicalRow(r: ReceiptTree): string {
  const picked = COMPARE_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
    const v = r[key];
    if (v !== undefined && v !== null && v !== '') acc[key] = NUMERIC_FIELDS.includes(key) ? Number(v) : String(v).trim();
    return acc;
  }, {});
  return JSON.stringify({
    p: String(r.plotNo ?? '').trim(),
    r: Number(r.round),
    n: String(r.treeNo ?? '').trim(),
    ...picked,
  });
}

/** 批次指纹：回执内容 + 来源批次号共同决定，同份回执重复导入被挡住 */
export function batchFingerprint(rows: ReceiptTree[], sourceBatchId = ''): string {
  const body = rows.map(canonicalRow).sort().join('\n');
  let h1 = 0xdeadbeef ^ sourceBatchId.length;
  let h2 = 0x41c6ce57 ^ sourceBatchId.length;
  const seed = `${sourceBatchId}||${body}`;
  for (let i = 0; i < seed.length; i += 1) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
  return `fp_${hex(h2)}${hex(h1)}`;
}

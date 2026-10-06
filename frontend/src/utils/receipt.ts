import { db } from './db';
import { newId } from './id';
import { recomputePlotRechecks } from './recheck';
import type { Plot } from '../types/plot';
import type { TreeRecord } from '../types/tree';
import {
  RECEIPT_FORMAT,
  type ConflictChoice,
  type ReceiptBatch,
  type ReceiptFile,
  type ReceiptTreeRecord,
  type ReconcileItem,
  type ReconcileResult,
} from '../types/receipt';

/** 解析回执 JSON 文本，校验格式与必填字段 */
export function parseReceipt(text: string): { file?: ReceiptFile; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: '不是有效的 JSON 文件' };
  }
  if (!raw || typeof raw !== 'object') return { error: '回执内容为空' };
  const r = raw as Record<string, unknown>;
  if (r.format !== RECEIPT_FORMAT) {
    return { error: `回执格式标识不符（应为 ${RECEIPT_FORMAT}）` };
  }
  if (!Array.isArray(r.trees)) return { error: '回执缺少 trees 数组' };
  for (let i = 0; i < r.trees.length; i += 1) {
    const t = r.trees[i] as Record<string, unknown>;
    if (!t.plotNo || typeof t.plotNo !== 'string') return { error: `第 ${i + 1} 条记录缺少样地号` };
    if (typeof t.round !== 'number') return { error: `第 ${i + 1} 条记录缺少期次` };
    if (!t.treeNo || typeof t.treeNo !== 'string') return { error: `第 ${i + 1} 条记录缺少树号` };
    if (!t.species || typeof t.species !== 'string') return { error: `第 ${i + 1} 条记录缺少树种` };
    if (typeof t.dbhCm !== 'number' || t.dbhCm <= 0 || t.dbhCm > 200) {
      return { error: `第 ${i + 1} 条记录胸径无效` };
    }
    if (typeof t.heightM !== 'number' || t.heightM <= 0) {
      return { error: `第 ${i + 1} 条记录树高无效` };
    }
  }
  return { file: raw as ReceiptFile };
}

/** 计算批次指纹（内容哈希，挡住重复导入；导入时间等元数据不参与） */
export function computeFingerprint(file: ReceiptFile): string {
  const canonical = JSON.stringify(
    file.trees
      .map((t) => [
        t.plotNo,
        t.round,
        t.treeNo,
        t.species,
        t.dbhCm,
        t.heightM,
        t.underBranchH,
        t.crownWidth,
        t.status,
        t.origin,
        t.healthClass,
        t.tiltDeg,
        t.remark,
      ])
      .sort(
        (a, b) =>
          String(a[0]).localeCompare(String(b[0])) ||
          Number(a[1]) - Number(b[1]) ||
          String(a[2]).localeCompare(String(b[2]), 'zh-Hans-CN', { numeric: true }),
      ),
  );
  // 两次 djb2 累加，降低碰撞概率
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + ch) | 0;
    h2 = ((h2 << 5) + h2 + ch) | 0;
  }
  return `fp_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}_${canonical.length}`;
}

const IDENTITY_FIELDS = ['origin', 'healthClass'] as const;

/** 是否完全一致 */
function isIdentical(local: TreeRecord, rt: ReceiptTreeRecord): boolean {
  return (
    local.species === rt.species &&
    local.dbhCm === rt.dbhCm &&
    local.heightM === rt.heightM &&
    (rt.underBranchH === undefined || local.underBranchH === rt.underBranchH) &&
    (rt.crownWidth === undefined || local.crownWidth === rt.crownWidth) &&
    (rt.status === undefined || local.status === rt.status) &&
    (rt.origin === undefined || local.origin === rt.origin) &&
    (rt.healthClass === undefined || local.healthClass === rt.healthClass) &&
    (rt.tiltDeg === undefined || local.tiltDeg === rt.tiltDeg)
  );
}

/**
 * 差异是否明确（可自动合入）：
 * 树种一致（同一性），身份字段无冲突，胸径合理且缩水不超过 15%。
 * 树种不符或胸径异常缩水 → 双方值不同，需人工选择。
 */
function isClearDifference(local: TreeRecord, rt: ReceiptTreeRecord): boolean {
  if (local.species !== rt.species) return false;
  for (const f of IDENTITY_FIELDS) {
    if (rt[f] !== undefined && local[f] !== rt[f]) return false;
  }
  if (!rt.dbhCm || rt.dbhCm <= 0 || rt.dbhCm > 200) return false;
  if (local.dbhCm > 0 && rt.dbhCm < local.dbhCm * 0.85) return false;
  return true;
}

/** 对账：按样地号+期次+树号匹配，分类预检 */
export function reconcile(file: ReceiptFile, plots: Plot[], trees: TreeRecord[]): ReconcileResult {
  const items: ReconcileItem[] = [];
  const localOnly: TreeRecord[] = [];
  const affectedPlotIds = new Set<string>();

  const plotByNo = new Map<string, Plot>();
  plots.forEach((p) => plotByNo.set(p.plotNo, p));

  const receiptKeys = new Set<string>();
  const coveredPlotNos = new Set<string>();

  for (const rt of file.trees) {
    const key = `${rt.plotNo}__${rt.round}__${rt.treeNo}`;
    receiptKeys.add(key);
    coveredPlotNos.add(rt.plotNo);
    const plot = plotByNo.get(rt.plotNo);
    if (!plot) {
      items.push({ kind: 'unmatchedPlot', receipt: rt });
      continue;
    }
    const matches = trees.filter(
      (t) => t.plotId === plot.id && t.round === rt.round && t.treeNo === rt.treeNo,
    );
    affectedPlotIds.add(plot.id);
    if (matches.length === 0) {
      items.push({ kind: 'receiptOnly', receipt: rt });
    } else if (matches.length === 1) {
      const local = matches[0];
      if (isIdentical(local, rt)) {
        items.push({ kind: 'identical', local, receipt: rt });
      } else if (isClearDifference(local, rt)) {
        items.push({ kind: 'autoMerge', local, receipt: rt });
      } else {
        items.push({ kind: 'conflict', local, receipt: rt, choice: 'local' });
      }
    } else {
      // 多条本地匹配（异常）→ 冲突
      items.push({ kind: 'conflict', local: matches[0], receipt: rt, choice: 'local' });
    }
  }

  // 本地多出的记录（不删）：仅统计回执覆盖样地内、无回执匹配的本地样木
  for (const t of trees) {
    const plot = plots.find((p) => p.id === t.plotId);
    if (!plot || !coveredPlotNos.has(plot.plotNo)) continue;
    const key = `${plot.plotNo}__${t.round}__${t.treeNo}`;
    if (!receiptKeys.has(key)) {
      localOnly.push(t);
    }
  }

  const counts = {
    identical: items.filter((i) => i.kind === 'identical').length,
    autoMerge: items.filter((i) => i.kind === 'autoMerge').length,
    conflict: items.filter((i) => i.kind === 'conflict').length,
    receiptOnly: items.filter((i) => i.kind === 'receiptOnly').length,
    unmatchedPlot: items.filter((i) => i.kind === 'unmatchedPlot').length,
    localOnly: localOnly.length,
  };

  return { items, localOnly, counts, affectedPlotIds: Array.from(affectedPlotIds) };
}

/** 回执字段 → 样木字段 */
function receiptFields(rt: ReceiptTreeRecord): Partial<TreeRecord> {
  return {
    species: rt.species,
    dbhCm: rt.dbhCm,
    heightM: rt.heightM,
    underBranchH: rt.underBranchH ?? 0,
    crownWidth: rt.crownWidth ?? 0,
    status: rt.status ?? '活立木',
    origin: rt.origin ?? '天然',
    healthClass: rt.healthClass ?? '健康',
    tiltDeg: rt.tiltDeg ?? 0,
    remark: rt.remark ?? '',
  };
}

/** 回执记录 → 新样木记录 */
function receiptToTree(
  rt: ReceiptTreeRecord,
  plotId: string,
  now: number,
  keepBothWithTreeNo?: string,
): TreeRecord {
  const treeNo = keepBothWithTreeNo ? `${rt.treeNo}（回执）` : rt.treeNo;
  return {
    id: newId('tree'),
    plotId,
    treeNo,
    species: rt.species,
    dbhCm: rt.dbhCm,
    heightM: rt.heightM,
    underBranchH: rt.underBranchH ?? 0,
    crownWidth: rt.crownWidth ?? 0,
    status: rt.status ?? '活立木',
    origin: rt.origin ?? '天然',
    healthClass: rt.healthClass ?? '健康',
    tiltDeg: rt.tiltDeg ?? 0,
    remark: rt.remark ?? '',
    round: rt.round,
    measuredAt: now,
    source: '检查回执',
  };
}

export interface MergeOutcome {
  failed: boolean;
  error?: string;
  /** 实际合入（更新+新增）的记录数 */
  mergedCount: number;
  /** 其中新增的记录数 */
  addedCount: number;
  /** 合入后需要同步到内存态的样木记录 */
  putRecords: TreeRecord[];
}

/**
 * 整批合入（事务性）：
 * - 唯一匹配且差异明确 → 用回执值更新本地
 * - 双方值不同 → 按人工选择（保留本地 / 采用回执 / 两份都留）
 * - 回执新增 → 新增记录
 * - 本地多出 → 不删除
 * 失败时事务回滚、原样保留，可重试。
 */
export async function mergeReceipt(
  file: ReceiptFile,
  result: ReconcileResult,
  plots: Plot[],
  batchMeta: Omit<ReceiptBatch, 'id' | 'importedAt' | 'mergedCount'>,
): Promise<MergeOutcome> {
  const now = Date.now();
  const toPut: TreeRecord[] = [];
  let addedCount = 0;

  for (const item of result.items) {
    if (item.kind === 'identical' || item.kind === 'unmatchedPlot') continue;
    const plot = plots.find((p) => p.plotNo === item.receipt.plotNo);
    if (!plot) continue;

    if (item.kind === 'receiptOnly') {
      toPut.push(receiptToTree(item.receipt, plot.id, now));
      addedCount += 1;
    } else if (item.kind === 'autoMerge' && item.local) {
      toPut.push({ ...item.local, ...receiptFields(item.receipt), measuredAt: now });
    } else if (item.kind === 'conflict' && item.local) {
      const choice: ConflictChoice = item.choice ?? 'local';
      if (choice === 'receipt') {
        toPut.push({ ...item.local, ...receiptFields(item.receipt), measuredAt: now });
      } else if (choice === 'both') {
        toPut.push(receiptToTree(item.receipt, plot.id, now, item.local.treeNo));
        addedCount += 1;
      }
      // choice === 'local' → 不动
    }
  }

  const mergedCount = toPut.length;
  const batch: ReceiptBatch = {
    ...batchMeta,
    id: newId('batch'),
    importedAt: now,
    mergedCount,
  };

  try {
    await db.transaction('rw', db.trees, db.rechecks, db.receipts, async () => {
      await db.trees.bulkPut(toPut);
      // 失效受影响样地的复查比对
      for (const plotId of result.affectedPlotIds) {
        await db.rechecks.where('plotId').equals(plotId).delete();
      }
      await db.receipts.put(batch);
    });
    // 事务成功后重算受影响样地的复查比对（最新两期）
    for (const plotId of result.affectedPlotIds) {
      try {
        await recomputePlotRechecks(plotId);
      } catch {
        /* 重算失败不影响合入结果，下次进入复查页会重新生成 */
      }
    }
    return { failed: false, mergedCount, addedCount, putRecords: toPut };
  } catch (e) {
    // 失败原样保留（Dexie 事务自动回滚），可重试
    return { failed: true, error: e instanceof Error ? e.message : String(e), mergedCount: 0, addedCount: 0, putRecords: [] };
  }
}

/** 生成示例回执（基于现有示范数据，便于演示对账流程） */
export function buildSampleReceipt(plots: Plot[], trees: TreeRecord[]): ReceiptFile {
  const plot = plots[0];
  const treesForPlot = plot
    ? trees
        .filter((t) => t.plotId === plot.id)
        .map((t) => ({
          plotNo: plot.plotNo,
          round: t.round,
          treeNo: t.treeNo,
          species: t.species,
          dbhCm: Math.round((t.dbhCm + 0.6) * 10) / 10,
          heightM: Math.round((t.heightM + 0.4) * 10) / 10,
          underBranchH: t.underBranchH,
          crownWidth: t.crownWidth,
          status: t.status,
          origin: t.origin,
          healthClass: t.healthClass,
          tiltDeg: t.tiltDeg,
          remark: t.remark,
          treeNoSource: '原始记录',
        }))
    : [];
  return {
    format: RECEIPT_FORMAT,
    version: 1,
    batchNo: `RECEIPT-${new Date().getFullYear()}-DEMO`,
    source: '县连续清查系统（示例）',
    issuedAt: Date.now(),
    trees: treesForPlot,
  };
}

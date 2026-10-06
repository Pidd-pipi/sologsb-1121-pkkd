import { db } from './db';
import { newId } from './id';
import { batchFingerprint, reconcile } from './reconcile';
import { buildRecheckDiffs } from './recheck';
import type { Plot } from '../types/plot';
import type { TreeRecord } from '../types/tree';
import type { RecheckDiff } from '../types/recheck';
import type {
  ImportBatch,
  Receipt,
  ReceiptTree,
  Resolution,
  StagingRow,
} from '../types/receipt';

export class ReceiptError extends Error {}

/** 解析回执文本：兼容 {trees:[...]} 包裹格式与纯数组 */
export function parseReceipt(text: string): Receipt {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReceiptError('回执不是合法的 JSON，请检查文件内容');
  }
  const isWrapped = data !== null && typeof data === 'object' && !Array.isArray(data);
  const rawTrees: unknown[] = Array.isArray(data)
    ? data
    : isWrapped && Array.isArray((data as { trees?: unknown }).trees)
      ? ((data as { trees: unknown[] }).trees)
      : [];
  if (rawTrees.length === 0) {
    throw new ReceiptError('回执缺少 trees 样木清单');
  }
  const trees = rawTrees.map(normalizeTree).filter((t): t is ReceiptTree => t !== null);
  if (trees.length === 0) throw new ReceiptError('回执中没有可用的样木记录');

  const meta = isWrapped ? (data as Partial<Receipt>) : {};
  return {
    batchId: meta.batchId ? String(meta.batchId) : '',
    source: meta.source ? String(meta.source) : '',
    exportedAt: typeof meta.exportedAt === 'number' ? meta.exportedAt : undefined,
    trees,
  };
}

function normalizeTree(raw: unknown): ReceiptTree | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const plotNo = String(r.plotNo ?? r.plotCode ?? r['样地号'] ?? '').trim();
  const round = Number(r.round ?? r.surveyRound ?? r['期次']);
  if (!plotNo || !Number.isFinite(round)) return null;
  return {
    plotNo,
    round,
    treeNo: r.treeNo === undefined || r.treeNo === null ? undefined : String(r.treeNo),
    species: optStr(r.species ?? r['树种']),
    dbhCm: optNum(r.dbhCm ?? r.dbh ?? r['胸径']),
    heightM: optNum(r.heightM ?? r.height ?? r['树高']),
    underBranchH: optNum(r.underBranchH ?? r['枝下高']),
    crownWidth: optNum(r.crownWidth ?? r['冠幅']),
    status: optStr(r.status ?? r['状态']) as ReceiptTree['status'],
    origin: optStr(r.origin ?? r['起源']) as ReceiptTree['origin'],
    healthClass: optStr(r.healthClass ?? r['健康等级']) as ReceiptTree['healthClass'],
    tiltDeg: optNum(r.tiltDeg ?? r['倾斜度']),
    remark: optStr(r.remark ?? r['备注']),
    measuredAt: typeof r.measuredAt === 'number' ? r.measuredAt : undefined,
  };
}

function optStr(v: unknown): string | undefined {
  return v === undefined || v === null || v === '' ? undefined : String(v);
}
function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 按指纹查批次：已合入的挡重复；预检/失败中的复用原对账单 */
async function findByFingerprint(
  fingerprint: string,
): Promise<{ committed?: ImportBatch; reusable?: ImportBatch }> {
  const hits = await db.batches.where('fingerprint').equals(fingerprint).toArray();
  return {
    committed: hits.find((b) => b.state === 'committed'),
    reusable: hits.find((b) => b.state !== 'committed'),
  };
}

export interface PreviewResult {
  batch: ImportBatch;
  staging: StagingRow[];
  duplicated: boolean;
}

/** 预检：算指纹 → 查重 → 对账分类，整批落入 staging，等待人工确认 */
export async function previewReceipt(
  receipt: Receipt,
  plots: Plot[],
  trees: TreeRecord[],
): Promise<PreviewResult> {
  const fingerprint = batchFingerprint(receipt.trees, receipt.batchId ?? '');
  const found = await findByFingerprint(fingerprint);
  if (found.committed) {
    return { batch: found.committed, staging: [], duplicated: true };
  }
  if (found.reusable) {
    // 同份回执已在预检/失败中：复用原批次与对账单，不重复建批
    const rows = await loadStaging(found.reusable.id);
    return { batch: found.reusable, staging: rows, duplicated: false };
  }

  const batchId = newId('batch');
  const staging = reconcile({ batchId, plots, trees, rows: receipt.trees });
  const plotNos = Array.from(new Set(receipt.trees.map((t) => t.plotNo))).sort();
  const rounds = Array.from(new Set(receipt.trees.map((t) => Number(t.round)))).sort((a, b) => a - b);
  const batch: ImportBatch = {
    id: batchId,
    sourceBatchId: receipt.batchId ?? '',
    fingerprint,
    source: receipt.source ?? (receipt.batchId ? `回执批次 ${receipt.batchId}` : '未标注来源回执'),
    exportedAt: receipt.exportedAt,
    state: 'preview',
    treeCount: receipt.trees.length,
    plotNos,
    rounds,
    legacyNoTreeNo: receipt.trees.filter((t) => !String(t.treeNo ?? '').trim()).length,
    lastError: '',
    createdAt: Date.now(),
  };
  await db.transaction('rw', db.batches, db.staging, async () => {
    await db.batches.put(batch);
    await db.staging.bulkPut(staging);
  });
  return { batch, staging, duplicated: false };
}

export async function listBatches(): Promise<ImportBatch[]> {
  return db.batches.orderBy('createdAt').reverse().toArray();
}

export async function loadStaging(batchId: string): Promise<StagingRow[]> {
  const rows = await db.staging.where('batchId').equals(batchId).toArray();
  return rows.sort((a, b) =>
    a.plotNo.localeCompare(b.plotNo) ||
    a.round - b.round ||
    a.treeNo.localeCompare(b.treeNo, 'zh-Hans-CN', { numeric: true }),
  );
}

export function unresolvedRows(rows: StagingRow[]): StagingRow[] {
  return rows.filter((r) => r.resolution === 'pending');
}

export function setResolution(rows: StagingRow[], id: string, resolution: Resolution): StagingRow[] {
  return rows.map((r) => (r.id === id ? { ...r, resolution } : r));
}

/** 人工选择即时落库：合入失败、批次重开后仍可按原选择重试 */
export async function persistResolution(rowId: string, resolution: Resolution): Promise<void> {
  await db.staging.update(rowId, { resolution });
}

const BASE_TREE_FIELDS = {
  origin: '天然' as const,
  healthClass: '健康' as const,
  tiltDeg: 0,
  underBranchH: 0,
  crownWidth: 0,
  remark: '',
  status: '活立木' as const,
  species: '',
  heightM: 0,
  dbhCm: 0,
};

function mergeRemote(local: TreeRecord | undefined, row: StagingRow): Omit<TreeRecord, 'id'> {
  const r = row.remote;
  const base = local
    ? { ...local }
    : {
        ...BASE_TREE_FIELDS,
        plotId: row.plotId,
        treeNo: row.treeNo,
        round: row.round,
        measuredAt: r.measuredAt ?? Date.now(),
      };
  return {
    plotId: row.plotId,
    treeNo: row.treeNo || base.treeNo,
    round: row.round,
    species: r.species ?? base.species,
    dbhCm: r.dbhCm ?? base.dbhCm,
    heightM: r.heightM ?? base.heightM,
    underBranchH: r.underBranchH ?? base.underBranchH,
    crownWidth: r.crownWidth ?? base.crownWidth,
    status: r.status ?? base.status,
    origin: r.origin ?? base.origin,
    healthClass: r.healthClass ?? base.healthClass,
    tiltDeg: r.tiltDeg ?? base.tiltDeg,
    remark: r.remark ?? base.remark,
    measuredAt: r.measuredAt ?? base.measuredAt ?? Date.now(),
  };
}

export interface CommitResult {
  updated: number;
  inserted: number;
  kept: number;
  skipped: number;
  recomputed: number;
  invalidatedPlotIds: string[];
}

/**
 * 确认后整批合入：单个 IndexedDB 事务内完成样木写入 + 复查比对失效重算。
 * 任何一步抛错，事务整体回滚，staging 与批次原样保留，可修正后重试。
 */
export async function commitBatch(
  batch: ImportBatch,
  rows: StagingRow[],
  currentTrees: TreeRecord[],
): Promise<CommitResult> {
  const pending = unresolvedRows(rows);
  if (pending.length > 0) {
    throw new ReceiptError(`还有 ${pending.length} 条冲突/新增未做人工选择，不能合入`);
  }

  const affected = new Map<string, Set<number>>();
  let updated = 0;
  let inserted = 0;
  let kept = 0;
  let skipped = 0;
  let recomputed = 0;
  let invalidatedPlotIds: string[] = [];
  const toPut: TreeRecord[] = [];

  try {
    const missingPlot = rows.filter(
      (r) => r.resolution !== 'skip' && !r.plotId && r.remoteIndex >= 0,
    );
    if (missingPlot.length > 0) {
      throw new ReceiptError(
        `回执含 ${missingPlot.length} 条本地不存在的样地号，请先在样地台账建档`,
      );
    }

    rows.forEach((row) => {
      const local = row.localRecordId
        ? currentTrees.find((t) => t.id === row.localRecordId)
        : undefined;

      // 唯一匹配且值一致（含旧备份模糊核对一致）：预检通过，无需重写
      if (row.status === 'equal') {
        kept += 1;
        return;
      }
      if (row.status === 'local_only' || row.resolution === 'keep_local') {
        // 本地多出的记录不删；冲突选择保留本地同样不动
        kept += 1;
        return;
      }
      if (row.resolution === 'skip' || !row.plotId) {
        skipped += 1;
        return;
      }

      if (row.resolution === 'insert_new') {
        toPut.push({
          id: newId('tree'),
          ...mergeRemote(undefined, row),
          treeNo: row.treeNo || nextTreeNo(currentTrees, row.plotId, row.round, toPut),
        });
        inserted += 1;
        markAffected(affected, row.plotId, row.round);
        return;
      }

      // use_remote
      if (local) {
        toPut.push({ id: local.id, ...mergeRemote(local, row) });
        updated += 1;
      } else {
        toPut.push({ id: newId('tree'), ...mergeRemote(undefined, row) });
        inserted += 1;
      }
      markAffected(affected, row.plotId, row.round);
    });

    invalidatedPlotIds = Array.from(affected.keys());

    await db.transaction(
      'rw',
      db.trees,
      db.rechecks,
      db.batches,
      db.staging,
      async () => {
        if (toPut.length > 0) await db.trees.bulkPut(toPut);

        const allTrees = await db.trees.toArray();
        for (const [plotId, roundSet] of affected) {
          const rounds = Array.from(roundSet).sort((a, b) => a - b);
          const existing = await db.rechecks.where('plotId').equals(plotId).toArray();
          // 受影响期次参与的所有比对立即失效，并用新数据重算（保留人工选择的期次对）
          const pairs = new Map<string, { base: number; target: number }>();
          existing.forEach((d) => {
            if (rounds.includes(d.baseRound) || rounds.includes(d.targetRound)) {
              const key = `${Math.min(d.baseRound, d.targetRound)}>${Math.max(d.baseRound, d.targetRound)}`;
              pairs.set(key, {
                base: Math.min(d.baseRound, d.targetRound),
                target: Math.max(d.baseRound, d.targetRound),
              });
            }
          });
          // 若该样地本期受影响但从未保存过比对，也顺手重算上一期→本期
          if (pairs.size === 0) {
            const plotRounds = Array.from(
              new Set(allTrees.filter((t) => t.plotId === plotId).map((t) => t.round)),
            ).sort((a, b) => a - b);
            rounds.forEach((r) => {
              const idx = plotRounds.indexOf(r);
              if (idx > 0) pairs.set(`${plotRounds[idx - 1]}>${r}`, { base: plotRounds[idx - 1], target: r });
            });
          }
          if (pairs.size === 0) continue;

          const stale = existing.filter(
            (d) => rounds.includes(d.baseRound) || rounds.includes(d.targetRound),
          );
          if (stale.length > 0) {
            // 受影响的复查比对立即失效
            await db.rechecks.bulkPut(stale.map((d) => ({ ...d, stale: true })));
            await db.rechecks.bulkDelete(stale.map((d) => d.id));
          }
          const fresh: RecheckDiff[] = [];
          pairs.forEach(({ base, target }) => {
            fresh.push(...buildRecheckDiffs(plotId, base, target, allTrees));
          });
          if (fresh.length > 0) await db.rechecks.bulkPut(fresh);
          recomputed += fresh.length;
        }

        await db.batches.update(batch.id, {
          state: 'committed',
          committedAt: Date.now(),
          lastError: '',
        });
        // 合入成功后清掉本批暂存
        const stageIds = rows.map((r) => r.id);
        if (stageIds.length > 0) await db.staging.bulkDelete(stageIds);
      },
    );
  } catch (err) {
    // 原样保留批次与暂存，记录失败原因，允许重试
    const message = err instanceof Error ? err.message : String(err);
    await db.batches.update(batch.id, { state: 'failed', lastError: message });
    throw new ReceiptError(message);
  }

  return { updated, inserted, kept, skipped, recomputed, invalidatedPlotIds };
}

function markAffected(affected: Map<string, Set<number>>, plotId: string, round: number): void {
  if (!affected.has(plotId)) affected.set(plotId, new Set<number>());
  affected.get(plotId)!.add(round);
}

function nextTreeNo(
  current: TreeRecord[],
  plotId: string,
  round: number,
  pending: TreeRecord[],
): string {
  const used = new Set(
    [...current, ...pending]
      .filter((t) => t.plotId === plotId && t.round === round)
      .map((t) => Number(t.treeNo))
      .filter((n) => Number.isFinite(n)),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return String(n);
}

/** 放弃预检批次（仅 preview/failed 可弃），清理暂存 */
export async function discardBatch(batchId: string): Promise<void> {
  await db.transaction('rw', db.batches, db.staging, async () => {
    await db.staging.where('batchId').equals(batchId).delete();
    await db.batches.delete(batchId);
  });
}

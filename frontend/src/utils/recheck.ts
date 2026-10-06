import { db } from './db';
import { newId } from './id';
import type { TreeRecord } from '../types/tree';
import type { RecheckDiff } from '../types/recheck';

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 生成两期逐株比对表（按树号匹配，标记缺失与状态变化） */
export function buildRecheckDiffs(
  plotId: string,
  baseRound: number,
  targetRound: number,
  trees: TreeRecord[],
): RecheckDiff[] {
  const baseList = trees.filter((t) => t.plotId === plotId && t.round === baseRound);
  const targetList = trees.filter((t) => t.plotId === plotId && t.round === targetRound);
  const baseMap = new Map<string, TreeRecord>();
  baseList.forEach((t) => baseMap.set(t.treeNo, t));
  const targetMap = new Map<string, TreeRecord>();
  targetList.forEach((t) => targetMap.set(t.treeNo, t));
  const allNos = Array.from(new Set([...baseMap.keys(), ...targetMap.keys()])).sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true }),
  );

  return allNos.map((treeNo) => {
    const b = baseMap.get(treeNo);
    const t = targetMap.get(treeNo);
    const baseDbh = b?.dbhCm;
    const targetDbh = t?.dbhCm;
    const dbhGrowth = baseDbh !== undefined && targetDbh !== undefined ? r2(targetDbh - baseDbh) : 0;
    const heightGrowth = b && t ? r2(t.heightM - b.heightM) : 0;
    const statusChange = b && t && b.status !== t.status ? `${b.status} → ${t.status}` : '';
    const missingReason = !t
      ? '本期未复测（疑似采伐或倒伏）'
      : !b
        ? '本期新增进界木'
        : '';
    return {
      id: newId('diff'),
      plotId,
      baseRound,
      targetRound,
      treeNo,
      species: t?.species ?? b?.species ?? '',
      baseDbhCm: baseDbh,
      targetDbhCm: targetDbh,
      baseHeightM: b?.heightM,
      targetHeightM: t?.heightM,
      dbhGrowth,
      heightGrowth,
      statusChange,
      missingReason,
      generatedAt: Date.now(),
    };
  });
}

/** 删除某样地的全部复查比对结果 */
export async function deletePlotRechecks(plotId: string): Promise<void> {
  await db.rechecks.where('plotId').equals(plotId).delete();
}

/**
 * 重算某样地的复查比对：先删除旧结果，再基于最新样木数据重算。
 * 优先重算已保存的期次对（保留用户选择的上期/本期）；若没有已保存的比对，则重算最新两期。
 * 用于检查回执合入后让受影响的复查比对立即失效重算。
 */
export async function recomputePlotRechecks(plotId: string): Promise<void> {
  const trees = await db.trees.where('plotId').equals(plotId).toArray();
  const existing = await db.rechecks.where('plotId').equals(plotId).toArray();
  const rounds = Array.from(new Set(trees.map((t) => t.round))).sort((a, b) => a - b);
  await deletePlotRechecks(plotId);

  const pairs: Array<[number, number]> = [];
  if (existing.length > 0) {
    const seen = new Set<string>();
    existing.forEach((d) => {
      const key = `${d.baseRound}-${d.targetRound}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([d.baseRound, d.targetRound]);
      }
    });
  } else if (rounds.length >= 2) {
    pairs.push([rounds[rounds.length - 2], rounds[rounds.length - 1]]);
  }

  const validRounds = new Set(rounds);
  for (const [baseRound, targetRound] of pairs) {
    if (!validRounds.has(baseRound) || !validRounds.has(targetRound)) continue;
    const diffs = buildRecheckDiffs(plotId, baseRound, targetRound, trees);
    await db.rechecks.bulkPut(diffs);
  }
}

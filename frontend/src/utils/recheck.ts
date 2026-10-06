import type { TreeRecord } from '../types/tree';
import type { RecheckDiff } from '../types/recheck';
import { newId } from './id';

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 由两期样木清单生成逐株比对表。
 * RecheckView 页面与回执合入后的失效重算共用，保证汇总/导出口径一致。
 */
export function buildRecheckDiffs(
  plotId: string,
  baseRound: number,
  targetRound: number,
  allTrees: TreeRecord[],
  generatedAt = Date.now(),
): RecheckDiff[] {
  const baseList = allTrees.filter((t) => t.plotId === plotId && t.round === baseRound);
  const targetList = allTrees.filter((t) => t.plotId === plotId && t.round === targetRound);
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
    const missingReason = !t ? '本期未复测（疑似采伐或倒伏）' : !b ? '本期新增进界木' : '';
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
      generatedAt,
    };
  });
}

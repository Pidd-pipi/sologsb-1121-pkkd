/** 复查逐株比对结果 */
export interface RecheckDiff {
  id: string;
  plotId: string;
  /** 上期期次 */
  baseRound: number;
  /** 本期期次 */
  targetRound: number;
  treeNo: string;
  species: string;
  /** 上期胸径 cm（缺失期留空） */
  baseDbhCm?: number;
  /** 本期胸径 cm */
  targetDbhCm?: number;
  /** 上期树高 m */
  baseHeightM?: number;
  /** 本期树高 m */
  targetHeightM?: number;
  /** 胸径生长量 cm */
  dbhGrowth: number;
  /** 树高生长量 m */
  heightGrowth: number;
  /** 状态变化描述 */
  statusChange: string;
  /** 无法匹配时的缺失原因 */
  missingReason: string;
  generatedAt: number;
}

export type RecheckDiffDraft = Omit<RecheckDiff, 'id' | 'generatedAt'>;

/** 保留木生长率：生长量 / 上期胸径 */
export function growthRate(diff: RecheckDiff): number {
  if (!diff.baseDbhCm || diff.baseDbhCm <= 0) return 0;
  return Math.round((diff.dbhGrowth / diff.baseDbhCm) * 10000) / 100;
}

/** 是否异常：生长量为负或缺测 */
export function isDiffAbnormal(diff: RecheckDiff): boolean {
  return diff.dbhGrowth < 0 || diff.heightGrowth < 0 || !diff.targetDbhCm;
}

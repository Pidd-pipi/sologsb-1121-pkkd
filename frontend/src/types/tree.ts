/** 样木状态 */
export type TreeStatus = '活立木' | '枯立木' | '倒木' | '采伐';

export const TREE_STATUSES: TreeStatus[] = ['活立木', '枯立木', '倒木', '采伐'];

/** 起源 */
export type TreeOrigin = '天然' | '人工';

export const TREE_ORIGINS: TreeOrigin[] = ['天然', '人工'];

/** 健康等级 */
export type HealthClass = '健康' | '亚健康' | '不健康';

export const HEALTH_CLASSES: HealthClass[] = ['健康', '亚健康', '不健康'];

/** 样木记录（按复查期次分行，便于逐株比对） */
export interface TreeRecord {
  id: string;
  plotId: string;
  /** 树号 */
  treeNo: string;
  species: string;
  /** 胸径 cm */
  dbhCm: number;
  /** 树高 m */
  heightM: number;
  /** 枝下高 m */
  underBranchH: number;
  /** 冠幅 m */
  crownWidth: number;
  status: TreeStatus;
  origin: TreeOrigin;
  healthClass: HealthClass;
  /** 倾斜度 ° */
  tiltDeg: number;
  /** 位置描述 */
  remark: string;
  /** 所属复查期次 */
  round: number;
  measuredAt: number;
}

export type TreeRecordDraft = Omit<TreeRecord, 'id' | 'measuredAt'>;

/** 胸径是否异常（相对同树种同径阶偏离过大或数值不合理） */
export function isDbhAbnormal(tree: TreeRecord, peers: TreeRecord[]): boolean {
  if (!Number.isFinite(tree.dbhCm) || tree.dbhCm <= 0 || tree.dbhCm > 200) return true;
  const sameSpecies = peers.filter((p) => p.species === tree.species && p.round === tree.round);
  if (sameSpecies.length < 3) return false;
  const avg = sameSpecies.reduce((s, p) => s + p.dbhCm, 0) / sameSpecies.length;
  return Math.abs(tree.dbhCm - avg) / avg > 0.6;
}

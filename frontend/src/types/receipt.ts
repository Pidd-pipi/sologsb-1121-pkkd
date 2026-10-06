import type { HealthClass, TreeOrigin, TreeStatus } from './tree';

/** 检查回执文件格式标识 */
export const RECEIPT_FORMAT = 'gbforestplot-receipt';
export const RECEIPT_VERSION = 1;

/** 检查回执（县里连续清查系统回传的样木核查数据，按样地号+期次+树号对账，不整库覆盖） */
export interface ReceiptFile {
  format: typeof RECEIPT_FORMAT;
  version: number;
  /** 批次号（回执自带，用于展示） */
  batchNo?: string;
  /** 回执来源，如「县连续清查系统」 */
  source?: string;
  /** 回执出具时间 */
  issuedAt?: number;
  trees: ReceiptTreeRecord[];
}

/** 检查回执中的单条样木记录 */
export interface ReceiptTreeRecord {
  /** 样地号（对账键之一） */
  plotNo: string;
  /** 期次（对账键之一） */
  round: number;
  /** 树号（对账键之一） */
  treeNo: string;
  species: string;
  dbhCm: number;
  heightM: number;
  underBranchH?: number;
  crownWidth?: number;
  status?: TreeStatus;
  origin?: TreeOrigin;
  healthClass?: HealthClass;
  tiltDeg?: number;
  remark?: string;
  /** 树号来源（旧备份可能缺失，缺失不影响对账） */
  treeNoSource?: string;
}

/** 已导入的回执批次（批次指纹用于挡住重复导入） */
export interface ReceiptBatch {
  id: string;
  /** 批次指纹（内容哈希） */
  fingerprint: string;
  batchNo: string;
  source: string;
  issuedAt: number;
  importedAt: number;
  /** 回执覆盖的样地号 */
  plotNos: string[];
  recordCount: number;
  /** 本次合入的记录数 */
  mergedCount: number;
}

/** 对账分类 */
export type ReconcileKind =
  | 'identical' // 完全一致
  | 'autoMerge' // 唯一匹配且差异明确 → 用回执值
  | 'conflict' // 双方值不同 → 保留两份等人工选择
  | 'receiptOnly' // 回执新增（本地无匹配）
  | 'unmatchedPlot'; // 回执样地号在本地不存在

export const RECONCILE_KIND_LABELS: Record<ReconcileKind, string> = {
  identical: '完全一致',
  autoMerge: '差异明确·可自动合入',
  conflict: '双方值不同·待人工选择',
  receiptOnly: '回执新增',
  unmatchedPlot: '样地未匹配',
};

/** 冲突时的人工选择 */
export type ConflictChoice = 'local' | 'receipt' | 'both';

export const CONFLICT_CHOICE_LABELS: Record<ConflictChoice, string> = {
  local: '保留本地',
  receipt: '采用回执',
  both: '两份都留',
};

export interface ReconcileItem {
  kind: ReconcileKind;
  local?: import('./tree').TreeRecord;
  receipt: ReceiptTreeRecord;
  /** 冲突时的人工选择 */
  choice?: ConflictChoice;
}

export interface ReconcileResult {
  items: ReconcileItem[];
  /** 本地多出、不删除的记录 */
  localOnly: import('./tree').TreeRecord[];
  counts: Record<ReconcileKind, number> & { localOnly: number };
  /** 受影响的样地 id（复查比对失效重算） */
  affectedPlotIds: string[];
}

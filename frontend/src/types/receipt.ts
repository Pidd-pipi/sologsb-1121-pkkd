import type { HealthClass, TreeOrigin, TreeStatus } from './tree';

/** 回执里的一株样木（县清查系统下发格式） */
export interface ReceiptTree {
  plotNo: string;
  round: number;
  treeNo?: string;
  species?: string;
  dbhCm?: number;
  heightM?: number;
  underBranchH?: number;
  crownWidth?: number;
  status?: TreeStatus;
  origin?: TreeOrigin;
  healthClass?: HealthClass;
  tiltDeg?: number;
  remark?: string;
  measuredAt?: number;
}

/** 一份清查检查回执 */
export interface Receipt {
  batchId?: string;
  source?: string;
  exportedAt?: number;
  trees: ReceiptTree[];
}

/** 对账单行状态 */
export type ReconStatus = 'equal' | 'conflict' | 'local_only' | 'remote_only';

/** 冲突行的人工选择 */
export type Resolution = 'pending' | 'keep_local' | 'use_remote' | 'insert_new' | 'skip';

/** 批次处理状态 */
export type BatchState = 'preview' | 'committed' | 'failed';

/** 批次指纹记录（同一回执重复导入拦截） */
export interface ImportBatch {
  id: string;
  /** 回执自带批次号（可空） */
  sourceBatchId: string;
  /** 归一化内容指纹，同指纹已合入的批次直接挡回 */
  fingerprint: string;
  source: string;
  exportedAt?: number;
  state: BatchState;
  treeCount: number;
  plotNos: string[];
  rounds: number[];
  /** 旧备份缺树号行的数量 */
  legacyNoTreeNo: number;
  lastError: string;
  createdAt: number;
  committedAt?: number;
}

/** 预检后的对账单行（暂存） */
export interface StagingRow {
  id: string;
  batchId: string;
  plotNo: string;
  plotId: string;
  round: number;
  treeNo: string;
  status: ReconStatus;
  resolution: Resolution;
  /** 旧备份缺树号，按树种/胸径/树高模糊核对 */
  fuzzyMatched: boolean;
  note: string;
  /** 参与比对的字段名 */
  diffFields: string[];
  /** 本地值（本地独有 / 冲突时有值） */
  local?: ReceiptTree;
  localRecordId?: string;
  /** 回执值 */
  remote: ReceiptTree;
  remoteIndex: number;
  createdAt: number;
}

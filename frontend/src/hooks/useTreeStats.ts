import { useMemo } from 'react';
import { usePlotStore } from '../stores/plotStore';
import { useRegenStore } from '../stores/regenStore';
import { useTreeStore } from '../stores/treeStore';
import {
  avgDbh,
  avgHeight,
  basalAreaPerHectare,
  diameterDistribution,
  perHectareCount,
  regenDensity,
  totalBasalArea,
} from '../utils/forestCalc';

export interface TreeStats {
  /** 已录样木株数（本期） */
  count: number;
  aliveCount: number;
  /** 每公顷株数 */
  perHa: number;
  /** 平均胸径 cm */
  meanDbh: number;
  /** 平均树高 m */
  meanHeight: number;
  /** 断面积合计 m² */
  basalArea: number;
  /** 每公顷断面积 m²/hm² */
  basalAreaPerHa: number;
  /** 径阶分布 */
  diameterDist: { label: string; count: number }[];
  /** 更新密度 株/hm² */
  regenPerHa: number;
  /** 灌木密度 株/hm² */
  shrubPerHa: number;
  trees: ReturnType<typeof useTreeStore.getState>['items'];
}

/**
 * 算每公顷株数、平均胸径、断面积与径阶分布。
 * 被林分因子汇总页（/summary/:plotId）与复查比对页消费。
 */
export function useTreeStats(plotId: string | undefined, round?: number): TreeStats {
  const plots = usePlotStore((s) => s.items);
  const allTrees = useTreeStore((s) => s.items);
  const regens = useRegenStore((s) => s.items);

  const plot = plots.find((p) => p.id === plotId);
  const targetRound = round ?? plot?.surveyRound ?? 1;

  return useMemo<TreeStats>(() => {
    const trees = allTrees
      .filter((t) => t.plotId === plotId && t.round === targetRound)
      .sort((a, b) => a.treeNo.localeCompare(b.treeNo, 'zh-Hans-CN', { numeric: true }));
    const alive = trees.filter((t) => t.status === '活立木');
    const area = plot?.area ?? 0;
    const plotRegens = regens.filter((r) => r.plotId === plotId && r.round === targetRound);

    return {
      count: trees.length,
      aliveCount: alive.length,
      perHa: perHectareCount(alive.length, area),
      meanDbh: avgDbh(trees),
      meanHeight: avgHeight(trees),
      basalArea: totalBasalArea(trees),
      basalAreaPerHa: basalAreaPerHectare(trees, area),
      diameterDist: diameterDistribution(trees),
      regenPerHa: plot ? regenDensity(plotRegens, plot, '更新苗') : 0,
      shrubPerHa: plot ? regenDensity(plotRegens, plot, '灌木') : 0,
      trees,
    };
  }, [allTrees, regens, plotId, targetRound, plot]);
}

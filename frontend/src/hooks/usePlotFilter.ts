import { useMemo, useState } from 'react';
import { usePlotStore } from '../stores/plotStore';
import type { Plot } from '../types/plot';

export interface PlotFilters {
  keyword: string;
  locality: string;
  forestType: string;
  round: number | 'all';
  canopyMin: number;
  canopyMax: number;
  sortBy: 'createdAt' | 'plotNo' | 'area';
}

export const DEFAULT_PLOT_FILTERS: PlotFilters = {
  keyword: '',
  locality: 'all',
  forestType: 'all',
  round: 'all',
  canopyMin: 0,
  canopyMax: 1,
  sortBy: 'createdAt',
};

/**
 * 按地点、林型、复查期次、郁闭度区间过滤样地。
 * 被样地台账（/plots）与林分因子汇总页（/summary/:plotId）消费。
 */
export function usePlotFilter(initial?: Partial<PlotFilters>) {
  const items = usePlotStore((s) => s.items);
  const loaded = usePlotStore((s) => s.loaded);
  const [filters, setFilters] = useState<PlotFilters>({ ...DEFAULT_PLOT_FILTERS, ...initial });

  const options = useMemo(
    () => ({
      localities: Array.from(new Set(items.map((it) => it.locality))).filter(Boolean),
      forestTypes: Array.from(new Set(items.map((it) => it.forestType))).filter(Boolean),
      rounds: Array.from(new Set(items.map((it) => it.surveyRound))).sort((a, b) => a - b),
    }),
    [items],
  );

  const result = useMemo<Plot[]>(() => {
    const kw = filters.keyword.trim().toLowerCase();
    const rows = items.filter((it) => {
      if (kw) {
        const hit =
          it.plotNo.toLowerCase().includes(kw) ||
          it.locality.toLowerCase().includes(kw) ||
          it.dominantSpecies.toLowerCase().includes(kw) ||
          it.crew.toLowerCase().includes(kw);
        if (!hit) return false;
      }
      if (filters.locality !== 'all' && it.locality !== filters.locality) return false;
      if (filters.forestType !== 'all' && it.forestType !== filters.forestType) return false;
      if (filters.round !== 'all' && it.surveyRound !== filters.round) return false;
      if (it.canopyDensity < filters.canopyMin || it.canopyDensity > filters.canopyMax) return false;
      return true;
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (filters.sortBy === 'plotNo') return a.plotNo.localeCompare(b.plotNo);
      if (filters.sortBy === 'area') return b.area - a.area;
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }, [items, filters]);

  const patch = (p: Partial<PlotFilters>) => setFilters((prev) => ({ ...prev, ...p }));

  return {
    filters,
    setFilters,
    patch,
    reset: () => setFilters(DEFAULT_PLOT_FILTERS),
    result,
    options,
    loaded,
  };
}

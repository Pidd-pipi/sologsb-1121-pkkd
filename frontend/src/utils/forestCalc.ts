import type { Plot } from '../types/plot';
import type { RegenShrub } from '../types/regen';
import type { TreeRecord } from '../types/tree';

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 单株断面积 m²（按胸径 cm） */
export function basalArea(dbhCm: number): number {
  const r = dbhCm / 100 / 2;
  return Math.PI * r * r;
}

/** 样地断面积合计 m² */
export function totalBasalArea(trees: TreeRecord[]): number {
  return round(
    trees.reduce((sum, t) => sum + (t.status === '活立木' ? basalArea(t.dbhCm) : 0), 0),
    4,
  );
}

/** 每公顷株数 */
export function perHectareCount(count: number, areaM2: number): number {
  if (areaM2 <= 0) return 0;
  return Math.round((count / areaM2) * 10000);
}

/** 每公顷断面积 m²/hm² */
export function basalAreaPerHectare(trees: TreeRecord[], areaM2: number): number {
  if (areaM2 <= 0) return 0;
  return round((totalBasalArea(trees) / areaM2) * 10000, 3);
}

/** 平均胸径 cm（只计活立木） */
export function avgDbh(trees: TreeRecord[]): number {
  const alive = trees.filter((t) => t.status === '活立木');
  if (alive.length === 0) return 0;
  return round(alive.reduce((s, t) => s + t.dbhCm, 0) / alive.length, 2);
}

/** 平均树高 m */
export function avgHeight(trees: TreeRecord[]): number {
  const alive = trees.filter((t) => t.status === '活立木');
  if (alive.length === 0) return 0;
  return round(alive.reduce((s, t) => s + t.heightM, 0) / alive.length, 2);
}

/** 径阶归组（6/8/12/16/20/24/28/32+，单位 cm） */
export const DIAMETER_CLASSES = [6, 8, 12, 16, 20, 24, 28, 32] as const;

export function diameterClass(dbhCm: number): number {
  for (const c of DIAMETER_CLASSES) {
    if (dbhCm < c + 2) return c;
  }
  return 32;
}

export function diameterClassLabel(dbhCm: number): string {
  const c = diameterClass(dbhCm);
  return c >= 32 ? '32+' : `${c - 2}~${c + 2}`;
}

/** 径阶分布 */
export function diameterDistribution(trees: TreeRecord[]): { label: string; count: number }[] {
  const map = new Map<string, number>();
  DIAMETER_CLASSES.forEach((c) => map.set(c >= 32 ? '32+' : `${c - 2}~${c + 2}`, 0));
  trees
    .filter((t) => t.status === '活立木')
    .forEach((t) => {
      const label = diameterClassLabel(t.dbhCm);
      map.set(label, (map.get(label) ?? 0) + 1);
    });
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
}

/** 形高（树高 / 胸径） */
export function formHeight(tree: TreeRecord): number {
  if (tree.dbhCm <= 0) return 0;
  return round(tree.heightM / (tree.dbhCm / 100), 2);
}

/** 郁闭度换算：由冠幅合计 / 样地面积，封顶 1 */
export function canopyFromCrown(trees: TreeRecord[], plot: Plot): number {
  if (plot.area <= 0) return 0;
  const crownArea = trees
    .filter((t) => t.status === '活立木')
    .reduce((sum, t) => sum + Math.PI * (t.crownWidth / 2) ** 2, 0);
  return Math.min(1, round(crownArea / plot.area, 3));
}

/** 更新密度（株/hm²） */
export function regenDensity(rows: RegenShrub[], plot: Plot, layer?: RegenShrub['layer']): number {
  const list = layer ? rows.filter((r) => r.layer === layer) : rows;
  const total = list.reduce((s, r) => s + r.count, 0);
  return perHectareCount(total, plot.area);
}

/** 按高度级统计株数 */
export const HEIGHT_CLASSES = [30, 50, 100, 150, 200] as const;

export function heightClassLabel(heightCm: number): string {
  if (heightCm < 30) return '<30cm';
  for (let i = 0; i < HEIGHT_CLASSES.length - 1; i += 1) {
    if (heightCm < HEIGHT_CLASSES[i + 1]) return `${HEIGHT_CLASSES[i]}~${HEIGHT_CLASSES[i + 1]}cm`;
  }
  return '>=200cm';
}

export function heightClassStats(rows: RegenShrub[]): { label: string; count: number }[] {
  const order = ['<30cm', '30~50cm', '50~100cm', '100~150cm', '150~200cm', '>=200cm'];
  const map = new Map<string, number>(order.map((k) => [k, 0]));
  rows.forEach((r) => {
    const label = heightClassLabel(r.heightCm);
    map.set(label, (map.get(label) ?? 0) + r.count);
  });
  return order.map((label) => ({ label, count: map.get(label) ?? 0 }));
}

import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { TreeRecord, TreeRecordDraft } from '../types/tree';

interface TreeState {
  items: TreeRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: TreeRecordDraft) => Promise<TreeRecord>;
  addMany: (drafts: TreeRecordDraft[]) => Promise<TreeRecord[]>;
  update: (id: string, patch: Partial<TreeRecord>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  byPlot: (plotId: string, round?: number) => TreeRecord[];
}

export const useTreeStore = create<TreeState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.trees.toArray();
    rows.sort((a, b) => a.round - b.round || a.treeNo.localeCompare(b.treeNo));
    set({ items: rows, loaded: true });
  },
  async add(draft) {
    const record: TreeRecord = { ...draft, id: newId('tree'), measuredAt: Date.now() };
    await db.trees.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async addMany(drafts) {
    const records: TreeRecord[] = drafts.map((d) => ({
      ...d,
      id: newId('tree'),
      measuredAt: Date.now(),
    }));
    await db.trees.bulkPut(records);
    set({ items: [...get().items, ...records] });
    return records;
  },
  async update(id, patch) {
    await db.trees.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.trees.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  byPlot(plotId, round) {
    return get()
      .items.filter((it) => it.plotId === plotId && (round === undefined || it.round === round))
      .sort((a, b) => a.treeNo.localeCompare(b.treeNo, 'zh-Hans-CN', { numeric: true }));
  },
}));

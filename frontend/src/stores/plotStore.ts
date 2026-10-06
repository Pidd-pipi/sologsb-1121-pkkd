import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { Plot, PlotDraft } from '../types/plot';

interface PlotState {
  items: Plot[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PlotDraft) => Promise<Plot>;
  update: (id: string, patch: Partial<Plot>) => Promise<void>;
  toggleLock: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const usePlotStore = create<PlotState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.plots.orderBy('createdAt').reverse().toArray();
    set({ items: rows, loaded: true });
  },
  async add(draft) {
    const record: Plot = { ...draft, id: newId('plot'), createdAt: Date.now() };
    await db.plots.put(record);
    set({ items: [record, ...get().items] });
    return record;
  },
  async update(id, patch) {
    await db.plots.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async toggleLock(id) {
    const target = get().items.find((it) => it.id === id);
    if (!target) return;
    await get().update(id, { locked: !target.locked });
  },
  async remove(id) {
    await db.plots.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
}));

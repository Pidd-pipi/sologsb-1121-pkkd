import { create } from 'zustand';
import { db } from '../utils/db';
import type { ReceiptBatch } from '../types/receipt';

interface ReceiptState {
  batches: ReceiptBatch[];
  loaded: boolean;
  load: () => Promise<void>;
  existsByFingerprint: (fp: string) => boolean;
}

export const useReceiptStore = create<ReceiptState>((set, get) => ({
  batches: [],
  loaded: false,
  async load() {
    const rows = await db.receipts.orderBy('importedAt').reverse().toArray();
    set({ batches: rows, loaded: true });
  },
  existsByFingerprint(fp) {
    return get().batches.some((b) => b.fingerprint === fp);
  },
}));

import { create } from 'zustand';

export interface ThreatUpdate {
  overall: number;
  categories: Record<string, number>;
  summary?: string;
}

export interface DefconUpdate {
  level: number; // 3 | 2 | 1 | 0
  direction: 'up' | 'down';
  overall?: number;
  from?: number;
}

interface RiskState {
  threat: ThreatUpdate | null;
  defconLevel: number; // 0 = ปกติ
  lastDefconChange: DefconUpdate | null;
  setThreat: (threat: ThreatUpdate) => void;
  setDefcon: (update: DefconUpdate) => void;
  seed: (threat: ThreatUpdate | null, defconLevel: number) => void;
}

// ค่าเริ่มต้น: ไม่มีข้อมูล — widget จะแสดง "—" และรอ socket/seed
export const useRiskStore = create<RiskState>((set) => ({
  threat: null,
  defconLevel: 0,
  lastDefconChange: null,

  setThreat: (threat) => set({ threat }),
  setDefcon: (update) =>
    set((state) => ({
      defconLevel: update.level,
      lastDefconChange: update,
      // ถ้า payload มี overall แนบมาด้วย (กรณีมาจาก check()) อัปเดต threat ให้ตรงด้วย
      threat: update.overall != null && state.threat ? { ...state.threat, overall: update.overall } : state.threat,
    })),
  seed: (threat, defconLevel) => set({ threat, defconLevel }),
}));

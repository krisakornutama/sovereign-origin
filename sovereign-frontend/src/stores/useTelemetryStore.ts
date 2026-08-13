import { create } from 'zustand';
import { TelemetryUpdate } from '../types';

interface NodeTelemetry {
  node_id: string;
  node_name?: string;
  battery_soc: number;
  power_kw: number;
  water_level_cm: number;
  last_update: number;
}

interface OnlineStatusMap {
  [node_id: string]: boolean;
}

interface TelemetryState {
  telemetry: Record<string, NodeTelemetry>;
  onlineStatus: OnlineStatusMap;
  addTelemetry: (data: TelemetryUpdate) => void;
  setOnlineStatus: (nodeId: string, online: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  telemetry: {},
  onlineStatus: {},

  addTelemetry: (data) =>
    set((state) => ({
      telemetry: {
        ...state.telemetry,
        [data.node_id]: {
          node_id: data.node_id,
          node_name: data.node_name || '',
          battery_soc: data.battery_soc ?? 0,
          power_kw: data.power_kw ?? 0,
          water_level_cm: data.water_level_cm ?? 0,
          last_update: Date.now(),
        },
      },
    })),

  setOnlineStatus: (nodeId, online) =>
    set((state) => ({
      onlineStatus: { ...state.onlineStatus, [nodeId]: online },
    })),
}));
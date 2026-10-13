import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// Soverien Types
// ============================================

export interface SoverienModel {
  id: string;
  name: string;
  prefix: string; // e.g., 'Soverien-Temp'
}

export interface SoverienSerial {
  serialNumber: string;
  modelId: string;
  modelName: string;
  createdAt: string; // ISO string
  status: 'available' | 'sold' | 'installed' | 'warranty' | 'expired';
  orderId?: string;
  customerId?: string;
  warrantyEnd?: string;
}

export interface SoverienOrder {
  id: string;
  serialNumbers: string[];
  modelId: string;
  modelName: string;
  quantity: number;
  customer: SoverienCustomer;
  status: 'pending' | 'confirmed' | 'installing' | 'installed' | 'completed' | 'cancelled';
  createdAt: string;
  installedAt?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  notes?: string;
  price?: number;
}

export interface SoverienCustomer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  lineId?: string;
  email?: string;
  notes?: string;
  createdAt: string;
  totalOrders: number;
  totalValue: number;
  lastOrderAt?: string;
}

export interface SoverienStickerTemplate {
  id: string;
  name: string;
  imageBase64: string;
  width: number; // mm
  height: number; // mm
  dpi: number;
  serialPosition: { x: number; y: number };
  serialFontSize: number;
  serialColor: string;
  warrantyPosition: { x: number; y: number };
  warrantyFontSize: number;
  warrantyColor: string;
  qrPosition?: { x: number; y: number };
  qrSize?: number;
}

export interface SoverienSettings {
  pin?: string;
  pinEnabled: boolean;
  lastSerialNumber: number;
  warrantyDays: number; // 365
  shippingBufferDays: number; // 14
  logoBase64?: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyLineId?: string;
}

export interface SoverienAlert {
  id: string;
  type: 'warranty_expiring' | 'warranty_expired' | 'order_overdue' | 'customer_inactive';
  title: string;
  message: string;
  orderId?: string;
  customerId?: string;
  serialNumber?: string;
  createdAt: string;
  read: boolean;
}

// ============================================
// Soverien Store
// ============================================

interface SoverienState {
  // Models
  models: SoverienModel[];
  addModel: (model: Omit<SoverienModel, 'id'>) => string;
  updateModel: (id: string, data: Partial<SoverienModel>) => void;
  deleteModel: (id: string) => void;

  // Serials
  serials: SoverienSerial[];
  generateSerials: (modelId: string, count: number) => string[];
  getNextSerial: (modelId: string) => string;
  getSerial: (serialNumber: string) => SoverienSerial | undefined;
  updateSerial: (serialNumber: string, data: Partial<SoverienSerial>) => void;

  // Orders
  orders: SoverienOrder[];
  createOrder: (order: Omit<SoverienOrder, 'id' | 'createdAt'>) => string;
  updateOrder: (id: string, data: Partial<SoverienOrder>) => void;
  getOrder: (id: string) => SoverienOrder | undefined;
  getOrdersByCustomer: (customerId: string) => SoverienOrder[];
  getOrdersBySerial: (serialNumber: string) => SoverienOrder[];

  // Customers
  customers: SoverienCustomer[];
  createCustomer: (customer: Omit<SoverienCustomer, 'id' | 'createdAt' | 'totalOrders' | 'totalValue' | 'lastOrderAt'>) => string;
  updateCustomer: (id: string, data: Partial<SoverienCustomer>) => void;
  getCustomer: (id: string) => SoverienCustomer | undefined;
  getCustomerByPhone: (phone: string) => SoverienCustomer | undefined;

  // Stickers
  stickerTemplates: SoverienStickerTemplate[];
  addStickerTemplate: (template: Omit<SoverienStickerTemplate, 'id'>) => string;
  updateStickerTemplate: (id: string, data: Partial<SoverienStickerTemplate>) => void;
  deleteStickerTemplate: (id: string) => void;
  activeStickerTemplateId: string | null;
  setActiveStickerTemplate: (id: string | null) => void;

  // Settings
  settings: SoverienSettings;
  updateSettings: (settings: Partial<SoverienSettings>) => void;

  // Alerts
  alerts: SoverienAlert[];
  addAlert: (alert: Omit<SoverienAlert, 'id' | 'createdAt' | 'read'>) => void;
  markAlertRead: (id: string) => void;
  dismissAlert: (id: string) => void;

  // Actions
  initialize: () => void;
  reset: () => void;
}

// Default settings
const DEFAULT_SETTINGS: SoverienSettings = {
  pin: undefined,
  pinEnabled: false,
  lastSerialNumber: 0,
  warrantyDays: 365,
  shippingBufferDays: 14,
  companyName: 'Soverien',
  companyAddress: '',
  companyPhone: '',
  companyLineId: '',
};

const INITIAL_MODELS: SoverienModel[] = [
  { id: 'model-temp', name: 'Temp Sensor', prefix: 'Soverien-Temp' },
  { id: 'model-humidity', name: 'Humidity Sensor', prefix: 'Soverien-Humid' },
  { id: 'model-motion', name: 'Motion Sensor', prefix: 'Soverien-Motion' },
];

export const useSoverienStore = create<SoverienState>()(
  persist(
    (set, get) => ({
      // Models
      models: [],
      addModel: (model) => {
        const id = `model-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newModel = { ...model, id };
        set((state) => ({ models: [...state.models, newModel] }));
        return id;
      },
      updateModel: (id, data) =>
        set((state) => ({
          models: state.models.map((m) => (m.id === id ? { ...m, ...data } : m)),
        }),
      deleteModel: (id) =>
        set((state) => ({
          models: state.models.filter((m) => m.id !== id),
          serials: state.serials.filter((s) => s.modelId !== id),
        }),

      // Serials
      serials: [],
      generateSerials: (modelId, count) => {
        const model = get().models.find((m) => m.id === modelId);
        if (!model) throw new Error('Model not found');
        const serials: string[] = [];
        for (let i = 0; i < count; i++) {
          const nextNum = get().settings.lastSerialNumber + 1 + i;
          const serialNumber = `${model.prefix}-${String(nextNum).padStart(3, '0')}`;
          serials.push(serialNumber);
        }
        set((state) => ({
          settings: { ...state.settings, lastSerialNumber: state.settings.lastSerialNumber + count },
          serials: [
            ...state.serials,
            ...serials.map((sn) => ({
              serialNumber: sn,
              modelId,
              modelName: get().models.find((m) => m.id === modelId)?.name ?? '',
              createdAt: new Date().toISOString(),
              status: 'available' as const,
            })),
          ],
        }));
        return serials.map((sn) => sn);
      },
      getNextSerial: (modelId) => {
        const model = get().models.find((m) => m.id === modelId);
        if (!model) return '';
        const nextNum = get().settings.lastSerialNumber + 1;
        return `${model.prefix}-${String(nextNum).padStart(3, '0')}`;
      },
      getSerial: (serialNumber) => get().serials.find((s) => s.serialNumber === serialNumber),
      updateSerial: (serialNumber, data) =>
        set((state) => ({
          serials: state.serials.map((s) =>
            s.serialNumber === serialNumber ? { ...s, ...data } : s
          ),
        }),

      // Orders
      orders: [],
      createOrder: (order) => {
        const id = `order-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newOrder: SoverienOrder = { ...order, id, createdAt: new Date().toISOString() };
        set((state) => ({ orders: [...state.orders, newOrder] }));
        return id;
      },
      updateOrder: (id, data) =>
        set((state) => ({
          orders: state.orders.map((o) => (o.id === id ? { ...o, ...data } : o)),
        }),
      getOrder: (id) => get().orders.find((o) => o.id === id),
      getOrdersByCustomer: (customerId) =>
        get().orders.filter((o) => o.customer.id === customerId),
      getOrdersBySerial: (serialNumber) =>
        get().orders.filter((o) => o.serialNumbers.includes(serialNumber)),

      // Customers
      customers: [],
      createCustomer: (customer) => {
        const id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newCustomer: SoverienCustomer = { ...customer, id, createdAt: new Date().toISOString(), totalOrders: 0, totalValue: 0 };
        set((state) => ({ customers: [...state.customers, newCustomer] }));
        return id;
      },
      updateCustomer: (id, data) =>
        set((state) => ({
          customers: state.customers.map((c) => (c.id === id ? { ...c, ...data } : c)),
        }),
      getCustomer: (id) => get().customers.find((c) => c.id === id),
      getCustomerByPhone: (phone) => get().customers.find((c) => c.phone === phone),

      // Stickers
      stickerTemplates: [],
      addStickerTemplate: (template) => {
        const id = `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const newTemplate: SoverienStickerTemplate = { ...template, id };
        set((state) => ({
          stickerTemplates: [...state.stickerTemplates, newTemplate],
          activeStickerTemplateId: state.activeStickerTemplateId ?? id,
        }));
        return id;
      },
      updateStickerTemplate: (id, data) =>
        set((state) => ({
          stickerTemplates: state.stickerTemplates.map((t) => (t.id === id ? { ...t, ...data } : t)),
        }),
      deleteStickerTemplate: (id) =>
        set((state) => ({
          stickerTemplates: state.stickerTemplates.filter((t) => t.id !== id),
          activeStickerTemplateId: state.activeStickerTemplateId === id ? null : state.activeStickerTemplateId,
        }),
      activeStickerTemplateId: null,
      setActiveStickerTemplate: (id) => set({ activeStickerTemplateId: id }),

      // Settings
      settings: DEFAULT_SETTINGS,
      updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),

      // Alerts
      alerts: [],
      addAlert: (alert) => {
        const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        set((state) => ({ alerts: [...state.alerts, { ...alert, id, createdAt: new Date().toISOString(), read: false }] }));
      },
      markAlertRead: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
        }),
      dismissAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.filter((a) => a.id !== id),
        }),

      // Init
      initialize: () => {
        const state = get();
        if (state.models.length === 0) {
          INITIAL_MODELS.forEach((m) => get().addModel(m));
        }
      },
      reset: () => set({ models: [], serials: [], orders: [], customers: [], stickerTemplates: [], settings: DEFAULT_SETTINGS, alerts: [] }),
    }),
    {
      name: 'soverien-store',
      version: 1,
      migrate: (persisted: any) => {
        // Migration logic if needed
        return persisted;
      },
    }
  )
);

export default useSoverienStore;
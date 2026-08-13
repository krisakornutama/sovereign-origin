export interface JwtPayload {
    userId: string;
    role: 'SUPERADMIN' | 'NODE_ADMIN' | 'OPERATOR';
    assigned_node_id?: string | null;
    mfa_verified: boolean;
    iat: number;
    exp: number;
  }
  
  export interface TelemetryUpdate {
    node_id: string;
    node_name?: string;
    battery_soc: number;
    power_kw: number;
    water_level_cm: number;
    status: 'ONLINE' | 'OFFLINE';
    [key: string]: any;
  }
  
  export interface UserProfile {
    id: string;
    username: string;
    role: JwtPayload['role'];
    assigned_node_id?: string | null;
  }

  export type ExpiryStatus = 'ok' | 'expiring' | 'expired' | 'na';

  export interface InventoryItem {
    id: string;
    name: string;
    category: 'WATER' | 'FOOD' | 'FUEL' | 'MATERIAL' | 'PRECIOUS_METAL' | 'OTHER' | string;
    quantity: number;
    unit: string;
    unit_price_usd: number;
    location: string | null;
    expiry_date: string | null;
    shelf_life_days: number | null;
    minimum_stock: number | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    expiry: { daysLeft: number | null; status: ExpiryStatus; date: string | null };
    lowStock: boolean;
  }

  export interface FarmPlot {
    id: string;
    name: string;
    location: string | null;
    crop: string | null;
    area_sqm: number | null;
    soil_notes: string | null;
    planted_at: string | null;
    expected_harvest_at: string | null;
    status: 'active' | 'growing' | 'harvested' | 'fallow' | string;
    notes: string | null;
    created_at: string;
    updated_at: string;
    daysToHarvest?: number | null;
  }
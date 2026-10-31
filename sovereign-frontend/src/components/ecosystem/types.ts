export interface EcosystemPlatform {
  id: string;
  name: string;
  category: string;
  url: string;
  color: string;
  hint: string;
}

export interface EcosystemCategory {
  id: string;
  name: string;
}

export interface EcosystemAccount {
  id: string;
  platform: string;
  platformName: string;
  category: string;
  label: string;
  url: string | null;
  loginId: string;
  hasPassword: boolean;
  notes: string;
  status: string;
  lastUsedAt: string | null;
  passwordUpdatedAt: string | null;
  passwordAgeDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EcosystemSummary {
  total: number;
  active: number;
  withPassword: number;
  missingPassword: number;
  platforms: number;
  stalePasswords: number;
  byPlatform: Record<string, number>;
}

export interface AccountFormValues {
  platform: string;
  label: string;
  url: string;
  loginId: string;
  password: string;
  notes: string;
  status: string;
}

export const EMPTY_FORM: AccountFormValues = {
  platform: 'custom',
  label: '',
  url: '',
  loginId: '',
  password: '',
  notes: '',
  status: 'active',
};

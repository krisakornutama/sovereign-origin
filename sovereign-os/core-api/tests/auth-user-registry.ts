// Test-only auth user registry.
//
// Route tests use makeToken() without a database. The auth middleware now
// treats the database as the source of truth for role/token_version, so the
// token helper registers the matching user row here. Individual tests can
// override this through mockModel(prisma, 'user', ...) when they need a
// deleted/demoted user scenario.
export interface TestAuthUser {
  id: string;
  role: string;
  assigned_node_id?: string | null;
  token_version?: number;
  must_change_password?: boolean;
}

const users = new Map<string, TestAuthUser>();

export function registerTestUser(user: TestAuthUser): void {
  users.set(user.id, { ...user });
}

export function unregisterTestUser(id: string): void {
  users.delete(id);
}

export function findTestUser(id: string): TestAuthUser | null {
  return users.get(id) ?? null;
}

export function clearTestUsers(): void {
  users.clear();
}

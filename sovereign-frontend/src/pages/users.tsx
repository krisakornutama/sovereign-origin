"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface User {
  id: string;
  username: string;
  role: string;
  assigned_node_id: string | null;
}

const ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI'];

export default function UsersPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('OPERATOR');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadUsers();
  }, [isHydrated, isAuthenticated]);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(`❌ ${err.message || 'ไม่สามารถดึงข้อมูลผู้ใช้ได้'}`);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const addUser = async () => {
    if (!newUsername.trim() || !newPassword) return;
    setError('');
    setMessage('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✅ เพิ่มผู้ใช้ ${newUsername} สำเร็จ`);
        setNewUsername('');
        setNewPassword('');
        loadUsers();
      } else {
        setError(`❌ ${data.error || 'เพิ่มผู้ใช้ไม่สำเร็จ'}`);
      }
    } catch {
      setError('❌ ไม่สามารถเพิ่มผู้ใช้ได้');
    }
  };

  const changeRole = async (id: string, username: string, role: string) => {
    if (!confirm(`เปลี่ยนบทบาทของ ${username} เป็น ${role}?`)) return;
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('✅ เปลี่ยนบทบาทสำเร็จ');
        loadUsers();
      } else {
        setError(`❌ ${data.error || 'เปลี่ยนบทบาทไม่สำเร็จ'}`);
      }
    } catch {
      setError('❌ เปลี่ยนบทบาทไม่สำเร็จ');
    }
  };

  const deleteUser = async (id: string, username: string) => {
    if (!confirm(`ลบผู้ใช้ ${username}?`)) return;
    setMessage('');
    setError('');
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}`, { method: 'DELETE' });
      setMessage('✅ ลบผู้ใช้สำเร็จ');
      loadUsers();
    } catch {
      setError('❌ ไม่สามารถลบผู้ใช้ได้');
    }
  };

  if (!isHydrated) {
    return <div className="text-white p-8">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  if (user.role !== 'SUPERADMIN') {
    return <div className="min-h-screen bg-gray-950 text-gray-100 font-mono p-8">🔒 หน้านี้ใช้ได้เฉพาะ SUPERADMIN</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ระบบ"
          title="🏰 SOVEREIGN OS"
          subtitle="User Management" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>}
        />
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {message && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400">{message}</div>}
        {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>}

        {/* Add user */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <h2 className="text-lg font-bold">➕ เพิ่มผู้ใช้ใหม่</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="ชื่อผู้ใช้"
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="รหัสผ่าน"
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              onClick={addUser}
              disabled={!newUsername.trim() || !newPassword}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold disabled:opacity-50"
            >
              💾 บันทึก
            </button>
          </div>
        </div>

        {/* User list */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">ชื่อผู้ใช้</th>
                <th className="px-4 py-3">บทบาท</th>
                <th className="px-4 py-3">Node ที่ดูแล</th>
                <th className="px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-white">
                    {u.username}
                    {u.id === user.id && <span className="ml-2 text-xs text-green-400">(คุณ)</span>}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={u.role}
                      disabled={u.id === user.id}
                      onChange={(e) => changeRole(u.id, u.username, e.target.value)}
                      className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{u.assigned_node_id || '-'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => deleteUser(u.id, u.username)}
                      disabled={u.id === user.id}
                      className="text-red-400 hover:text-red-300 text-xs disabled:opacity-30"
                    >
                      🗑️ ลบ
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">ไม่มีผู้ใช้</td></tr>
              )}
              {loading && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">⏳ กำลังโหลด...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
      </div>
  );
}
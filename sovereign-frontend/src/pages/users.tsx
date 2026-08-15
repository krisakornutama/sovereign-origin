"use client";
import { Fragment, useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface User {
  id: string;
  username: string;
  role: string;
  assigned_node_id: string | null;
  must_change_password?: boolean;
}

interface FeatureDef {
  key: string;
  label: string;
  group: string;
  adminOnly?: boolean;
}

interface MemberSummary {
  id: string;
  username: string;
  role: string;
  features: string[];
}

interface SummaryData {
  catalog: FeatureDef[];
  members: MemberSummary[];
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

  // ── สิทธิ์ฟังก์ชั่นต่อคน ──
  const [catalog, setCatalog] = useState<FeatureDef[]>([]);
  const [grantedByUser, setGrantedByUser] = useState<Record<string, string[]>>({});
  const [grantLoading, setGrantLoading] = useState<string | null>(null);

  // ── สรุปสิทธิ์ทั้งครอบครัว (modal matrix) ──
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // รายการหน้าทั้งหมด (เรียงตามหมวด) สำหรับ checkbox
  const featureGroups = useMemo(() => {
    const groups: { group: string; items: FeatureDef[] }[] = [];
    for (const f of catalog) {
      if (f.adminOnly) continue; // หน้า admin ไม่เปิดให้สมาชิก
      let g = groups.find((x) => x.group === f.group);
      if (!g) {
        g = { group: f.group, items: [] };
        groups.push(g);
      }
      g.items.push(f);
    }
    return groups;
  }, [catalog]);

  // หน้า member ทั้งหมดที่เปิดให้ได้ (ไม่รวมหน้า admin) — ใช้ preset "ทุกอย่างยกเว้นระบบ"
  const memberKeys = useMemo(() => catalog.filter((f) => !f.adminOnly).map((f) => f.key), [catalog]);

  // สุ่มรหัสผ่านแรกเข้า (12 ตัว อ่านง่าย ไม่มี 0/O/1/l/I)
  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    const arr = new Uint32Array(12);
    crypto.getRandomValues(arr);
    let p = '';
    for (let i = 0; i < 12; i++) p += chars[arr[i] % chars.length];
    setNewPassword(p);
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadUsers();
    // catalog ของหน้า (สำหรับตั้งสิทธิ์)
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/features`)
      .then((res) => (res.ok ? res.json() : { features: [] }))
      .then((d) => setCatalog(d.features || []))
      .catch(() => setCatalog([]));
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
        const username = newUsername.trim();
        setMessage(`✅ เพิ่มผู้ใช้ ${username} สำเร็จ — login ครั้งแรกต้องเปลี่ยนรหัสผ่านก่อน ตั้งสิทธิ์หน้าให้ด้านล่างได้เลย`);
        setNewUsername('');
        setNewPassword('');
        // โหลดรายชื่อใหม่ แล้วเปิดแผงตั้งสิทธิ์ของสมาชิกใหม่ให้ทันที (ตั้งไอดี → ตั้งสิทธิ์ในคราวเดียว)
        const listRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`);
        const list = listRes.ok ? await listRes.json() : [];
        setUsers(list);
        const created = (list as User[]).find((x) => x.username === username);
        if (created && created.role !== 'SUPERADMIN') {
          setGrantedByUser((prev) => ({ ...prev, [created.id]: [] }));
        }
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

  // บังคับให้ user เปลี่ยนรหัสผ่านครั้งหน้า login (เช่น สงสัยว่ารั่ว/ลืมรหัส)
  const forcePasswordChange = async (id: string, username: string) => {
    if (!confirm(`บังคับให้ ${username} เปลี่ยนรหัสผ่านครั้งหน้า login?`)) return;
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ must_change_password: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งค่าไม่สำเร็จ');
      setMessage(`🔑 ตั้งบังคับเปลี่ยนรหัสผ่านให้ ${username} แล้ว — ครั้งหน้า login ต้องเปลี่ยนก่อนเข้าใช้`);
      loadUsers();
    } catch (err: any) {
      setError(`❌ ${err.message || 'ตั้งค่าไม่สำเร็จ'}`);
    }
  };

  // โหลดสิทธิ์ของสมาชิกคนหนึ่ง (กดปุ่ม "สิทธิ์")
  const toggleGrantEditor = async (u: User) => {
    if (u.role === 'SUPERADMIN') return;
    if (grantLoading === u.id) return;
    if (grantedByUser[u.id]) {
      // ซ่อนลง
      setGrantedByUser((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
      return;
    }
    setGrantLoading(u.id);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/features/users/${u.id}`);
      if (!res.ok) throw new Error('โหลดสิทธิ์ไม่สำเร็จ');
      const data = await res.json();
      setGrantedByUser((prev) => ({ ...prev, [u.id]: data.features || [] }));
    } catch {
      setError('❌ โหลดสิทธิ์ของสมาชิกไม่สำเร็จ');
    } finally {
      setGrantLoading(null);
    }
  };

  // ตั้งสิทธิ์สำเร็จรูป (ยังไม่บันทึก — ต้องกด 💾 บันทึกสิทธิ์)
  const applyPreset = (u: User, keys: string[]) => {
    setGrantedByUser((prev) => ({ ...prev, [u.id]: [...keys] }));
  };

  // ติ๊ก/แกะ checkbox สิทธิ์ (ยังไม่บันทึก)
  const toggleFeature = (userId: string, key: string) => {
    setGrantedByUser((prev) => {
      const cur = prev[userId] || [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...prev, [userId]: next };
    });
  };

  // โหลดสรุปสิทธิ์ทั้งครอบครัว (ทุกคน × ทุกหน้า)
  const loadSummary = async () => {
    setSummaryOpen(true);
    setSummaryLoading(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/features/summary`);
      if (!res.ok) throw new Error('โหลดสรุปไม่สำเร็จ');
      setSummary(await res.json());
    } catch (err: any) {
      setError(`❌ ${err.message || 'โหลดสรุปสิทธิ์ไม่สำเร็จ'}`);
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  // บันทึกสิทธิ์ของสมาชิก
  const saveGrants = async (u: User) => {
    const features = grantedByUser[u.id] || [];
    setGrantLoading(u.id);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/features/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกสิทธิ์ไม่สำเร็จ');
      setMessage(`✅ บันทึกสิทธิ์ของ ${u.username} แล้ว (${data.features.length} หน้า)`);
      setGrantedByUser((prev) => ({ ...prev, [u.id]: data.features || [] }));
    } catch (err: any) {
      setError(`❌ ${err.message || 'บันทึกสิทธิ์ไม่สำเร็จ'}`);
    } finally {
      setGrantLoading(null);
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">➕ เพิ่มผู้ใช้ใหม่</h2>
            <button
              onClick={loadSummary}
              className="px-3 py-1.5 rounded text-sm bg-gray-800 border border-gray-600 text-gray-200 hover:bg-gray-700 transition-colors"
            >
              👁️ สรุปสิทธิ์ทั้งครอบครัว
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="ชื่อผู้ใช้"
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="รหัสผ่าน (รหัสแรกเข้า)"
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
              <button
                onClick={genPassword}
                title="สุ่มรหัสผ่าน"
                className="px-3 py-2 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700 text-sm"
              >
                🎲
              </button>
            </div>
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
          <div className="text-[10px] text-gray-500">
            💡 สมาชิกเข้าสู่ระบบด้วยไอดี + รหัสนี้ (กด 🎲 เพื่อสุ่ม) — login ครั้งแรกจะถูกบังคับให้
            <span className="text-amber-400"> เปลี่ยนรหัสผ่านเองก่อนเข้าใช้งาน</span> (กด 🔑 บังคับเปลี่ยนได้ทุกเมื่อ)
          </div>
        </div>

        {/* User list */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">ชื่อผู้ใช้</th>
                <th className="px-4 py-3">บทบาท</th>
                <th className="px-4 py-3">สิทธิ์หน้า</th>
                <th className="px-4 py-3">Node ที่ดูแล</th>
                <th className="px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-white">
                      {u.username}
                      {u.id === user.id && <span className="ml-2 text-xs text-green-400">(คุณ)</span>}
                      {u.must_change_password && (
                        <span
                          className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/60 text-amber-300"
                          title="ยังไม่ได้เปลี่ยนรหัสผ่านจากรหัสชั่วคราว"
                        >
                          🔑 ต้องเปลี่ยนรหัส
                        </span>
                      )}
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
                    <td className="px-4 py-2">
                      {u.role === 'SUPERADMIN' ? (
                        <span className="text-xs text-green-400">เห็นทั้งหมด (superadmin)</span>
                      ) : (
                        <button
                          onClick={() => toggleGrantEditor(u)}
                          disabled={grantLoading === u.id}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40"
                        >
                          {grantLoading === u.id ? '⏳…' : grantedByUser[u.id] ? `✏️ แก้สิทธิ์ (${grantedByUser[u.id].length})` : '🔓 ตั้งสิทธิ์'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">{u.assigned_node_id || '-'}</td>
                    <td className="px-4 py-2">
                      {!u.must_change_password && (
                        <button
                          onClick={() => forcePasswordChange(u.id, u.username)}
                          disabled={u.id === user.id}
                          title="บังคับเปลี่ยนรหัสผ่านครั้งหน้า login"
                          className="text-amber-400 hover:text-amber-300 text-xs disabled:opacity-30 mr-3"
                        >
                          🔑 บังคับเปลี่ยน
                        </button>
                      )}
                      <button
                        onClick={() => deleteUser(u.id, u.username)}
                        disabled={u.id === user.id}
                        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-30"
                      >
                        🗑️ ลบ
                      </button>
                    </td>
                  </tr>
                  {/* แผงตั้งสิทธิ์ของสมาชิกคนนี้ */}
                  {u.role !== 'SUPERADMIN' && grantedByUser[u.id] && (
                    <tr className="bg-gray-950/60">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs text-gray-300 font-bold">🔓 สิทธิ์หน้าที่ {u.username} เห็นได้</div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveGrants(u)}
                              disabled={grantLoading === u.id}
                              className="px-3 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                            >
                              💾 บันทึกสิทธิ์
                            </button>
                            <button
                              onClick={() => toggleGrantEditor(u)}
                              className="px-3 py-1 rounded text-xs bg-gray-800 border border-gray-600 hover:bg-gray-700 text-gray-300"
                            >
                              ปิด
                            </button>
                          </div>
                        </div>
                        {/* ตั้งสิทธิ์สำเร็จรูป — คลิกเดียวแล้วกดบันทึก */}
                        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                          <span className="text-[10px] text-gray-500 mr-1">ตั้งสำเร็จรูป:</span>
                          <button
                            onClick={() => applyPreset(u, ['/knowledge'])}
                            className="px-2.5 py-1 rounded text-[11px] bg-indigo-900/40 border border-indigo-700/60 text-indigo-300 hover:bg-indigo-800/40"
                          >
                            🎓 เรียนอย่างเดียว
                          </button>
                          <button
                            onClick={() => applyPreset(u, ['/knowledge', '/portfolio'])}
                            className="px-2.5 py-1 rounded text-[11px] bg-emerald-900/40 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-800/40"
                          >
                            💰 เรียน + เงิน
                          </button>
                          <button
                            onClick={() => applyPreset(u, memberKeys)}
                            className="px-2.5 py-1 rounded text-[11px] bg-blue-900/40 border border-blue-700/60 text-blue-300 hover:bg-blue-800/40"
                          >
                            🌐 ทุกอย่างยกเว้นระบบ
                          </button>
                          <button
                            onClick={() => applyPreset(u, [])}
                            className="px-2.5 py-1 rounded text-[11px] bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700"
                          >
                            🧹 ล้างทั้งหมด
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                          {featureGroups.map((g) => (
                            <div key={g.group}>
                              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 mt-2">{g.group}</div>
                              {g.items.map((f) => (
                                <label key={f.key} className="flex items-center gap-2 py-0.5 text-sm text-gray-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={(grantedByUser[u.id] || []).includes(f.key)}
                                    onChange={() => toggleFeature(u.id, f.key)}
                                    className="accent-emerald-500"
                                  />
                                  {f.label}
                                </label>
                              ))}
                            </div>
                          ))}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-2">
                          💡 ลูกจะเห็นเฉพาะหน้าที่ติ๊กไว้ในเมนู และเข้าผ่าน URL ตรง ๆ ไม่ได้ (backend ปฏิเสธ 403)
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">ไม่มีผู้ใช้</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">⏳ กำลังโหลด...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal: สรุปสิทธิ์ทั้งครอบครัว — ใครเห็นหน้าไหน มองทีเดียวจบ */}
      {summaryOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-6xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
              <div>
                <h2 className="text-lg font-bold">👁️ สรุปสิทธิ์ทั้งครอบครัว</h2>
                <p className="text-[11px] text-gray-500">✓ = เห็นหน้านี้ · 👑 = superadmin (เห็นทุกอย่าง) — กดปุ่ม "ตั้งสิทธิ์" ในตารางด้านล่างเพื่อแก้ทีละคน</p>
              </div>
              <button onClick={() => setSummaryOpen(false)} className="px-3 py-1 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700 text-sm">✕ ปิด</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {summaryLoading ? (
                <div className="text-center text-gray-400 py-12">⏳ กำลังโหลด...</div>
              ) : summary ? (
                <SummaryMatrix data={summary} myId={user.id} />
              ) : (
                <div className="text-center text-red-400 py-12">โหลดสรุปไม่สำเร็จ — ลองใหม่อีกครั้ง</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
      </div>
  );
}

// ตาราง matrix: แถว = สมาชิก, คอลัมน์ = หน้า (จัดกลุ่มตามหมวดเมนู)
function SummaryMatrix({ data, myId }: { data: SummaryData; myId: string }) {
  const groups: { group: string; items: FeatureDef[] }[] = [];
  for (const f of data.catalog) {
    let g = groups.find((x) => x.group === f.group);
    if (!g) {
      g = { group: f.group, items: [] };
      groups.push(g);
    }
    g.items.push(f);
  }
  const allKeys = data.catalog.map((f) => f.key);
  const isSuper = (m: MemberSummary) => m.role === 'SUPERADMIN';

  return (
    <table className="border-collapse text-xs w-full">
      <thead>
        {/* แถวหมวด */}
        <tr>
          <th className="border border-gray-700 bg-gray-800 px-2 py-1.5 text-left sticky left-0 z-10">สมาชิก</th>
          {groups.map((g) => (
            <th key={g.group} colSpan={g.items.length} className="border border-gray-700 bg-gray-800 px-2 py-1.5 text-center text-gray-300 whitespace-nowrap">
              {g.group}
            </th>
          ))}
        </tr>
        {/* แถวชื่อหน้า */}
        <tr>
          <th className="border border-gray-700 bg-gray-900 px-2 py-1.5 text-left sticky left-0 z-10">หน้าที่เห็น</th>
          {groups.flatMap((g) =>
            g.items.map((f) => (
              <th key={f.key} title={f.key} className="border border-gray-700 bg-gray-900 px-1.5 py-1 text-center text-gray-400 whitespace-nowrap font-normal">
                {f.label}
              </th>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        {data.members.map((m) => {
          const superAdmin = isSuper(m);
          const feat = new Set(m.features);
          const count = superAdmin ? allKeys.length : feat.size;
          return (
            <tr key={m.id} className={superAdmin ? 'bg-green-950/30' : m.id === myId ? 'bg-blue-950/20' : ''}>
              <td className="border border-gray-700 px-2 py-1.5 sticky left-0 bg-gray-900 whitespace-nowrap">
                {m.username}
                {m.id === myId && <span className="text-blue-400"> (คุณ)</span>}
                {superAdmin && <span className="text-green-400"> 👑</span>}
                <div className="text-[10px] text-gray-500">
                  {m.role} · {count}/{allKeys.length} หน้า
                  {!superAdmin && feat.size === 0 && <span className="text-amber-400"> · ยังไม่ได้ตั้งสิทธิ์</span>}
                </div>
              </td>
              {groups.flatMap((g) =>
                g.items.map((f) => (
                  <td key={f.key} className="border border-gray-700 px-1 py-1 text-center">
                    {feat.has(f.key) ? <span className="text-green-400">✓</span> : <span className="text-gray-600">—</span>}
                  </td>
                ))
              )}
            </tr>
          );
        })}
        {data.members.length === 0 && (
          <tr>
            <td colSpan={allKeys.length + 1} className="border border-gray-700 px-2 py-8 text-center text-gray-500">ไม่มีสมาชิก</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
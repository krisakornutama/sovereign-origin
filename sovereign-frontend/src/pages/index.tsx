"use client";
import { useAuthStore } from '../stores/useAuthStore';
import LoginForm from '../components/auth/LoginForm';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isHydrated && isAuthenticated) {
      // ยังไม่ได้เปลี่ยนรหัสผ่านครั้งแรก → บังคับไปหน้าเปลี่ยนรหัสก่อน
      router.push(mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword]);

  // รอจนกว่า store จะ hydrate ก่อนแสดงอะไร
  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-green-400 text-lg animate-pulse">⏳ Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return null;
}
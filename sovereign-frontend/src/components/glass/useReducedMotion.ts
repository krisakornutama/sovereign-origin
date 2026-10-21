"use client";

/**
 * useReducedMotion — อ่านค่า prefers-reduced-motion ของ OS แบบ SSR-safe
 *
 * ทำไมต้องมี: ฉาก shader gradient กับ orb 3D วิ่งตลอดเวลา ถ้าผู้ใช้ตั้งค่า
 * "ลดการเคลื่อนไหว" (หรือเครื่องช้า/ใช้แบตเตอรี่) ระบบต้องหยุดให้เอง ไม่ใช่ฝืนเล่น
 *
 * ค่าเริ่มต้น = false ทั้งฝั่ง server และ hydrate รอบแรก แล้วค่อยปรับตามค่าจริงใน effect
 * — HTML ฝั่ง server กับ client จึงตรงกันเสมอ (ไม่เกิด hydration mismatch)
 */
import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari รุ่นเก่าไม่มี addEventListener บน MediaQueryList — ถอยไปใช้ addListener
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;

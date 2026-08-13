"use client";

import CommandPalette, { useCommandPaletteOpen } from './CommandPalette';

/** ตัวถือสถานะเปิด/ปิดของ Command Palette — ฝังไว้ใน _app ให้ใช้ได้ทุกหน้า */
export default function CommandPaletteHost() {
  const { open, setOpen } = useCommandPaletteOpen();
  return <CommandPalette open={open} setOpen={setOpen} />;
}

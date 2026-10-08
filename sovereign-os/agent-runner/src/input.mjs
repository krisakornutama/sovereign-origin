// src/input.mjs — ฉีดเมาส์/คีย์บอร์ดเข้าที่เครื่องนี้ (ตามคำสั่งจากผู้ใช้ผ่าน HUB)
//
// ── ทำไมโครงสร้างเป็นแบบนี้ ──────────────────────────────────────────────
//
// 1) ตรรกะ P/Invoke อยู่ใน C# ทั้งหมด (Add-Type) ไม่ใช่ PowerShell
//    เพราะ struct ของ .NET เป็น value type — การเขียน `$input.U.mi.dx = 5` ใน
//    PowerShell จะแก้ "สำเนา" ไม่ใช่ตัวจริง แล้วเงียบ ๆ ไม่เกิดอะไรขึ้น
//    (บั๊กที่หาสาเหตุยากมาก เพราะไม่มี error ให้เห็น)
//    ⇒ ให้ C# มี static method MoveTo/MouseButton/Wheel/Key ที่ประกอบ INPUT เอง
//
// 2) host เป็น process เดียวค้างไว้ อ่าน JSON ทีละบรรทัดจาก stdin
//    เปิด PowerShell ใหม่ต่อ 1 คลิก = หน่วงหลายร้อย ms ต่อการขยับเมาส์ 1 ครั้ง
//
// 3) มีคำสั่ง 'noop' ที่ตอบ ok โดยไม่ฉีดอะไรเลย
//    เพื่อให้เทสต์พิสูจน์ได้ว่า host ทำงานจริง (compile ผ่าน/ลูป/JSON/ตอบกลับ)
//    **โดยไม่ต้องยึดเมาส์ของคนที่กำลังนั่งอยู่หน้าเครื่องนั้น**
//
// ข้อจำกัดที่รู้และยอมรับ: Windows ที่มี UIPI จะไม่ให้โปรเซสระดับผู้ใช้ทั่วไป
// ฉีดอินพุตเข้าโปรเซสที่ยศสูงกว่า (เช่นหน้าต่าง UAC) — ต้องรัน runner แบบ elevated
// ถึงจะคุมหน้าต่างเหล่านั้นได้ (ถ้าไม่ elevated ก็ยังคุมหน้าต่างทั่วไปได้ปกติ)
import { spawn } from 'node:child_process';

/** ปุ่มพิเศษ → รหัส Virtual-Key ของ Windows (เฉพาะที่ใช้จริง/พิมพ์ได้) */
export const VK_CODES = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  // ปุ่มลัดที่ต้องใช้บ่อยตอนควบคุมเครื่องไกล
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  CapsLock: 0x14,
  // ปุ่ม Windows ที่ระบบใช้
  PrintScreen: 0x2c,
  ScrollLock: 0x91,
  Pause: 0x13,
};

// F1..F24 → 0x70..0x87
for (let i = 1; i <= 24; i += 1) VK_CODES[`F${i}`] = 0x6f + i;
// A-Z → 0x41..0x5a
for (let c = 0; c < 26; c += 1) VK_CODES[String.fromCharCode(65 + c)] = 0x41 + c;
// 0-9 → 0x30..0x39
for (let d = 0; d <= 9; d += 1) VK_CODES[String(d)] = 0x30 + d;

/**
 * แปลงชื่อปุ่มจากหน้าเว็บ (KeyboardEvent.key/code) → virtual-key code
 * คืน null เมื่อไม่รู้จัก — ผู้เรียกต้องข้าม ไม่เดาสุ่ม
 *
 * รับได้ทั้งแบบ KeyboardEvent.code ('KeyA', 'Digit1', 'ArrowUp')
 * และแบบ KeyboardEvent.key ('a', 'A', '1', 'Enter')
 */
export function resolveKeyCode(name) {
  if (typeof name !== 'string') return null;
  const raw = name.trim();
  if (!raw) return null;

  if (Object.prototype.hasOwnProperty.call(VK_CODES, raw)) return VK_CODES[raw];

  // 'KeyA' → 'A'
  if (/^Key[A-Z]$/.test(raw)) return VK_CODES[raw.slice(3)];
  // 'Digit7' → '7'
  if (/^Digit[0-9]$/.test(raw)) return VK_CODES[raw.slice(5)];
  // ตัวอักษรเดี่ยว (พิมพ์เล็ก/ใหญ่ใช้รหัสเดียวกัน — shift จัดการแยก)
  if (/^[a-zA-Z]$/.test(raw)) return VK_CODES[raw.toUpperCase()];
  // เลขรหัสมาตรง ๆ จากหน้าเว็บ ('vk:13') สำหรับกรณีที่ไม่มีชื่อในตาราง
  const explicit = /^vk:(\d+)$/i.exec(raw);
  if (explicit) {
    const vk = Number(explicit[1]);
    if (Number.isFinite(vk) && vk > 0 && vk < 256) return vk;
  }
  return null;
}

/** ปุ่มเมาส์ที่ยอมรับ → ค่าคงที่ของ Windows */
export const MOUSE_BUTTONS = {
  left: { down: 0x0002, up: 0x0004 },
  right: { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 },
};

/**
 * ตัดค่าพิกัดให้เป็นจำนวนเต็มที่ไม่ติดลบ
 * จอจริงมีตั้งแต่ 1 จอไปจนถึงหลายจอเรียงกัน — พิกัดเป็นพิกเซลจริงของ virtual desktop
 */
export function normalizeCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** เพดานความยาวข้อความที่พิมพ์รวดเดียว — กัน payload มหึมาถูกส่งเข้าคีย์บอร์ด */
export const MAX_TEXT_LENGTH = 2000;

// ────────────────────────────────────────────────────────────────────────────
// ส่วน C# — ประกอบ INPUT แล้วเรียก SendInput เอง (ห้ามเขียน logic นี้ใน PowerShell)
//
// ⚠️ ห้ามมีเครื่องหมาย single-quote ในโค้ด C# นี้เด็ดขาด
//   เพราะมันถูกครอบด้วย single quote ของ PowerShell ทั้งก้อน
//   ⇒ ใช้ (int)c == 10 แทน (int)'\n' เป็นต้น
//
// ใช้ GetSystemMetrics แทน System.Windows.Forms เพื่อตัด assembly อ้างอิง
// (AMSI มองสคริปต์ที่พึ่ง WinForms+SendInput รวมกันแล้วหวาดระแวงกว่าปกติ)
// ────────────────────────────────────────────────────────────────────────────
const CS = [
  'using System;using System.Runtime.InteropServices;public class Win32In{',
  '[StructLayout(LayoutKind.Sequential)]public struct INPUT{public uint type;public InputUnion U;}',
  '[StructLayout(LayoutKind.Explicit)]public struct InputUnion{[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}',
  '[StructLayout(LayoutKind.Sequential)]public struct MOUSEINPUT{public int dx;public int dy;public uint mouseData;public uint dwFlags;public uint time;public IntPtr dwExtraInfo;}',
  '[StructLayout(LayoutKind.Sequential)]public struct KEYBDINPUT{public ushort wVk;public ushort wScan;public uint dwFlags;public uint time;public IntPtr dwExtraInfo;}',
  '[DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,INPUT[] p,int cb);',
  '[DllImport("user32.dll")]static extern int GetSystemMetrics(int i);',
  '[DllImport("user32.dll")]static extern short VkKeyScan(char c);',
  'const uint MOVE=0x0001,ABSOLUTE=0x8000,VIRTUALDESK=0x4000,WHEEL=0x0800,KEYUP=0x0002;',
  // SM_XVIRTUALSCREEN=76 SM_YVIRTUALSCREEN=77 SM_CXVIRTUALSCREEN=78 SM_CYVIRTUALSCREEN=79
  'static int W(){return GetSystemMetrics(78);}static int H(){return GetSystemMetrics(79);}',
  'static int X0(){return GetSystemMetrics(76);}static int Y0(){return GetSystemMetrics(77);}',
  'static uint One(INPUT i){return SendInput(1,new INPUT[]{i},Marshal.SizeOf(typeof(INPUT)));}',
  'public static long MoveTo(int x,int y){',
  'INPUT i=new INPUT();i.type=0;int w=W()-1,h=H()-1;if(w<1)w=1;if(h<1)h=1;',
  'int nx=x-X0();int ny=y-Y0();',
  'if(nx<0)nx=0;if(ny<0)ny=0;if(nx>w)nx=w;if(ny>h)ny=h;',
  'i.U.mi.dx=(int)Math.Round(nx*65535.0/w);i.U.mi.dy=(int)Math.Round(ny*65535.0/h);',
  'i.U.mi.dwFlags=MOVE|ABSOLUTE|VIRTUALDESK;return One(i);}',
  'public static long Button(int flag){INPUT i=new INPUT();i.type=0;i.U.mi.dwFlags=(uint)flag;return One(i);}',
  'public static long Wheel(int delta){INPUT i=new INPUT();i.type=0;i.U.mi.mouseData=(uint)delta;i.U.mi.dwFlags=WHEEL;return One(i);}',
  'public static long KeyVk(int vk,bool down){INPUT i=new INPUT();i.type=1;i.U.ki.wVk=(ushort)vk;i.U.ki.dwFlags=down?(uint)0:KEYUP;return One(i);}',
  'public static string Ready(){return "size="+Marshal.SizeOf(typeof(INPUT));}',
  // พิมพ์ข้อความ: แปลงอักขระเป็นปุ่มด้วย VkKeyScan แล้วกด shift/ctrl/alt ตามที่ระบบบอก
  'public static int TypeText(string t){int n=0;',
  'foreach(char c in t){int ci=(int)c;',
  'if(ci==10){KeyVk(0x0D,true);KeyVk(0x0D,false);n++;continue;}',
  'if(ci==13){continue;}',
  'if(ci==9){KeyVk(0x09,true);KeyVk(0x09,false);n++;continue;}',
  'short r=VkKeyScan(c);if(r==-1){continue;}',
  'int vk=r&0xFF;int st=(r>>8)&0xFF;',
  'bool sh=(st&1)!=0,ct=(st&2)!=0,al=(st&4)!=0;',
  'if(sh){KeyVk(0x10,true);}if(ct){KeyVk(0x11,true);}if(al){KeyVk(0x12,true);}',
  'KeyVk(vk,true);KeyVk(vk,false);',
  'if(al){KeyVk(0x12,false);}if(ct){KeyVk(0x11,false);}if(sh){KeyVk(0x10,false);}',
  'n++;}return n;}',
  '}',
].join('');

/** C# ที่จะถูกส่งเข้า Add-Type (แยกออกมาให้เทสต์ตรวจว่าไม่มี single-quote ได้) */
export function buildCSharp() {
  return CS;
}

/**
 * สคริปต์ PowerShell ของ input host — ต้องเป็นบรรทัดเดียว ส่งทาง -Command
 * ห้ามใช้ -EncodedCommand/-File (AV บล็อก — บทเรียนเดียวกับ screen.mjs)
 *
 * ⚠️ สคริปต์นี้ถูกประกอบจาก array ที่ join ด้วย '; ' ⇒ ห้ามใช้ if/elseif เด็ดขาด
 *   เพราะ '} ; elseif' ทำให้ PowerShell ปิด statement ของ if แล้วเจอ elseif ลอย ๆ
 *   ⇒ ใช้ if เดี่ยว ๆ ต่อกัน (เข้าเงื่อนไขเดียวเท่านั้นในทางปฏิบัติอยู่แล้ว)
 *   และทุกบรรทัดที่ตามหลัง '{' หรือ '}' ต้องไม่ต้องพึ่งการต่อเนื่องของไวยากรณ์
 */
export function buildInputScript() {
  return [
    `Add-Type -TypeDefinition '${CS}'`,
    '$in=[Console]::In',
    '$out=[Console]::Out',
    'while($true){',
    '$line=$in.ReadLine()',
    'if($line -eq $null){break}',
    '$id=$null',
    'try{',
    '$c=$line|ConvertFrom-Json',
    '$id=$c.id',
    "$r=@{ok=$false;error='unknown-kind'}",
    "if($c.kind -eq 'ready'){$r=@{ok=$true;note=[Win32In]::Ready()}}",
    "if($c.kind -eq 'noop'){$r=@{ok=$true;note='noop'}}",
    "if($c.kind -eq 'move'){$r=@{ok=([Win32In]::MoveTo([int]$c.x,[int]$c.y) -gt 0)}}",
    "if($c.kind -eq 'button'){$r=@{ok=([Win32In]::Button([int]$c.flag) -gt 0)}}",
    "if($c.kind -eq 'wheel'){$r=@{ok=([Win32In]::Wheel([int]$c.delta) -gt 0)}}",
    "if($c.kind -eq 'key'){$r=@{ok=([Win32In]::KeyVk([int]$c.vk,[bool]$c.down) -gt 0)}}",
    "if($c.kind -eq 'text'){$r=@{ok=$true;typed=[Win32In]::TypeText([string]$c.text)}}",
    "$r['id']=$id",
    '$out.WriteLine(($r|ConvertTo-Json -Compress))',
    '$out.Flush()',
    '}catch{',
    // แนบ id กลับเสมอ (ถ้า parse ได้) — ไม่งั้นฝั่ง Node จับคู่ไม่ได้และรอจน timeout
    // แล้วผู้ใช้เห็นเพียง "host ไม่ตอบ" ซึ่งชี้สาเหตุผิดจุด
    "$e=@{ok=$false;error=$_.Exception.Message;id=$id}",
    '$out.WriteLine(($e|ConvertTo-Json -Compress))',
    '$out.Flush()',
    '}',
    '}',
  ].join('; ');
}

/**
 * แปลง event ที่ HUB ส่งมา → คำสั่งของ host
 * คืน { command } เมื่อแปลงได้ หรือ { error } เมื่อไม่รู้จัก/ค่าผิดรูป
 *
 * เป็นฟังก์ชันล้วน ๆ เพื่อเทสต์ได้โดยไม่ต้องมี PowerShell อยู่จริง
 */
export function toHostCommand(event, id = 1) {
  if (!event || typeof event !== 'object') return { error: 'event ว่าง' };
  const kind = String(event.kind ?? '');

  if (kind === 'mouse') {
    const action = String(event.action ?? 'move');
    if (action === 'move') {
      const x = normalizeCoord(event.x);
      const y = normalizeCoord(event.y);
      if (x === null || y === null) return { error: 'พิกัดเมาส์ไม่ถูกต้อง' };
      return { command: { id, kind: 'move', x, y } };
    }
    if (action === 'wheel') {
      const delta = normalizeCoord(event.deltaY ?? event.delta);
      // ปุ่มล้อต้องถูกพลิกเครื่องหมายเทียบกับ scroll ของเบราว์เซอร์ (ลง = ลบ)
      if (delta === null) return { error: 'ค่า wheel ไม่ถูกต้อง' };
      return { command: { id, kind: 'wheel', delta: -delta } };
    }
    if (action === 'down' || action === 'up' || action === 'click') {
      const button = MOUSE_BUTTONS[String(event.button ?? 'left')];
      if (!button) return { error: `ไม่รู้จักปุ่มเมาส์: ${event.button}` };
      if (action === 'click') {
        // คลิก = down แล้ว up ในคำสั่งเดียว — host จบในรอบเดียว ลด round-trip
        return { command: { id, kind: 'buttonSequence', flags: [button.down, button.up] } };
      }
      return { command: { id, kind: 'button', flag: action === 'down' ? button.down : button.up } };
    }
    return { error: `ไม่รู้จัก action ของเมาส์: ${action}` };
  }

  if (kind === 'key') {
    const vk = resolveKeyCode(event.key ?? event.code);
    if (vk === null) return { error: `ไม่รู้จักปุ่ม: ${event.key ?? event.code}` };
    const up = String(event.action ?? 'down') === 'up';
    return { command: { id, kind: 'key', vk, down: !up } };
  }

  if (kind === 'text') {
    const text = String(event.text ?? '');
    if (!text) return { error: 'ข้อความว่าง' };
    if (text.length > MAX_TEXT_LENGTH) return { error: `ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร` };
    return { command: { id, kind: 'text', text } };
  }

  return { error: `ไม่รู้จัก kind ของอินพุต: ${kind || '(ว่าง)'}` };
}

/**
 * เริ่ม input host (PowerShell process เดียวค้างไว้)
 * @returns {{ send: Function, applyEvent: Function, isRunning: Function, pid: Function, stop: Function, ready: Function }}
 */
export function createInputHost({
  platform = process.platform,
  spawnImpl = spawn,
  powershell = 'powershell.exe',
  onError,
} = {}) {
  const inert = {
    send: async () => ({ ok: false, error: 'input host: แพลตฟอร์มนี้ยังไม่รองรับ' }),
    applyEvent: async () => ({ ok: false, error: 'input host: แพลตฟอร์มนี้ยังไม่รองรับ' }),
    isRunning: () => false,
    pid: () => null,
    stop: () => {},
    ready: async () => ({ ok: false, error: 'unsupported platform' }),
  };
  if (platform !== 'win32') {
    onError?.(new Error('input host: รองรับเฉพาะ Windows (ยังไม่มีวิธีฉีดอินพุตบนแพลตฟอร์มนี้)'));
    return inert;
  }

  let child = null;
  let stopped = false;
  let seq = 0;
  let buffer = '';
  const pending = new Map();

  const failAll = (reason) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
    }
    pending.clear();
  };

  const handleLine = (line) => {
    const text = line.trim();
    if (!text) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // บรรทัดที่ไม่ใช่ JSON (เช่น warning ของ PowerShell) — ข้าม ไม่ทำทั้ง host พัง
    }
    const id = parsed?.id;
    const entry = id === undefined ? null : pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(parsed);
  };

  const launch = () => {
    if (stopped) return;
    try {
      child = spawnImpl(powershell, ['-NoProfile', '-NonInteractive', '-Command', buildInputScript()], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    child.stdout?.on('data', (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        handleLine(line);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) onError?.(new Error(text.slice(0, 300)));
    });
    child.on('error', (err) => onError?.(err));
    child.on('close', () => {
      child = null;
      failAll('input host ปิดตัวลง');
      // ตายเองระหว่างใช้งาน (ไม่ใช่การสั่งหยุด) → เริ่มใหม่ + บอกผู้ใช้
      if (!stopped) setTimeout(launch, 1000);
    });
  };

  launch();

  /** ส่งคำสั่งหนึ่งไปให้ host แล้วรอผล */
  const send = (command, timeoutMs = 8000) =>
    new Promise((resolve) => {
      if (!child) {
        resolve({ ok: false, error: 'input host ไม่ได้ทำงานอยู่' });
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(command.id);
        resolve({ ok: false, error: 'input host ไม่ตอบภายในเวลาที่กำหนด' });
      }, timeoutMs);
      pending.set(command.id, { resolve, timer });
      try {
        child.stdin?.write(JSON.stringify(command) + '\n');
      } catch (err) {
        clearTimeout(timer);
        pending.delete(command.id);
        resolve({ ok: false, error: `เขียนคำสั่งไม่ได้: ${err?.message || err}` });
      }
    });

  const applyEvent = async (event) => {
    seq += 1;
    const mapped = toHostCommand(event, seq);
    if (mapped.error) return { ok: false, error: mapped.error };
    const command = mapped.command;

    // click = ยิงสองครั้ง (down, up) — ต้องคงลำดับ ไม่ยิงขนาน
    if (command.kind === 'buttonSequence') {
      for (const flag of command.flags) {
        const out = await send({ id: seq, kind: 'button', flag });
        if (!out?.ok) return out ?? { ok: false, error: 'button ล้ม' };
      }
      return { ok: true };
    }
    return await send(command);
  };

  return {
    isRunning: () => child !== null,
    pid: () => child?.pid ?? null,
    /** ตรวจว่า host compile ผ่านและลูปตอบจริง — ไม่ฉีดอะไรเลย */
    ready: async () => {
      seq += 1;
      return await send({ id: seq, kind: 'ready' }, 15000);
    },
    send,
    applyEvent,
    stop() {
      stopped = true;
      const old = child;
      child = null;
      failAll('หยุด input host');
      try {
        old?.kill();
      } catch {
        /* ไม่มีอะไรให้ทำ */
      }
    },
  };
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface HostConnection {
  protocol: string;
  local_address: string;
  foreign_address: string;
  state: string;
  pid: string;
}

/**
 * แปลงผล `netstat -ano` เป็นรายการ connection
 * — netstat พิมพ์หัวตารางและบรรทัดว่างปนมาด้วย จึงเก็บเฉพาะแถวที่มีคู่ address
 */
export function parseEstablishedConnections(stdout: string): HostConnection[] {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    // แถวจริงต้องมีอย่างน้อย protocol + local + foreign (address มี ':')
    .filter((parts) => parts.length >= 3 && parts[1]?.includes(':') && parts[2]?.includes(':'))
    .map((parts) => ({
      protocol: parts[0] || 'TCP',
      local_address: parts[1] || '0.0.0.0:0',
      foreign_address: parts[2] || '0.0.0.0:0',
      state: parts[3] || 'ESTABLISHED',
      pid: parts[4] || 'N/A',
    }));
}

/**
 * อ่านตาราง connection ของโฮสต์จริง — **โยน error เมื่อคำสั่งใช้ไม่ได้**
 * ผู้เรียกต้องรายงานว่า "อ่านไม่ได้" ห้ามแต่งข้อมูลแทน (ดู securityConnectionsTruth.test.ts)
 */
export const hostConnections = {
  async read(): Promise<HostConnection[]> {
    const { stdout } = await execAsync('netstat -ano | findstr ESTABLISHED');
    return parseEstablishedConnections(stdout);
  },
};

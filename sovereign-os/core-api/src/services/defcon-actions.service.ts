import type { DefconAction, DefconLevel } from './defcon-engine.service';

// ── DEFCON Controlled Dry-Run: มาตรการทางกายภาพ → ผ่าน actuation sandbox ──
// DEFCON_DRY_RUN=true (default): คำสั่ง relay/exec ทั้งหมดเปลี่ยนเป็น actuator sandbox
// (load-1, patrol-light, wan-link) — ดูผลลัพธ์ได้ใน actuation history + envelope ทำงานจริง
// DEFCON_DRY_RUN=false: พฤติกรรมเดิม (MQTT จริง + exec)

export interface DefconActionDeps {
  dryRun: boolean;
  executeActuator: (id: string, state: 'on' | 'off', reason: string) => Promise<{ ok: boolean; rule?: string }>;
  backup: () => Promise<unknown>;
  meshReplicate: () => Promise<unknown>;
  sendTelegramMsg: (text: string) => Promise<unknown>;
  mqttRelay: (relayId: string, state: '1' | '0') => void;
  execCmd: (cmd: string) => Promise<unknown>;
  log: (detail: string) => void;
}

const SANDBOX_NON_ESSENTIAL = ['load-1', 'patrol-light'];

export async function runDefconAction(level: DefconLevel, action: DefconAction, deps: DefconActionDeps): Promise<void> {
  const dry = deps.dryRun;
  const tag = dry ? '[DRY-RUN]' : '[REAL]';
  const log = (detail: string) => deps.log(`${tag} ${detail}`);

  switch (action.id) {
    case 'charge_battery':
      if (dry) {
        const r = await deps.executeActuator('load-1', 'on', `DEFCON ${level} charge_battery (dry-run)`);
        log(`sandbox charge → load-1 ON (${r.ok ? 'ok' : `blocked: ${r.rule}`})`);
      } else {
        deps.mqttRelay(process.env.DEFCON_CHARGE_RELAY_ID || 'relay1', '1');
        log(`MQTT publish → charge relay ON (${process.env.DEFCON_CHARGE_RELAY_ID || 'relay1'})`);
      }
      break;
    case 'telegram_stats':
      await deps.sendTelegramMsg(`⚠️ DEFCON ${level}: Threat Index สูงขึ้น — ${dry ? 'dry-run' : 'ชาร์จแบตเตอรี่ไว้แล้ว'} + สถิติพลังงานอยู่ในหน้า Energy`);
      break;
    case 'backup_cold_storage':
      // ปลอดภัยทั้งสองโหมด: backup จริงเสมอ + replicate ไปนอกสถานที่ (ของจริงทั้งคู่)
      await deps.backup();
      log('backup created');
      try {
        await deps.meshReplicate();
        log('mesh replicate ok');
      } catch (err) {
        log(`mesh replicate failed: ${err instanceof Error ? err.message : err}`);
      }
      break;
    case 'relays_off':
      if (dry) {
        for (const id of SANDBOX_NON_ESSENTIAL) {
          const r = await deps.executeActuator(id, 'off', `DEFCON ${level} relays_off (dry-run)`);
          log(`sandbox non-essential → ${id} OFF (${r.ok ? 'ok' : `blocked: ${r.rule}`})`);
        }
      } else {
        for (const relayId of (process.env.DEFCON_NON_ESSENTIAL_RELAYS || 'relay2,relay3').split(',')) {
          const id = relayId.trim();
          if (id) deps.mqttRelay(id, '0');
        }
        log('non-essential relays → OFF');
      }
      break;
    case 'wan_disconnect':
      if (dry) {
        const r = await deps.executeActuator('wan-link', 'off', `DEFCON ${level} wan_disconnect (dry-run)`);
        log(`sandbox wan → wan-link OFF (${r.ok ? 'ok' : `blocked: ${r.rule}`})`);
      } else {
        if (process.env.DEFCON_WAN_DISCONNECT_CMD) {
          await deps.execCmd(process.env.DEFCON_WAN_DISCONNECT_CMD);
          log('WAN disconnected');
        } else {
          log('DEFCON_WAN_DISCONNECT_CMD not set — skipped');
        }
      }
      break;
    case 'security_on':
      if (dry) {
        const r = await deps.executeActuator('patrol-light', 'on', `DEFCON ${level} security_on (dry-run)`);
        log(`sandbox security → patrol-light ON (${r.ok ? 'ok' : `blocked: ${r.rule}`})`);
      } else {
        deps.mqttRelay(process.env.DEFCON_SECURITY_RELAY_ID || 'relay4', '1');
        log(`MQTT publish → security relay ON (${process.env.DEFCON_SECURITY_RELAY_ID || 'relay4'})`);
      }
      break;
    default:
      log('unknown action');
  }
}
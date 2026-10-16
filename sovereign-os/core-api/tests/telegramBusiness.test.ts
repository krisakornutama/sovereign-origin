// tests/telegramBusiness.test.ts
// แจ้งเตือนธุรกิจ → ห้องเฉพาะธุรกิจ (16/10/69)
// เจ้าของ: "ตัวเดียวกับส่งข้อมูลเรื่องบ้าง แต่อันนี้แยกเฉพาะห้อง เพราะเกี่ยวกับธุรกิจโดยตรง"
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBusinessAlert, type BusinessEventKind } from '../src/services/telegram-alert.service';
import { validateTelegramChatId, maskChatId } from '../src/services/telegram-credentials.service';

describe('validateTelegramChatId', () => {
  it('รับหมายเลขห้องที่ถูกต้องทุกแบบที่ Telegram ใช้', () => {
    // ผู้ใช้/กลุ่ม = บวก · supergroup/ช่อง = ติดลบขึ้นต้นด้วย -100
    for (const ok of ['123456789', '-123456789', '-1001234567890', '  -1009876543210  ']) {
      assert.equal(validateTelegramChatId(ok), '', `"${ok}" ต้องผ่าน`);
    }
  });

  it('ปฏิเสธค่าที่ใส่มาผิด พร้อมบอกเหตุผล', () => {
    assert.match(validateTelegramChatId(''), /ยังไม่ได้ใส่/, 'ว่าง = ยังไม่ได้ใส่');
    assert.match(validateTelegramChatId('abc'), /ตัวเลขล้วน/, 'ตัวอักษร = ผิด');
    assert.match(validateTelegramChatId('@mygroup'), /ตัวเลขล้วน/, 'ชื่อกลุ่ม @ = ผิด ต้องใช้หมายเลข');
    assert.match(validateTelegramChatId('12.5'), /ตัวเลขล้วน/, 'ทศนิยม = ผิด');
    assert.match(validateTelegramChatId('-100' + '1'.repeat(30)), /ยาวผิดปกติ/, 'ยาวเกินจริง = ผิด');
    assert.match(validateTelegramChatId('12 345'), /ตัวเลขล้วน/, 'เว้นวรรค = ผิด');
  });
});

describe('maskChatId', () => {
  it('ไม่คืนหมายเลขห้องเต็มกลับไปหน้าเว็บ', () => {
    assert.equal(maskChatId(''), '', 'ยังไม่ได้ตั้ง = ว่าง');
    assert.equal(maskChatId('-1001234567890'), '••••890', 'เหลือ 3 ตัวท้าย');
    assert.ok(!maskChatId('-1001234567890').includes('1001'), 'ต้องไม่เหลือหัวห้องให้เดาต่อ');
    assert.equal(maskChatId('12345'), '••••', 'สั้นมาก = mask ทั้งหมด');
  });
});

describe('formatBusinessAlert', () => {
  it('ใส่ไอคอนและหัวข้อของแต่ละชนิดเหตุการณ์', () => {
    const cases: Array<[BusinessEventKind, string]> = [
      ['order', 'ออเดอร์ใหม่'],
      ['shipping', 'ส่งของแล้ว'],
      ['warranty', 'ประกัน'],
      ['stock', 'สินค้าใกล้หมด'],
      ['info', 'แจ้งเตือน'],
    ];
    for (const [kind, label] of cases) {
      const out = formatBusinessAlert(kind, 'หัวข้อทดสอบ');
      assert.match(out, /<b>.*<\/b>/, `${kind} ต้องมีหัวข้อหนา`);
      assert.ok(out.includes(label), `${kind} ต้องมีคำว่า "${label}"`);
      assert.ok(out.includes('หัวข้อทดสอบ'), `${kind} ต้องมีเนื้อหา`);
    }
  });

  it('รายละเอียดต้องต่อท้ายคนละย่อหน้า และไม่ใส่ถ้าว่าง', () => {
    const withDetail = formatBusinessAlert('order', 'A-001', 'ลูกค้า: สมชาย');
    assert.ok(withDetail.includes('ลูกค้า: สมชาย'));
    assert.ok(withDetail.includes('\n\n'), 'รายละเอียดต้องแยกย่อหน้า อ่านง่ายบนมือถือ');
    assert.ok(!formatBusinessAlert('order', 'A-001').includes('\n\n'), 'ไม่มีรายละเอียด = ไม่ต้องเว้นวรรคเปล่า');
  });

  it('ชนิดที่ไม่รู้จักต้องยังทำงานได้ (ไม่ throw) — กันข้อมูลเก่าใน localStorage ทำแอปพัง', () => {
    const out = formatBusinessAlert('ไม่รู้จัก' as BusinessEventKind, 'ทดสอบ');
    assert.ok(out.includes('ทดสอบ'), 'ต้องยังส่งข้อความออกได้');
  });
});

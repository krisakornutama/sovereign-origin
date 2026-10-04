import './setup-env';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Knowledge Base — CRUD + ไฟล์บนดิสก์ (mock suite, ไม่แตะ DB จริง)
//
// ครอบ: validate type (LINK/VIDEO/PDF/TXT/WEBPAGE/NOTE) · title required
//        parseTags (array/string/ล้วน·เกิน 20) · preview ตัด 200 ตัวในลิสต์ vs เนื้อหาเต็มตอนเปิด
//        PUT แก้แล้วไม่ทับ field ที่ไม่ได้ส่ง · DELETE ลบแถวและลบไฟล์บนดิสก์
//        import: URL ต้องขึ้นต้น http(s) + htmlToText/htmlTitle (script/style ถูกตัด)
//        **path traversal ผ่าน /file/:file และ /uploads/:file** (โมดูลนี้อ่าน/เขียนไฟล์จริง)
//
// ทำไมต้องมี (audit 3/10/69): knowledge เป็นหลุมใหญ่สุดของระบบ — 1,083 บรรทัด ครอบแค่ 13%
// และเป็นโมดูลที่แตะระบบไฟล์โดยตรง
// ────────────────────────────────────────────────────────────────────────────

let server: TestServer;
let filesServer: TestServer;
let knowledgeDir: string;

const TOKEN = makeToken('SUPERADMIN');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const items = new Map<string, any>();
let seq = 0;
const nid = () => `k-${++seq}`;

before(async () => {
  // KNOWLEDGE_DIR ต้องตั้งก่อนโมดูล service ถูกโหลด (อ่านค่าเดียวตอน import)
  knowledgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-knowledge-'));
  process.env.KNOWLEDGE_DIR = knowledgeDir;
  fs.mkdirSync(path.join(knowledgeDir, 'uploads'), { recursive: true });

  mockModel(prisma, 'knowledgeItem', {
    findMany: async ({ where }: any = {}) => {
      let list = [...items.values()];
      if (where?.type) list = list.filter((r) => r.type === where.type);
      return list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    findUnique: async ({ where }: any) => items.get(where.id) ?? null,
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), updated_at: new Date(), ...data };
      items.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = items.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updated_at: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const row = items.get(where.id);
      if (!row) throw new Error('not found');
      items.delete(where.id);
      return row;
    },
  });

  const { default: knowledgeRoutes, htmlToText, htmlTitle } = await import('../src/modules/knowledge/knowledge.routes');
  const { default: knowledgeFilesRoutes } = await import('../src/modules/knowledge/knowledge-files.routes');

  // helper ที่ export มาให้ทดสอบตรง ๆ (ไม่ต้องผ่าน HTTP)
  Object.assign(globalThis as any, { __kHtmlToText: htmlToText, __kHtmlTitle: htmlTitle });

  server = await createTestServer((app) => app.use('/api/knowledge', knowledgeRoutes));
  filesServer = await createTestServer((app) => app.use('/api/knowledge', knowledgeFilesRoutes));
});

after(async () => {
  if (server) await server.close();
  if (filesServer) await filesServer.close();
  try {
    fs.rmSync(knowledgeDir, { recursive: true, force: true });
  } catch {}
  delete process.env.KNOWLEDGE_DIR;
});

const htmlToText = (h: string) => (globalThis as any).__kHtmlToText(h);
const htmlTitle = (h: string) => (globalThis as any).__kHtmlTitle(h);

function post(url: string, body: any) {
  return fetch(url, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ────────────────────────────────────────────────────────────────────────────
describe('validateType', () => {
  test('รับเฉพาะ 6 ชนิดที่ประกาศไว้ (ไม่ขึ้นตามตัวพิมพ์)', async () => {
    for (const ok of ['LINK', 'VIDEO', 'PDF', 'TXT', 'WEBPAGE', 'NOTE']) {
      const res = await post(server.baseUrl + '/api/knowledge/items', { type: ok, title: `t-${ok}` });
      assert.strictEqual(res.status, 201, `type=${ok}`);
    }
    for (const bad of ['EXE', 'SCRIPT', 'link2', '']) {
      const res = await post(server.baseUrl + '/api/knowledge/items', { type: bad, title: 'x' });
      assert.strictEqual(res.status, 400, `type=${bad}`);
    }
  });

  test('ตัวพิมพ์เล็กถูกแปลงเป็นตัวใหญ่ก่อนตรวจ', async () => {
    const res = await post(server.baseUrl + '/api/knowledge/items', { type: 'link', title: 'lowercase' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await res.json()).item.type, 'LINK');
  });
});

describe('title required', () => {
  test('ไม่ส่ง title / ส่งเป็นช่องว่าง = 400', async () => {
    for (const body of [{ type: 'NOTE' }, { type: 'NOTE', title: '' }, { type: 'NOTE', title: '   ' }]) {
      const res = await post(server.baseUrl + '/api/knowledge/items', body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
    }
  });
});

describe('parseTags', () => {
  test('ส่งเป็น array = ใช้ค่าใน array', async () => {
    const res = await post(server.baseUrl + '/api/knowledge/items', {
      type: 'NOTE', title: 'tags array', tags: ['  a  ', '', 'b'],
    });
    assert.deepStrictEqual((await res.json()).item.tags, ['a', 'b']);
  });

  test('ส่งเป็น string = แยกด้วยจุลภาค/จุลภาคจีน', async () => {
    const res = await post(server.baseUrl + '/api/knowledge/items', {
      type: 'NOTE', title: 'tags string', tags: ' a, b，c ',
    });
    assert.deepStrictEqual((await res.json()).item.tags, ['a', 'b', 'c']);
  });

  test('ตัดให้เหลือ 20 แท็ก (กันยัดจอ/กัน payload บวม)', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const res = await post(server.baseUrl + '/api/knowledge/items', { type: 'NOTE', title: 'many', tags: many });
    assert.strictEqual((await res.json()).item.tags.length, 20);
  });

  test('ชนิดอื่นที่ไม่ใช่ array/string = ไม่ใส่แท็ก แต่ไม่ error', async () => {
    for (const bad of [123, null, { a: 1 }]) {
      const res = await post(server.baseUrl + '/api/knowledge/items', { type: 'NOTE', title: 'tags แปลก', tags: bad });
      assert.strictEqual(res.status, 201, JSON.stringify(bad));
      assert.deepStrictEqual((await res.json()).item.tags, []);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /items + /items/:id', () => {
  test('ลิสต์ส่ง preview 200 ตัว แต่เปิด item เดียวได้เนื้อหาเต็ม', async () => {
    await post(server.baseUrl + '/api/knowledge/items', { type: 'TXT', title: 'ยาว', content: 'A'.repeat(500) });
    const list: any = await (await fetch(server.baseUrl + '/api/knowledge/items', { headers: AUTH })).json();
    const long = list.find((r: any) => r.title === 'ยาว');
    assert.strictEqual(long.content, undefined, 'ลิสต์ต้องไม่ดัน content เต็มลงไปกับทุกแถว');
    assert.strictEqual(long.preview.length, 200);

    const one: any = await (await fetch(`${server.baseUrl}/api/knowledge/items/${long.id}`, { headers: AUTH })).json();
    assert.strictEqual(one.content.length, 500, 'เปิดเดี่ยวได้เนื้อหาเต็ม');
  });

  test('filter ด้วย type ที่ถูกต้อง', async () => {
    const res = await fetch(server.baseUrl + '/api/knowledge/items?type=VIDEO', { headers: AUTH });
    const body: any = await res.json();
    assert.ok(body.every((r: any) => r.type === 'VIDEO'));
  });

  test('type ที่ไม่รู้จัก = ไม่กรอง (คืนทั้งหมด) ไม่ error', async () => {
    const res = await fetch(server.baseUrl + '/api/knowledge/items?type=BOGUS', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).length > 0);
  });

  test('id ที่ไม่มี = 404', async () => {
    const res = await fetch(server.baseUrl + '/api/knowledge/items/nope', { headers: AUTH });
    assert.strictEqual(res.status, 404);
  });

  test('ไม่ต้อง login = 401', async () => {
    assert.strictEqual((await fetch(server.baseUrl + '/api/knowledge/items')).status, 401);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('PUT /items/:id — แก้เฉพาะ field ที่ส่งมา', () => {
  test('ส่งมาแค่ title = notes/content เดิมต้องไม่ถูกทับ', async () => {
    const created: any = await (await post(server.baseUrl + '/api/knowledge/items', {
      type: 'NOTE', title: 'เดิม', content: 'เนื้อหาเดิม', notes: 'บันทึกเดิม',
    })).json();

    const res = await fetch(`${server.baseUrl}/api/knowledge/items/${created.item.id}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ใหม่' }),
    });
    assert.strictEqual(res.status, 200);
    const row = items.get(created.item.id);
    assert.strictEqual(row.title, 'ใหม่');
    assert.strictEqual(row.content, 'เนื้อหาเดิม');
    assert.strictEqual(row.notes, 'บันทึกเดิม');
  });

  test('ส่ง url = "" คือล้างค่าเป็น null (ไม่ใช่เก็บสตริงว่าง)', async () => {
    const created: any = await (await post(server.baseUrl + '/api/knowledge/items', {
      type: 'LINK', title: 'มีลิงก์', url: 'https://example.com',
    })).json();
    await fetch(`${server.baseUrl}/api/knowledge/items/${created.item.id}`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '  ' }),
    });
    assert.strictEqual(items.get(created.item.id).url, null);
  });

  test('แก้ id ที่ไม่มี = 404 · type ใหม่ผิด = 400', async () => {
    assert.strictEqual(
      (await fetch(`${server.baseUrl}/api/knowledge/items/nope`, {
        method: 'PUT', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }),
      })).status,
      404,
    );
    const created: any = await (await post(server.baseUrl + '/api/knowledge/items', { type: 'NOTE', title: 'ok' })).json();
    assert.strictEqual(
      (await fetch(`${server.baseUrl}/api/knowledge/items/${created.item.id}`, {
        method: 'PUT', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'BAD' }),
      })).status,
      400,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('DELETE /items/:id — ลบแถวและไฟล์บนดิสก์', () => {
  test('มี file_path = ลบไฟล์ด้วย แล้วรายการหาย', async () => {
    fs.writeFileSync(path.join(knowledgeDir, 'uploads', 'k-file.pdf'), 'dummy');
    const created: any = await (await post(server.baseUrl + '/api/knowledge/items', { type: 'PDF', title: 'มีไฟล์' })).json();
    items.get(created.item.id).file_path = 'uploads/k-file.pdf';

    const res = await fetch(`${server.baseUrl}/api/knowledge/items/${created.item.id}`, { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(items.has(created.item.id), false);
    assert.strictEqual(fs.existsSync(path.join(knowledgeDir, 'uploads', 'k-file.pdf')), false, 'ไฟล์ต้องถูกลบด้วย');
  });

  test('file_path ที่พยายามหลุดออกนอก root = แถวถูกลบ แต่ไฟล์ข้างนอกยังอยู่', async () => {
    const outside = path.join(path.dirname(knowledgeDir), 'outside.txt');
    fs.writeFileSync(outside, 'must survive');
    const created: any = await (await post(server.baseUrl + '/api/knowledge/items', { type: 'TXT', title: 'หลุด' })).json();
    items.get(created.item.id).file_path = '../outside.txt';

    const res = await fetch(`${server.baseUrl}/api/knowledge/items/${created.item.id}`, { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(fs.existsSync(outside), true, 'ไฟล์นอก knowledge dir ต้องไม่ถูกแตะ');
    fs.rmSync(outside, { force: true });
  });

  test('id ที่ไม่มี = 404', async () => {
    const res = await fetch(`${server.baseUrl}/api/knowledge/items/nope`, { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /import — validate URL', () => {
  test('URL ที่ไม่ขึ้นต้นด้วย http(s) = 400 (กัน file:// และ javascript:)', async () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y', 'example.com', '']) {
      const res = await post(server.baseUrl + '/api/knowledge/import', { url: bad });
      assert.strictEqual(res.status, 400, `url=${bad}`);
    }
  });
});

describe('htmlToText / htmlTitle (pure helpers)', () => {
  test('ตัด script/style/comment ออก — เนื้อหา JS ไม่หลุดเป็นข้อความ', () => {
    const html = `<html><head><style>.a{color:red}</style><script>alert('xss')</script></head>
      <body><!-- คอมเมนต์ --><p>สวัสดี</p><p>โลก</p></body></html>`;
    const text = htmlToText(html);
    assert.match(text, /สวัสดี/);
    assert.match(text, /โลก/);
    assert.doesNotMatch(text, /alert|xss|color:red|คอมเมนต์/);
  });

  test('แปลง entity พื้นฐาน', () => {
    const text = htmlToText('<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &nbsp;f</p>');
    assert.match(text, /a & b <c> "d" 'e'/);
  });

  test('htmlTitle: รองรับทั้ง og:title และ <title>', () => {
    assert.strictEqual(htmlTitle('<meta property="og:title" content="OG ชนะ"><title>Title</title>'), 'OG ชนะ');
    assert.strictEqual(htmlTitle('<title>  ชื่อหน้า  </title>'), 'ชื่อหน้า');
    assert.strictEqual(htmlTitle('<p>ไม่มีชื่อ</p>'), '');
  });

  test('html ว่าง/ไม่ใช่ string = คืนค่าว่าง ไม่ throw', () => {
    assert.strictEqual(htmlToText(''), '');
    assert.strictEqual(htmlToText(undefined as any), '');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('ไฟล์บนดิสก์ — กัน path traversal', () => {
  test('อ่านไฟล์ในโฟลเดอร์ได้', async () => {
    fs.writeFileSync(path.join(knowledgeDir, 'note.txt'), 'เนื้อหาโน้ต');
    const res = await fetch(filesServer.baseUrl + '/api/knowledge/file/note.txt', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { content: 'เนื้อหาโน้ต' });
  });

  test('พยายามหลุดออกนอก KNOWLEDGE_DIR = 400 (ทั้งอ่านและเขียน)', async () => {
    const secret = path.join(path.dirname(knowledgeDir), 'secret.txt');
    fs.writeFileSync(secret, 'TOP SECRET');
    try {
      const read = await fetch(`${filesServer.baseUrl}/api/knowledge/file/${encodeURIComponent('..' + path.sep + 'secret.txt')}`, { headers: AUTH });
      assert.strictEqual(read.status, 400);
      assert.strictEqual(fs.readFileSync(secret, 'utf-8'), 'TOP SECRET', 'ห้ามอ่านไฟล์นอก root');

      const write = await fetch(`${filesServer.baseUrl}/api/knowledge/file/${encodeURIComponent('..' + path.sep + 'secret.txt')}`, {
        method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'HACKED' }),
      });
      assert.strictEqual(write.status, 400);
      assert.strictEqual(fs.readFileSync(secret, 'utf-8'), 'TOP SECRET', 'ห้ามเขียนทับไฟล์นอก root');
    } finally {
      fs.rmSync(secret, { force: true });
    }
  });

  test('/uploads/:file ก็ถูกปฏิเสธเช่นกัน (ไม่ leak ไฟล์ข้างนอก)', async () => {
    const outside = path.join(path.dirname(knowledgeDir), 'outside-secret.txt');
    fs.writeFileSync(outside, 'TOP SECRET');
    try {
      const res = await fetch(
        `${server.baseUrl}/api/knowledge/uploads/${encodeURIComponent('..' + path.sep + '..' + path.sep + 'outside-secret.txt')}`,
        { headers: AUTH },
      );
      // แก้แล้ว 3/10/69: เดิม resolveInsideRoot throw ถูกจับรวมกับ sendFile → 500
      // (ไฟล์ไม่หลุด แต่ log รบกวนตอนมีคนสแกน) · ตอนนี้แยกออกตอบ 400 ตรง ๆ
      assert.strictEqual(res.status, 400);
      const body: any = await res.json();
      assert.match(body.error, /Invalid file path/);
      assert.doesNotMatch(JSON.stringify(body), /TOP SECRET/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('รายการไฟล์เฉพาะ .txt/.md', async () => {
    fs.writeFileSync(path.join(knowledgeDir, 'a.md'), '# md');
    fs.writeFileSync(path.join(knowledgeDir, 'b.pdf'), 'pdf');
    const res = await fetch(filesServer.baseUrl + '/api/knowledge/files', { headers: AUTH });
    const body: any = await res.json();
    assert.ok(body.files.includes('a.md'));
    assert.ok(body.files.includes('note.txt'));
    assert.ok(!body.files.includes('b.pdf'), 'PDF ไม่ควรอยู่ในรายการไฟล์ข้อความ');
  });

  test('ไฟล์ไม่มีจริง = 404', async () => {
    const res = await fetch(filesServer.baseUrl + '/api/knowledge/file/ghost.txt', { headers: AUTH });
    assert.strictEqual(res.status, 404);
  });
});

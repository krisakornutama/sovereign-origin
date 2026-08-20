import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDimeStatementText,
  extractUsStocksSection,
  detectStatementPeriod,
  toNumber,
  parseStockRow,
  validateStockNumbers,
  pickNumberWindow,
  pickNumberWindowMath,
  extractNumbers,
  parseStockGroup,
  resolvePriceByRatio,
  extractRowMetrics,
  extractStatementSummary,
  extractSectorAllocations,
  emptyStatementSummary,
} from '../src/services/dime-parser.service';

// ── fixtures ──

const TH_STATEMENT = `Dime! Statement
รายงานยอดคงเหลือประจำเดือนสิงหาคม 2569
บัญชี: 123-456789

US Stocks (หุ้นสหรัฐฯ)
Symbol  Company             Shares  Avg Cost  Last Price  Market Value
AAPL    APPLE INC.          120     45.30     44.50       5,340.00
MSFT    MICROSOFT CORP      60      150.00    160.25      9,615.00
BRK.B   BERKSHIRE HATHAWAY  25      300.00    310.50      7,762.50
VUSD    VANGUARD S&P 500    200     50.00     55.00       11,000.00

Thai Stocks (หุ้นไทย)
SCB     บมจ.ไทยพาณิชย์      100     120.00    130.00      13,000.00

รวมยอดทั้งหมด (Total)
ขอบคุณที่ใช้บริการ Dime!`;

const EN_STATEMENT = `Dime! Statement of Account
Period: August 2026
Account No: 987-654321

FOREIGN SECURITIES ACCOUNT (US Stocks)
Symbol  Company           Quantity  Avg Cost  Last Price  Market Value
TSLA    TESLA INC         10        200.00    250.00      2,500.00
GOOGL   ALPHABET INC      8         140.50    148.25      1,186.00
NVDA    NVIDIA CORP       15        95.00     102.40      1,536.00

THAI STOCKS
PTT     บมจ.ปตท.         500       32.00     33.50       16,750.00

SUMMARY
Total market value: $5,222.00`;

// ── section ──

test('extractUsStocksSection: ตัดเฉพาะ section หุ้น US (หยุดที่ Thai Stocks)', () => {
  const { sectionFound, sectionText } = extractUsStocksSection(TH_STATEMENT);
  assert.equal(sectionFound, true);
  assert.ok(sectionText.includes('AAPL'), 'ควรมีแถว AAPL');
  assert.ok(sectionText.includes('VUSD'), 'ควรมีแถว VUSD');
  assert.ok(!sectionText.includes('SCB'), 'ห้ามหลุดเข้า section หุ้นไทย');
  assert.ok(!sectionText.includes('รวมยอด'), 'ห้ามหลุดเข้า summary');
});

test('extractUsStocksSection: ใช้ "Foreign Securities Account" เป็นจุดเริ่มได้', () => {
  const { sectionFound, sectionText } = extractUsStocksSection(EN_STATEMENT);
  assert.equal(sectionFound, true);
  assert.ok(sectionText.includes('TSLA'));
  assert.ok(!sectionText.includes('PTT'));
});

test('extractUsStocksSection: ไม่เจอ section → sectionFound false', () => {
  const { sectionFound, sectionText } = extractUsStocksSection('ข้อความไร้สต๊อก');
  assert.equal(sectionFound, false);
  assert.equal(sectionText, '');
});

// ── toNumber ──

test('toNumber: จัดการเครื่องหมายการเงิน/หลักพัน/ติดลบ/ขยะ', () => {
  assert.equal(toNumber('1,234.56'), 1234.56);
  assert.equal(toNumber('$45.30'), 45.3);
  assert.equal(toNumber('฿35'), 35);
  assert.equal(toNumber('(100.00)'), -100);
  assert.equal(toNumber('12.5-'), -12.5);
  assert.equal(toNumber('+250.00'), 250);
  assert.equal(toNumber('1,000'), 1000);
  assert.equal(toNumber('12%'), null);
  assert.equal(toNumber('+12.5%'), null);
  assert.equal(toNumber('1.2k'), null);
  assert.equal(toNumber('USD'), null);
  assert.equal(toNumber('--'), null);
});

// ── parseStockRow ──

test('parseStockRow: ticker → บริษัท → ตัวเลข 4 ตัวท้าย', () => {
  const row = parseStockRow('AAPL    APPLE INC.          120     45.30     44.50       5,340.00');
  assert.ok(row);
  assert.equal(row!.ticker, 'AAPL');
  assert.equal(row!.company, 'APPLE INC.');
  assert.deepEqual(row!.numbers, [120, 45.3, 44.5, 5340]);
});

test('parseStockRow: มีคอลัมน์ % แทรก (P/L) — ไม่นับเป็นตัวเลข', () => {
  const row = parseStockRow('TSLA TESLA INC 10 200.00 250.00 +12.5% 2,500.00');
  assert.ok(row);
  assert.deepEqual(row!.numbers, [10, 200, 250, 2500]);
});

test('parseStockRow: แถวไม่ขึ้นต้นด้วย ticker → null', () => {
  assert.equal(parseStockRow('MICROSOFT CORP 120 45.30 44.50 5,340.00'), null);
  assert.equal(parseStockRow('Symbol Company Shares Avg Cost Last Price Value'), null);
});

// ── validation ──

test('validateStockNumbers: ตัวเลขสมเหตุสมผล → ผ่าน, ผิดปกติ → เหตุผล', () => {
  assert.equal(validateStockNumbers(120, 45.3, 44.5, 5340), null);
  assert.equal(validateStockNumbers(10, 200, 250, 2500), null);
  assert.equal(validateStockNumbers(0, 0, 0, 0), 'shares ต้องมากกว่า 0');
  assert.equal(validateStockNumbers(10, 0, 0, 100), 'ราคา = 0 แต่มูลค่า > 0');
  assert.ok(validateStockNumbers(120, 45.3, 44.5, 9999) !== null, 'value ไม่ตรง qty×price → พลาด');
});

test('pickNumberWindow: ขยับหน้าต่างหา [qty, avg, price, value] ที่ถูกต้อง', () => {
  // คอลัมน์ P/L นำหน้า: [P/L, qty, avg, price, value] → ขยับข้ามตัวแรก
  const w = pickNumberWindow([-500, 10, 200, 250, 2500]);
  assert.deepEqual(w.window, [10, 200, 250, 2500]);
  assert.equal(w.reason, null);
  // P/L ท้ายแถว: [qty, avg, price, value, P/L] → 4 ตัวท้ายเดิมก็ผ่านอยู่แล้ว
  const tail = pickNumberWindow([10, 200, 250, 2500, -500]);
  assert.deepEqual(tail.window, [10, 200, 250, 2500]);
  // ตัวเลขไม่พอ → null + เหตุผลจากหน้าต่างสุดท้าย
  const short = pickNumberWindow([10, 200, 250]);
  assert.equal(short.window, null);
  // 4 ตัวตรงๆ
  const ok = pickNumberWindow([120, 45.3, 44.5, 5340]);
  assert.deepEqual(ok.window, [120, 45.3, 44.5, 5340]);
  // แถวที่ qty=0 → window null พร้อมเหตุผลเกี่ยวกับ shares
  const zero = pickNumberWindow([0, 100, 50, 0]);
  assert.equal(zero.window, null);
  assert.ok(zero.reason!.includes('shares'));
});

// ── detectStatementPeriod ──

test('detectStatementPeriod: ไทยเต็ม + ปี พ.ศ. (สิงหาคม 2569 → 2026-08)', () => {
  assert.equal(detectStatementPeriod('ประจำเดือนสิงหาคม 2569', 'Dime! Statement'), '2026-08');
});

test('detectStatementPeriod: ไทยย่อ (ส.ค. 2569)', () => {
  assert.equal(detectStatementPeriod('ประจำเดือน ส.ค. 2569', ''), '2026-08');
});

test('detectStatementPeriod: อังกฤษจาก subject', () => {
  assert.equal(detectStatementPeriod('blah', 'Dime! Statement August 2026'), '2026-08');
});

test('detectStatementPeriod: รูปแบบตัวเลข', () => {
  assert.equal(detectStatementPeriod('รายงาน 2026/08', ''), '2026-08');
  assert.equal(detectStatementPeriod('รายงาน 08/2026', ''), '2026-08');
});

test('detectStatementPeriod: ไม่เจอ → เดือนปัจจุบัน (fallback)', () => {
  assert.equal(detectStatementPeriod('ไม่มีวันที่', '', new Date(2026, 2, 15)), '2026-03');
});

// ── parseDimeStatementText ──

test('parseDimeStatementText: สเตตเมนต์ไทยเต็มรูปแบบ', () => {
  const r = parseDimeStatementText(TH_STATEMENT);
  assert.equal(r.sectionFound, true);
  assert.equal(r.period, '2026-08');
  assert.equal(r.assets.length, 4);
  assert.equal(r.skipped.length, 0);

  const aapl = r.assets[0];
  assert.equal(aapl.ticker, 'AAPL');
  assert.equal(aapl.company_name, 'APPLE INC.');
  assert.equal(aapl.shares, 120);
  assert.equal(aapl.avg_cost, 45.3);
  assert.equal(aapl.current_price, 44.5);
  assert.equal(aapl.total_value, 5340);
  assert.equal(aapl.currency, 'USD');
  assert.equal(aapl.statement_period, '2026-08');

  const brk = r.assets.find((a) => a.ticker === 'BRK.B');
  assert.ok(brk, 'ticker แบบจุด (BRK.B) ต้องอ่านได้');
  assert.equal(brk!.shares, 25);
});

test('parseDimeStatementText: สเตตเมนต์อังกฤษ + ไม่หลุด summary', () => {
  const r = parseDimeStatementText(EN_STATEMENT);
  assert.equal(r.period, '2026-08');
  assert.equal(r.assets.length, 3);
  assert.ok(!r.assets.some((a) => a.ticker === 'PTT'));
});

test('parseDimeStatementText: แถวที่มูลค่าไม่ตรง qty×price → ข้ามพร้อมเหตุผล', () => {
  const text = `US Stocks
NFLX NETFLIX INC 5 100.00 50.00 999.00
AAPL APPLE INC. 120 45.30 44.50 5,340.00`;
  const r = parseDimeStatementText(text);
  assert.equal(r.assets.length, 1);
  assert.equal(r.assets[0].ticker, 'AAPL');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].ticker, 'NFLX');
  assert.ok(r.skipped[0].reason.includes('ไม่ตรง'));
});

test('parseDimeStatementText: shares = 0 → ข้าม', () => {
  const text = `US Stocks
AMD ADVANCED MICRO DEVICES 0 100.00 50.00 0.00`;
  const r = parseDimeStatementText(text);
  assert.equal(r.assets.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.ok(r.skipped[0].reason.includes('shares'));
});

test('parseDimeStatementText: ไม่มี section → assets ว่าง', () => {
  const r = parseDimeStatementText('ข้อความไม่มีสต๊อก');
  assert.equal(r.sectionFound, false);
  assert.deepEqual(r.assets, []);
  assert.deepEqual(r.skipped, []);
});

// ── ของจริงจาก Dime! (สเตตเมนต์ กรกฎาคม 2569 — ข้อความจาก pdf.js: ไทยอ่านเป็นขยะ, เลขติดกัน) ──

const REAL_JULY_SECTION = `Stock Name
Allocation
in Port
Shares
Average Cost
Price
Total Return (%)
Total Return
Market Value
Common Stock
ASPI
ASP Isotopes Inc. Common Stock
51.31%302.86648024.754.00- 15.81%- 227.451,211.47
LUNR
Intuitive Machines, Inc. Class A
12.37%23.667040016.5712.34- 25.51%- 100.03292.05
POET
POET Technologies Inc. Common
25.61%86.49985899.366.99- 25.35%- 205.30604.63
RDW
Redwire Corporation
10.71%29.354709910.898.62- 20.88%- 66.78253.04
100.00%- 20.25%- 599.562,361.19`;

const REAL_JULY_TEXT = `�,?�,��,?�,Z�,��,,�,� 2569 / July 2026
Offshore Securities Account Monthly Statement
Mr.Krisakorn Utama
2,361.19 USD
Total Balance
1 USD = 33.25 THB
Cash Balance
0.00 USD
Common Stock
Allocation Group by Sector
Basic Materials
1,211.47 USD
51.31%
Technology
604.63 USD
25.61%
Industrials
545.09 USD
23.08%
${REAL_JULY_SECTION}
L&I ETFs
1 You may contact KKP Dime Securities Company Limited
2 If you do not submit any objections
3 The market capitalization of an offshore stock`;

test('extractNumbers: แยกเลขติดกันแบบของจริง + ตัด % ทิ้ง', () => {
  const line = '51.31%302.86648024.754.00- 15.81%- 227.451,211.47';
  assert.deepEqual(extractNumbers(line), [302.86, 648024.75, 4.0, 227.45, 1211.47]);
  assert.deepEqual(extractNumbers('10.71%29.354709910.898.62- 20.88%- 66.78253.04'),
    [29.35, 4709910.89, 8.62, 66.78, 253.04]);
  assert.deepEqual(extractNumbers('12.37%23.667040016.5712.34- 25.51%- 100.03292.05'),
    [23.66, 7040016.57, 12.34, 100.03, 292.05]);
  assert.deepEqual(extractNumbers('25.61%86.49985899.366.99- 25.35%- 205.30604.63'),
    [86.49, 985899.36, 6.99, 205.3, 604.63]);
});

test('pickNumberWindowMath: หา [qty, price, value] จากเลขติดกัน + ขยะแทรก (ของจริง)', () => {
  // ASPI: 302.86 × 4.00 = 1,211.44 ≈ 1,211.47 (avg 2 ทศนิยมก่อน price เกิน 100k → 0)
  assert.deepEqual(pickNumberWindowMath(extractNumbers('51.31%302.86648024.754.00- 15.81%- 227.451,211.47')),
    [302.86, 0, 4.0, 1211.47]);
  // POET: 86.49 × 6.99 = 604.56 ≈ 604.63 (avg ที่ติดกับขยะรวมก้อน → 0)
  assert.deepEqual(pickNumberWindowMath(extractNumbers('25.61%86.49985899.366.99- 25.35%- 205.30604.63')),
    [86.49, 0, 6.99, 604.63]);
  // ตัวเลขไม่พอ/ไม่มีคู่ที่ตรง → null
  assert.equal(pickNumberWindowMath([5, 10, 20]), null);
});

test('resolvePriceByRatio: value ÷ qty แล้วค้น price ในข้อความดิบ (avg = เลขก่อน price)', () => {
  // ASPI: 1211.47 ÷ 302.86 = 4.00 → avg = "24.75" (ท้ายก่อน "4.00" ในข้อความ)
  const aspi = '51.31%302.86648024.754.00- 15.81%- 227.451,211.47';
  assert.deepEqual(resolvePriceByRatio(aspi, extractNumbers(aspi)), [302.86, 24.75, 4.0, 1211.47]);
  // POET: 604.63 ÷ 86.49 = 6.99 → avg = 99.36
  const poet = '25.61%86.49985899.366.99- 25.35%- 205.30604.63';
  assert.deepEqual(resolvePriceByRatio(poet, extractNumbers(poet)), [86.49, 99.36, 6.99, 604.63]);
  // LUNR: 292.05 ÷ 23.66 = 12.34 → avg = 16.57
  const lunr = '12.37%23.667040016.5712.34- 25.51%- 100.03292.05';
  assert.deepEqual(resolvePriceByRatio(lunr, extractNumbers(lunr)), [23.66, 16.57, 12.34, 292.05]);
  // RDW: 253.04 ÷ 29.35 = 8.62 → avg = 10.89
  const rdw = '10.71%29.354709910.898.62- 20.88%- 66.78253.04';
  assert.deepEqual(resolvePriceByRatio(rdw, extractNumbers(rdw)), [29.35, 10.89, 8.62, 253.04]);
  // หา price ในข้อความไม่เจอ → null
  assert.equal(resolvePriceByRatio('302.86 1211.47', [302.86, 1211.47]), null);
});

test('parseStockGroup: แถว 3 บรรทัด (ticker / บริษัท / เลขติดกัน)', () => {
  const lines = [
    'ASPI',
    'ASP Isotopes Inc. Common Stock',
    '51.31%302.86648024.754.00- 15.81%- 227.451,211.47',
    'NEXT',
  ];
  const g = parseStockGroup(lines, 0);
  assert.ok(g);
  assert.equal(g!.row.ticker, 'ASPI');
  assert.equal(g!.row.company, 'ASP Isotopes Inc. Common Stock');
  assert.equal(g!.row.raw, lines[2]);
  assert.equal(g!.nextIndex, 3);
  // ไม่ใช่ ticker → null
  assert.equal(parseStockGroup(['Common Stock'], 0), null);
  assert.equal(parseStockGroup(['USD'], 0), null); // คอลัมน์สกุลเงิน
  // ticker แต่เลขไม่พอ → null
  assert.equal(parseStockGroup(['AAPL', 'Apple Inc.', '12 34'], 0), null);
});

test('parseDimeStatementText: สเตตเมนต์จริงของ Dime! (ก.ค. 2569) → 4 สินทรัพย์', () => {
  const r = parseDimeStatementText(REAL_JULY_TEXT, { subject: '[Dime!] สรุปข้อมูลการลงทุน กรกฎาคม 2569 | Monthly Statement of July 2026' });
  assert.equal(r.sectionFound, true);
  assert.equal(r.period, '2026-07');
  assert.equal(r.assets.length, 4, `ควรได้ 4 กอง แต่ได้ ${r.assets.length}: ${JSON.stringify(r.assets)}`);
  assert.equal(r.skipped.length, 0, `ไม่ควรมี skip: ${JSON.stringify(r.skipped)}`);

  const aspi = r.assets.find((a) => a.ticker === 'ASPI');
  assert.ok(aspi);
  assert.equal(aspi!.shares, 302.86);
  assert.equal(aspi!.current_price, 4.0);
  assert.equal(aspi!.total_value, 1211.47);
  assert.equal(aspi!.company_name, 'ASP Isotopes Inc.'); // ตัด "Common Stock" ทิ้ง

  const rdw = r.assets.find((a) => a.ticker === 'RDW');
  assert.ok(rdw);
  assert.equal(rdw!.total_value, 253.04);

  // มูลค่ารวมตรงกับหน้าแรก (Total Balance 2,361.19 USD)
  const sum = r.assets.reduce((s, a) => s + a.total_value, 0);
  assert.ok(Math.abs(sum - 2361.19) < 0.01, `รวม ${sum} ควร 2361.19`);
});

test('extractUsStocksSection: เริ่มที่ "Stock Name" (กัน "Common Stock" ในชื่อบริษัท)', () => {
  const { sectionFound, sectionText } = extractUsStocksSection(REAL_JULY_TEXT);
  assert.equal(sectionFound, true);
  assert.ok(sectionText.includes('ASPI'));
  assert.ok(sectionText.includes('RDW'));
  assert.ok(!sectionText.includes('Basic Materials'), 'หน้า 1 (สรุป sector) ไม่ควรรั่วเข้ามา');
});

// ── extractRowMetrics — คอลัมน์เพิ่มของแต่ละแถวหุ้น ──

test('extractRowMetrics: allocation % + total return %/$ จากแถวติดกัน (ของจริง)', () => {
  assert.deepEqual(extractRowMetrics('51.31%302.86648024.754.00- 15.81%- 227.451,211.47'),
    { allocationPct: 51.31, totalReturnPct: -15.81, totalReturnUsd: -227.45 });
  assert.deepEqual(extractRowMetrics('12.37%23.667040016.5712.34- 25.51%- 100.03292.05'),
    { allocationPct: 12.37, totalReturnPct: -25.51, totalReturnUsd: -100.03 });
  assert.deepEqual(extractRowMetrics('25.61%86.49985899.366.99- 25.35%- 205.30604.63'),
    { allocationPct: 25.61, totalReturnPct: -25.35, totalReturnUsd: -205.3 });
  assert.deepEqual(extractRowMetrics('10.71%29.354709910.898.62- 20.88%- 66.78253.04'),
    { allocationPct: 10.71, totalReturnPct: -20.88, totalReturnUsd: -66.78 });
  // แถวรวมท้าย section
  assert.deepEqual(extractRowMetrics('100.00%- 20.25%- 599.562,361.19'),
    { allocationPct: 100, totalReturnPct: -20.25, totalReturnUsd: -599.56 });
  // แถวที่ไม่มี %/ผลตอบแทน → null
  assert.deepEqual(extractRowMetrics('302.86 4.00 1,211.47'),
    { allocationPct: null, totalReturnPct: null, totalReturnUsd: null });
});

// ── extractStatementSummary — สรุปหน้าแรก ──

// หน้าแรกของของจริง (ส่วนหัว + ยอด + FX + เงินสด + sector) — แยกจาก section หุ้น
const REAL_JULY_HEADER = `บริษัทหลักทรัพย์ เคเคพี ไดม์ จํากัด
รายงานบัญชีหลักทรัพย์ต่างประเทศประจําเดือน
Offshore Securities Account Monthly Statement
เลขประจําตัวผู้เสียภาษี / Tax ID.
สาขาที่ออกใบกํากับภาษี สาขาสํานักงานใหญ่ / Tax Invoice issued at Head Office
เลขที่สาขา / Branch No. 00000
นายกฤษกรณ์ อุตมะ
0105564162055
0105564162055
80000395380
327 บ้านเซือม หมู่ 11 โพนแพง อากาศอํานวย สกลนคร
47170
1478800017601
กรกฎาคม 2569 / July 2026
เลขที่บัญชีหลักทรัพย์ต่างประเทศ
Offshore Securities Account No.
สรุปภาพรวมหลักทรัพย์ต่างประเทศ / Offshore
Mr.Krisakorn Utama
2,361.19 USD
มูลค่าเงินลงทุนรวม / Total Balance
≈ 78,519.21 THB
ข้อมูล ณ 31 กรกฎาคม 2569 / As of 31 July 2026
1 USD = 33.25 THB
ผลตอบแทนจากการลงทุน / Investment Return
 - 20.25% (- 599.56 USD)
อัตราแลกเปลี่ยนของ ธปท.
ยอดเงินคงเหลือในบัญชี / Cash Balance
0.00 USD
≈ 0.00 THB
หุ้นสามัญ
Common Stock
สัดส่วนการลงทุนจัดกลุ่มโดยกลุ่มอุตสาหกรรม
Allocation Group by Sector
2,361.19 USD
≈ 78,519.21 THB
100.00%
วัสดุพื้นฐาน
Basic Materials
1,211.47 USD
≈ 40,286.21 THB
51.31%
เทคโนโลยี
Technology
604.63 USD
≈ 20,106.56 THB
25.61%
อุตสาหกรรม
Industrials
545.09 USD
≈ 18,126.44 THB
23.08%
1 / หน้าที่ / Pageนายกฤษกรณ์ อุตมะ6`;

test('extractStatementSummary: สรุปหน้าแรกของจริง — เลขบัญชี/Tax/FX/ยอด/เงินสด/ผลตอบแทน/sector', () => {
  const s = extractStatementSummary(REAL_JULY_HEADER + '\n' + REAL_JULY_SECTION);
  assert.equal(s.account_no, '47170');
  assert.equal(s.investment_account_no, '1478800017601');
  assert.equal(s.tax_id, '0105564162055');
  assert.equal(s.tax_invoice_no, '80000395380');
  assert.equal(s.branch_no, '00000');
  assert.equal(s.fx_rate, 33.25);
  assert.equal(s.total_balance_usd, 2361.19);
  assert.equal(s.total_balance_thb, 78519.21);
  assert.equal(s.cash_balance_usd, 0);
  assert.equal(s.cash_balance_thb, 0);
  assert.equal(s.total_return_pct, -20.25);
  assert.equal(s.total_return_usd, -599.56);
  assert.deepEqual(s.sectors, [
    { name: 'Basic Materials', value_usd: 1211.47, pct: 51.31 },
    { name: 'Technology', value_usd: 604.63, pct: 25.61 },
    { name: 'Industrials', value_usd: 545.09, pct: 23.08 },
  ]);
});

test('extractStatementSummary: ข้อความย่อ (ไม่มีส่วนหัว) → ยังได้ยอด/FX/เงินสด/ผลตอบแทนจากแถวรวม', () => {
  const s = extractStatementSummary(REAL_JULY_TEXT);
  assert.equal(s.account_no, null);
  assert.equal(s.tax_id, null);
  assert.equal(s.fx_rate, 33.25);
  assert.equal(s.total_balance_usd, 2361.19);
  assert.equal(s.cash_balance_usd, 0);
  // ไม่มี label Investment Return → fallback จากแถวรวม "100.00%- 20.25%- 599.562,361.19"
  assert.equal(s.total_return_pct, -20.25);
  assert.equal(s.total_return_usd, -599.56);
  assert.equal(s.sectors.length, 3);
});

test('extractStatementSummary: ข้อความว่าง/ไม่มีข้อมูล → summary ว่าง ไม่ crash', () => {
  const s = extractStatementSummary('ข้อความอะไรก็ได้ ไม่มีตัวเลข');
  assert.deepEqual(s, emptyStatementSummary());
});

test('extractSectorAllocations: sector ชื่อไทยตามด้วยอังกฤษ — ใช้ชื่ออังกฤษ', () => {
  const s = extractSectorAllocations(REAL_JULY_HEADER);
  assert.equal(s.length, 3);
  assert.equal(s[0].name, 'Basic Materials');
  assert.equal(s[1].pct, 25.61);
});

test('parseDimeStatementText: ฟิลด์เพิ่มของแต่ละแถว + summary ถูกส่งต่อ', () => {
  const r = parseDimeStatementText(REAL_JULY_TEXT, { subject: '[Dime!] Monthly Statement of July 2026' });
  const aspi = r.assets.find((a) => a.ticker === 'ASPI')!;
  assert.equal(aspi.allocation_pct, 51.31);
  assert.equal(aspi.total_return_pct, -15.81);
  assert.equal(aspi.total_return_usd, -227.45);
  assert.equal(r.summary.total_balance_usd, 2361.19);
  assert.equal(r.summary.total_return_usd, -599.56);
});

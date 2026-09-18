// download.js — ดาวน์โหลดไฟล์ลงดิสก์แบบ settle ทุกเส้นทาง (แยกโมดูลเพื่อเทสตรงได้)
const fs = require('fs');
const https = require('https');
const http = require('http');

function downloadFile(url, dest, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 4) return reject(new Error('redirect ลึกเกินไป'));
    let done = false;
    const file = fs.createWriteStream(dest);
    const discard = (cb) => file.close(() => fs.unlink(dest, cb));
    const fail = (e) => { if (!done) { done = true; discard(() => reject(e)); } };
    // error ต้องแนบทันที — ไฟล์เขียนไม่ได้ (สิทธิ์/ดิสก์เต็ม) ต้อง reject ทันที ไม่งั้นผู้เรียกค้าง
    file.on('error', fail);
    const transport = String(url).startsWith('http:') ? http : https;
    transport.get(url, { headers: { 'User-Agent': 'SovereignOS-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const next = new URL(res.headers.location, url).href; // รองรับ Location แบบ relative ด้วย
          done = true;
          return discard(() => resolve(downloadFile(next, dest, redirectDepth + 1)));
        } catch {
          res.resume();
          return fail(new Error('redirect ไม่ถูกต้อง'));
        }
      }
      if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => { if (!done) { done = true; file.close(() => resolve(dest)); } });
    }).on('error', fail);
  });
}

module.exports = { downloadFile };

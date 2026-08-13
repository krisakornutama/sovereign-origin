import os from 'os';
import path from 'path';

// ⚠️ ต้อง import ไฟล์นี้เป็นอันดับแรกในทุก test file
// เพราะ config/index.ts จะ throw ถ้าไม่มี JWT_SECRET / DATABASE_URL
process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.MQTT_HOST = '127.0.0.1';
process.env.MQTT_PORT = '1883';
process.env.PORT = '3999';
process.env.OTA_BASE_URL = 'http://127.0.0.1:3999';
// Telegram — test จะ mock axios ไม่ได้ส่งจริง
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_CHAT_ID = '12345';
// โฟลเดอร์ชั่วคราวสำหรับ OTA upload test (ไม่แตะของจริง)
process.env.OTA_DIR = path.join(os.tmpdir(), 'sovereign-ota-test');

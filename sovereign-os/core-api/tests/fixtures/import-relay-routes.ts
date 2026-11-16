// Fixture: import เฉพาะ router ของ relay แล้วจบ — ใช้ทดสอบว่า process "จบเองได้"
// (ถ้าโมดูลเปิด MQTT client ตอน import และ reconnect ทุก 1 วิ process จะไม่จบ)
import '../../src/modules/relay/relay.routes';

# ก่อนเปิดตัว: Alert fanout + คลิปเดโม 15 วินาที

## 1) Alert fanout 3 ช่อง (Telegram + Discord + LINE)

### ตรวจแล้วด้วยการรันจริง (04/11/69)

รัน `fanoutAlert()` จริง โดยชี้ HTTP ไปที่ stub ในเครื่อง (ไม่ยิงเน็ตจริง/ไม่ต้องมี credential):

| สิ่งที่ตรวจ | ผล |
|---|---|
| ยิงพร้อมกัน 3 ช่อง | `ok:true` · `telegram sent` · `discord sent` · `line sent` |
| Discord payload | `{"content":"…อุณหภูมิ 45.2°C เกินเกณฑ์ 40°C… เปิดหน้าแจ้งเตือน (http://localhost:3101/alerts/)","allowed_mentions":{"parse":[]}}` — HTML ถูกแปลงเป็น plain text และกัน `@everyone` |
| LINE payload | `{"to":"U…","messages":[{"type":"text","text":"…"}]}` + header `Authorization: Bearer <token>` |
| Telegram | คง `parse_mode: HTML` (ข้อความจัดรูปได้) |
| Discord ล่ม (500) | ช่องอื่นยังส่งสำเร็จ (`ok:true`) และรายงาน `discord ok:false` แยกช่อง — ไม่ทำให้ทั้งระบบล้ม |
| env ผิดรูปแบบ (`https://evil.example/hook`, `LINE_TO=bad`) | ถูกข้ามทั้งช่อง ไม่ทำให้ช่องอื่นหาย |

### ที่ต้องมี credential จริง (เจ้าของใส่เอง)

| ช่อง | ตัวแปร | หมายเหตุ |
|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | คุยกับ @BotFather |
| Discord | `DISCORD_WEBHOOK_URL` | ต้องเป็น `https://discord.com/api/webhooks/...` (โดเมนอื่นถูกปฏิเสธ) |
| LINE | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TO` | `LINE_TO` ต้องเป็น `U`/`C`/`R` + hex 32 ตัว |

ใส่ใน `deploy/community/.env` แล้วรันสคริปต์ยิงจริง:

```bash
cd sovereign-os/core-api && npx tsx scripts/alert-fanout-live.ts
```

- ไม่ตั้งค่าช่องไหนเลย → สคริปต์พิมพ์วิธีตั้งค่าแล้วจบ (ไม่ยิงมั่ว)
- ช่องที่ตั้งไว้ล้ม → `exit 1` พร้อมบอกช่องและเหตุผล
- สคริปต์ไม่พิมพ์ token ออกมา

## 2) คลิปเดโม 15 วินาที

> คลิปนี้ต้องอัดจากเครื่องเจ้าของ เพราะมี 2 ฉากที่ทำแทนไม่ได้: การรัน `docker compose up` บนเครื่องคุณ และการแจ้งเตือนเด้งเข้าบนมือถือคุณ

### สตอรีบอร์ด 15 วิ (ถ่ายหน้าจอต่อเนื่อง ไม่ตัดต่อ)

| เวลา | ฉาก |
|---|---|
| 0–3 วิ | เทอร์มินัล: `docker compose -f deploy/community/docker-compose.yml up -d` แล้วขึ้น `Started` |
| 3–6 วิ | `docker compose ps` → `api` / `web` / `db` สถานะ `healthy` |
| 6–10 วิ | เบราว์เซอร์ `http://localhost:3000` → Dashboard แสดงค่าอุณหภูมิ |
| 10–13 วิ | อุณหภูมิกระโดด (MQTT ตามหัวข้อล่าง) → หน้า `/alerts/` เด้งรายการใหม่ |
| 13–15 วิ | มือถือ: การแจ้งเตือน Telegram/Discord/LINE ขึ้นบนจอ |

### จำลองอุณหภูมิด้วย MQTT (ถ้าไม่มีเซนเซอร์จริง)

broker ในชุด CE รับหัวข้อ `sovereign/<node>/sensor/<device>` และพอร์ต 1883 (เครื่องทดสอบใช้ 1884):

```bash
docker run --rm eclipse-mosquitto \
  mosquitto_pub -h host.docker.internal -p 1883 -t "sovereign/node1/sensor/temp1" -m "{\"temperature\":45.2}"
```

### แปลงไฟล์ให้ README ฝังได้

GitHub ฝัง GIF ได้ตรง ๆ (MP4 จะเป็นลิงก์ดาวน์โหลด) — แปลงเป็น GIF ≤ 10 MB:

```bash
ffmpeg -i demo.webm -vf "fps=12,scale=960:-1:flags=lanczos" -loop 0 docs/media/demo.gif
ls -lh docs/media/demo.gif
```

วางไฟล์ที่ `docs/media/demo.gif` แล้วเปิดบรรทัดนี้ใน `README.md` (มีคอมเมนต์รอไว้แล้ว):

```markdown
![เดโม 15 วินาที](docs/media/demo.gif)
```

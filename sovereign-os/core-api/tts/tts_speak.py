import sys
import wave
import pyttsx3
import tempfile
import os

if len(sys.argv) < 2:
    print("Usage: tts_speak.py <text> [rate]", file=sys.stderr)
    sys.exit(1)

text = sys.argv[1]
rate = int(sys.argv[2]) if len(sys.argv) > 2 else 180

# TTS Engine
engine = pyttsx3.init()
engine.setProperty('rate', rate)

# เลือก "เสียงไทย" ถ้ามี — เสียงเริ่มต้นของ espeak เป็นภาษาอังกฤษ (gmw/en)
# แล้วข้อความไทยจะถูก synthesize เงียบ ๆ ออกมาเป็นไฟล์ว่าง 0 ไบต์
# ⇒ ชั้นเสียงของระบบแจ้งเตือนจะคืน false ตลอดกาลทั้งที่ทุกอย่าง "ดูเหมือน" ทำงาน
voices = engine.getProperty('voices') or []
thai_voice = next(
    (
        v for v in voices
        if str(getattr(v, 'id', '')).split('/')[-1].lower() == 'th'
        or 'thai' in str(getattr(v, 'name', '')).lower()
    ),
    None,
)
if thai_voice is not None:
    engine.setProperty('voice', thai_voice.id)

# สร้างไฟล์ชั่วคราว
with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
    temp_path = f.name

# บันทึกเสียงลงไฟล์ .wav
engine.save_to_file(text, temp_path)
engine.runAndWait()

# ตรวจก่อนส่ง — ไฟล์ว่าง = ไม่มีเสียงออกมาจริง ต้องบอกผู้เรียกด้วย exit code
# (ไม่ใช่เขียน 0 ไบต์ออกไปแล้วให้ชั้นบนเดาว่าเกิดอะไรขึ้น)
if os.path.getsize(temp_path) == 0:
    os.unlink(temp_path)
    sys.stderr.write("tts_speak.py: ไม่ได้เสียงออกมา (ตรวจเสียงไทย/espeak-ng)\n")
    sys.exit(2)

# อ่านไฟล์และส่งไป stdout (binary)
with open(temp_path, 'rb') as f:
    sys.stdout.buffer.write(f.read())

# Clean up
os.unlink(temp_path)

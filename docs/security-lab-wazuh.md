# Security Lab — Wazuh EDR/ SIEM บนเครื่องตัวเอง (แผน — รอยืนยันก่อนติดตั้ง)

> **ทำไม:** Wazuh = เปิดดู "ใครทำอะไรบนเครื่อง" แบบเรียลไทม์ (log collection + กฎจับพฤติกรรมน่าสงสัย + แจ้งเตือน)
> เสริมจาก hardening-check (สแกนจุด ๆ) เป็นการเฝ้าต่อเนื่อง
> **สถานะ: ยังไม่ติดตั้ง** — ขั้นตอนนี้แตะระบบเครื่อง (admin + service ใหม่) ต้องยืนยันก่อน ผมถึงจะรันให้

## ทางเลือก A — Full stack (manager + indexer + dashboard)

ทรัพยากร: RAM ~4 GB เพิ่ม · disk ~2-3 GB · 3 containers จาก official compose

```bash
cd "E:\My work\Project Sovereign Origin\sovereign-os\infra"
git clone https://github.com/wazuh/wazuh-docker -b v4.9.2 wazuh-docker --depth 1
cd wazuh-docker/single-node
docker compose -f generate-indexer-certs.yml run --rm generator   # สร้าง cert
docker compose up -d                                              # manager + indexer + dashboard
```

Dashboard: https://localhost:5601 (user admin / รหัสใน docker-compose.yml — เปลี่ยนก่อนใช้)

## ทางเลือก B — Manager-only (เบากว่า, แนะนำสำหรับเครื่องเดียว)

RAM ~1.5 GB · container เดียว — agent บน Windows คุยกับ manager ตรง ๆ

```bash
docker run -d --name wazuh-manager --restart unless-stopped \
  -p 127.0.0.1:1514:1514 -p 127.0.0.1:1515:1515 \
  -v wazuh-data:/var/ossec/data wazuh/wazuh-manager:4.9.2
```

## ติดตั้ง Agent บน Windows (ต้อง admin — ผมขอ elevation ตอนรัน)

```powershell
Invoke-WebRequest -Uri https://packages.wazuh.com/4.x/windows/wazuh-agent-4.9.2-1.msi -OutFile "$env:TEMP\wazuh-agent.msi"
msiexec.exe /i "$env:TEMP\wazuh-agent.msi" /q WAZUH_MANAGER="127.0.0.1" WAZUH_REGISTRATION_SERVER="127.0.0.1"
NET START WazuhSvc
```

## อะไรที่ Wazuh จะบอกได้ทันที

- ใคร login/failed login เครื่อง (Event Log security)
- process ใหม่/แปลก ๆ ที่ run ขึ้น, USB ถูกเสียบ, registry autorun ถูกแก้
- ไฟล์ในโฟลเดอร์ที่ monitor ถูกแก้ (FIM — ตั้ง monitor โฟลเดอร์ Sovereign เพื่อจับการแก้โค้ดนอก git)

## กติกาก่อนติดตั้งจริง

1. ตอบ "ติดตั้ง Wazuh แบบ B" ในแชท = ยืนยัน
2. ผมจะขอ elevation เฉพาะขั้นติดตั้ง agent (MSI)
3. ถอน: `docker rm -f wazuh-manager; msiexec /x wazuh-agent` — ถอนได้สะอาด

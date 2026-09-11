# Sovereign OS Desktop - Offline-First Distribution

## Quick Start

```bash
# 1. Start Docker Desktop (Start Menu → Docker Desktop)
#    Wait for whale icon in system tray to stop animating

# 2. Run launcher:
Start-Sovereign-Desktop.bat

# 3. Login:
#    Username: e2e-bot
#    Password: E2E-Sovereign-Run-2026!
```

## What's Included

```
dist-portable/
├── Sovereign OS.exe           # Electron app (245MB)
├── Start-Sovereign-Desktop.bat # Auto-launcher (handles backend + health)
├── locales/                    # Electron locales
├── resources/
│   ├── app.asar               # Electron shell + static frontend (344MB)
│   ├── out/                   # 51 static HTML pages (Next.js export)
│   └── core-api/              # Backend bundle + node_modules + prisma + data.db
├── chrome_100_percent.pak
├── chrome_200_percent.pak
├── d3dcompiler_47.dll
├── dxcompiler.dll
├── dxil.dll
├── ffmpeg.dll
├── icudtl.dat
├── LICENSE.electron.txt
├── LICENSES.chromium.html
├── resources.pak
├── snapshot_blob.bin
├── v8_context_snapshot.bin
├── vk_swiftshader.dll
├── vk_swiftshader_icd.json
└── vulkan-1.dll
```

## Architecture

| Layer | Technology | Offline? |
|-------|------------|----------|
| **Frontend** | Next.js 16.3 static export (51 pages) | ✅ 100% |
| **Electron** | v44.1.0 | ✅ 100% |
| **Backend** | Node.js + Express + Prisma | ⚠️ Needs PostgreSQL |
| **Database** | PostgreSQL (via Docker) | ❌ Requires Docker Desktop |

## Prerequisites

- **Windows 10/11** (x64)
- **Docker Desktop** (provides PostgreSQL 16 + backend container)
- **4GB+ RAM** recommended

## First-Time Setup

```bash
# 1. Install Docker Desktop from https://docker.com/products/docker-desktop
# 2. Start Docker Desktop, wait for whale icon to stop animating
# 3. Initialize database (one-time):
cd sovereign-os\infra
docker compose up -d
# 4. Run launcher:
Start-Sovereign-Desktop.bat
```

## Features (51 Pages)

### 🏠 ภาพรวม
- Dashboard — sensors, map, portfolio, AI chat

### 🏪 ร้านอาหาร
- POS, Menu & Recipes, Kitchen Display (KDS), Reports, Kitchen IoT

### 🌾 ฟาร์ม & ทรัพยากร
- Farm Plots, Livestock, Inventory, Rice Research

### 🏥 วันรอด & สุขภาพ
- Autonomy Days, Team Skills, Health Screening, Self-Check 32Q, Buddhist Healing, Lifestyle, Crisis Mode

### 🔒 ความปลอดภัย
- Cyber Security, Vision AI, Property Map 3D, Alerts, Risk Monitor

### 🤖 AI & อุปกรณ์
- Self-Learning, AI Command Center, AI Agent, Predictive, Sensors, Relay, Automation, Energy, OTA, Infrastructure, Governance Sim

### 📊 ข้อมูล
- History

### ⚙️ ระบบ
- System Health, Backup, Users, Audit Log, Settings, Change Password

## Launcher: Start-Sovereign-Desktop.bat

Automates:
1. ✅ Checks Docker Desktop
2. ✅ Starts `sovereign-core-api` container
3. ✅ Waits for backend health (`/api/health`)
4. ✅ Verifies frontend resources
5. ✅ Launches `Sovereign OS.exe`

## Credentials

| Role | Username | Password |
|------|----------|----------|
| SUPERADMIN (E2E) | `e2e-bot` | `E2E-Sovereign-Run-2026!` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Docker Desktop not running" | Start Docker Desktop from Start Menu |
| Backend not ready after 120s | Check `docker logs sovereign-core-api` |
| "Frontend not found" | Rebuild: `cd sovereign-frontend && npm run electron:build` |
| Port 3001 in use | `docker stop sovereign-core-api` then relaunch |
| Antivirus blocks app | Add `dist-portable` to exclusions |

## Development

```bash
# Frontend dev
cd sovereign-frontend
npm run dev          # http://localhost:3000
npm run e2e          # 57 E2E tests

# Backend
cd sovereign-os/core-api
npm test             # 1035 unit tests
docker compose up -d # Start PostgreSQL + backend
```

## Testing Results

| Test Suite | Passed | Total |
|------------|--------|-------|
| Frontend E2E | 57 | 57 |
| Backend Unit | 1035 | 1035 |
| TypeScript | ✅ | — |
| Build (51 pages) | ✅ | — |

## License

Internal use only — Sovereign Origin Project
"use client";

import { useState, useMemo } from "react";
import TerrainViewer from "../../components/terrain-viewer/TerrainViewer";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { useLanguageStore } from "../../stores/useLanguageStore";

function generateDemoHeightData(w: number, h: number): number[] {
  const data: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const ny = y / h;
      const v =
        Math.sin(nx * Math.PI * 2) * 8 +
        Math.cos(ny * Math.PI * 3) * 5 +
        Math.sin((nx + ny) * Math.PI * 4) * 3 +
        10;
      data.push(Math.max(0, v));
    }
  }
  return data;
}

export default function TerrainDemoPage() {
  const t = useLanguageStore((s) => s.t);
  const [landWidth, setLandWidth] = useState(200);
  const [landLength, setLandLength] = useState(200);
  const [resolution, setResolution] = useState(5);

  const gridW = Math.min(Math.ceil(landWidth / resolution), 256);
  const gridH = Math.min(Math.ceil(landLength / resolution), 256);

  const heightData = useMemo(
    () => generateDemoHeightData(gridW, gridH),
    [gridW, gridH]
  );

  const zones = useMemo(
    () => [
      {
        name: "Zone A",
        x: 10,
        y: 10,
        width: landWidth * 0.4,
        length: landLength * 0.4,
        elevationMean: 15,
        color: "#ff6b6b",
      },
      {
        name: "Zone B",
        x: landWidth * 0.55,
        y: landLength * 0.55,
        width: landWidth * 0.35,
        length: landLength * 0.35,
        elevationMean: 8,
        color: "#4ecdc4",
      },
    ],
    [landWidth, landLength]
  );

  return (
    <div className="atmo-nature min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow="Design System"
            title={t("terrain.title", "3D Terrain Viewer")}
            subtitle={t("terrain.subtitle", "Demo ภาพ terrain 3 มิติ — ปรับขนาดที่ดินและความละเอียด")}
            icon={<Icon name="dashboard" size={18} />}
          />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Controls */}
        <div className="lg:col-span-1 bg-gray-900/60 border border-gray-700 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">
            {t("terrain.settings", "Land Settings")}
          </h2>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {t("terrain.width", "Width (m)")}
            </label>
            <input
              type="number"
              min={10}
              max={2000}
              value={landWidth}
              onChange={(e) => setLandWidth(Number(e.target.value) || 10)}
              className="input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {t("terrain.length", "Length (m)")}
            </label>
            <input
              type="number"
              min={10}
              max={2000}
              value={landLength}
              onChange={(e) => setLandLength(Number(e.target.value) || 10)}
              className="input w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {t("terrain.resolution", "Resolution (m/px)")}
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value) || 1)}
              className="input w-full text-sm"
            />
          </div>

          <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
            <p>
              Grid: {gridW} x {gridH} = {(gridW * gridH).toLocaleString()} pts
            </p>
            <p>
              Area: {(landWidth * landLength).toLocaleString()} m²
            </p>
          </div>
        </div>

          {/* 3D Viewer */}
          <div className="lg:col-span-3 bg-gray-900/60 border border-gray-700 rounded-lg overflow-hidden"
            style={{ height: "70vh", minHeight: "500px" }}
          >
            <TerrainViewer
              landWidth={landWidth}
              landLength={landLength}
              resolution={resolution}
              heightData={heightData}
              zones={zones}
            />
          </div>
        </div>
        </main>
      </div>
    </div>
  );
}

"use client";
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { METRIC_LABEL } from '../../lib/sensors/metrics';

export interface Device {
  id: string;
  type: string;
  mqtt_topic: string;
  is_active: boolean;
  online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  sensors: { metric: string; value: number }[];
}

interface Props {
  device: Device;
  onGenerate: (device: Device) => void;
  onLocation: (device: Device) => void;
  onDelete: (id: string) => void;
}

// การ์ดอุปกรณ์หนึ่งตัว — แยกไฟล์เพื่อให้ SensorsHub อยู่ในเพดานบรรทัด (components ≤ 400)
export default function DeviceCard({ device, onGenerate, onLocation, onDelete }: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
    <div className="card p-4 card-hover">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">{device.type}</h3>
          <p className="text-xs text-gray-400">{device.id}</p>
          <p className="text-xs text-gray-500">{device.mqtt_topic}</p>
          <span className={`inline-flex items-center gap-1 text-xs ${device.online ? 'text-emerald-400' : 'text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${device.online ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            {device.online ? t('common.online', 'ออนไลน์') : t('common.offline', 'ออฟไลน์')}
          </span>
          {device.latitude != null && device.longitude != null && (
            <span className="inline-flex items-center gap-1 text-xs text-cyan-500 ml-2"><Icon name="map-pin" size={11} /> {device.latitude.toFixed(3)}, {device.longitude.toFixed(3)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onGenerate(device)} className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"><Icon name="code" size={12} /> Generate Code</button>
          <button onClick={() => onLocation(device)} className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center gap-1" title={t('sensorsHub.setLocationTitle', 'ตั้งพิกัด GPS สำหรับแผนที่')}><Icon name="map-pin" size={12} /> {t('sensorsHub.locationBtn', 'พิกัด')}</button>
          <button onClick={() => onDelete(device.id)} className="text-red-400 hover:text-red-300 text-sm"><Icon name="trash" size={13} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {device.sensors?.map((sensor) => (
          <div key={sensor.metric} className="inset p-2 text-center">
            <div className="text-xs text-gray-400">{t(`sensorsHub.metric.${sensor.metric}`, METRIC_LABEL[sensor.metric] || sensor.metric)}</div>
            <div className="text-lg font-bold text-emerald-400 glow-text">{sensor.value}</div>
          </div>
        ))}
        {(!device.sensors || device.sensors.length === 0) && (
          <div className="text-xs text-gray-500 col-span-3">{t('sensorsHub.noSensorData', 'ยังไม่มีข้อมูลเซ็นเซอร์ — ดูข้อมูลที่แท็บ "ข้อมูลเซ็นเซอร์"')}</div>
        )}
      </div>
    </div>
  );
}

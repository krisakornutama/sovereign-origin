// src/services/notification.service.ts
import { systemEvents } from './mqtt-listener';

systemEvents.on('alert:battery_low', (alert) => {
  console.error(`🚨 EMERGENCY: ${alert.message}`);
  // Here you would trigger LoRa/Satellite alert, push notification, etc.
});
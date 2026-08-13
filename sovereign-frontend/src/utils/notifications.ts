export function showCriticalNotification(message: string) {
  if (!('Notification' in window)) {
    console.warn('Notification not supported');
    return;
  }
  if (Notification.permission === 'granted') {
    new Notification('🚨 Sovereign OS Alert', { body: message });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        new Notification('🚨 Sovereign OS Alert', { body: message });
      }
    });
  }
}
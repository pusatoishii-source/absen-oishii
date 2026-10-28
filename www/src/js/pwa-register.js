// Registrasi Service Worker untuk PWA - Oishii Absen Online
// Di APK (Capacitor) semua file sudah ada di dalam aplikasi, service worker tidak diperlukan
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

if ('serviceWorker' in navigator && !isNativeApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[PWA] Service worker terdaftar:', reg.scope))
      .catch((err) => console.warn('[PWA] Gagal mendaftarkan service worker:', err));
  });
}

// Tangkap event install prompt (Android/Chrome) agar bisa dipicu manual jika perlu
window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('pwa-install-available'));
});

window.addEventListener('appinstalled', () => {
  window.deferredInstallPrompt = null;
  console.log('[PWA] Aplikasi berhasil diinstal');
});

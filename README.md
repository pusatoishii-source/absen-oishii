# Absen Oishii — APK Android

Pembungkus Android (Capacitor) untuk aplikasi **Absen Online Oishii**.
Tracking lokasi di APK memakai *foreground service*, jadi tetap jalan saat layar mati.

## Cara membuat APK (tanpa Android Studio)

1. Buat repo baru di GitHub (boleh private), lalu unggah **seluruh isi folder ini**
   (termasuk folder `.github`, `www`, `scripts`).
2. Buka tab **Actions** → **Build APK Android** → **Run workflow**.
3. Tunggu ±5–10 menit. Setelah hijau, buka run tersebut → bagian **Artifacts** →
   unduh **Absen-Oishii-APK** (zip berisi `Absen-Oishii.apk`).
4. Kirim APK ke HP salesman, buka, izinkan "Instal dari sumber tidak dikenal".

Build berikutnya otomatis jalan setiap kali ada perubahan yang di-push ke branch `main`.
APK baru bisa menimpa APK lama karena memakai keystore tetap (`scripts/debug.keystore`).

> Keystore ini hanya untuk pembagian langsung (sideload). Untuk Google Play, buat keystore rilis sendiri.

## Mengubah aplikasi

Seluruh kode web ada di folder `www/`. Ubah di sana, push, lalu build ulang.

- `www/src/js/native-tracking.js` — adapter tracking Android + antrean offline + panduan izin.
- `www/src/js/salesman/dashboard.js` & `attendance.js` — memanggil adapter saat check-in.
- `capacitor.config.json` — package ID (`com.oishii.absen`) dan nama aplikasi.
- `scripts/patch-android.js` — izin Android. `scripts/make-icons.py` — ikon launcher.

## Cara kerja tracking

- Saat salesman check-in, aplikasi memulai service latar belakang dengan notifikasi
  **"Absen Oishii aktif"**. Selama notifikasi ada, Android tidak mematikan pelacakan.
- Titik dicatat paling sering tiap 5 menit dan hanya jika berpindah ≥ 20 m (sama seperti versi web).
- Titik yang gagal terkirim (tanpa sinyal) disimpan di HP (maks 500) dan dikirim otomatis
  pada pelacakan berikutnya saat online.
- Saat pertama dipakai, muncul panduan izin lokasi, notifikasi, dan pengaturan baterai per merek HP.

## Checklist uji di HP (wajib sebelum dibagikan)

1. Login → check-in → izinkan lokasi & notifikasi.
2. Matikan layar 10–15 menit sambil berpindah tempat, lalu cek peta Monitoring admin.
3. Matikan sinyal beberapa menit, hidupkan lagi → titik tertunda harus muncul.
4. Uji di merek HP yang dipakai tim (Xiaomi/Oppo/Vivo paling agresif mematikan aplikasi).
   Jika tracking berhenti, atur: Baterai → *Tanpa batasan*, aktifkan *Autostart*,
   dan lokasi → *Selalu izinkan*.

## Catatan penting

- **Lisensi / device scan:** WebView APK punya User-Agent berbeda dari Chrome, sehingga
  sistem lisensi akan menghitungnya sebagai **perangkat baru** (memakai 1 slot `max_devices`).
- Aplikasi tetap butuh internet (Supabase dan beberapa library dimuat dari CDN).
- Nama paket `com.oishii.absen` sebaiknya tidak diganti setelah APK dibagikan.

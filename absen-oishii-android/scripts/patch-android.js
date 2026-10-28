// Menyesuaikan proyek android/ yang dibuat oleh `cap add android`:
// izin lokasi + foreground service + notifikasi. Aman dijalankan berulang kali.
const fs = require('fs')
const path = require('path')

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
if (!fs.existsSync(manifestPath)) {
  console.error('AndroidManifest.xml tidak ditemukan. Jalankan "npx cap add android" dulu.')
  process.exit(1)
}

let xml = fs.readFileSync(manifestPath, 'utf8')

const permissions = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  // Tidak selalu dibutuhkan (foreground service sudah cukup), tapi memungkinkan user memilih
  // "Selalu izinkan" di pengaturan jika sebuah merek HP memutus tracking di latar belakang.
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK'
]

const lines = []
for (const p of permissions) {
  if (!xml.includes(`android:name="${p}"`)) {
    lines.push(`    <uses-permission android:name="${p}" />`)
  }
}
if (!xml.includes('android.hardware.location.gps')) {
  lines.push('    <uses-feature android:name="android.hardware.location.gps" android:required="false" />')
}

if (lines.length) {
  xml = xml.replace('</manifest>', lines.join('\n') + '\n</manifest>')
  fs.writeFileSync(manifestPath, xml)
  console.log(`AndroidManifest.xml: ${lines.length} baris ditambahkan`)
} else {
  console.log('AndroidManifest.xml sudah lengkap')
}

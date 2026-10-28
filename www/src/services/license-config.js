// src/services/license-config.js
//
// ⚠️ GANTI SEBELUM DEPLOY / SEBELUM DIKIRIM KE CUSTOMER ⚠️
//
// Setiap instalasi/copy aplikasi OISHII harus punya LICENSE_KEY sendiri yang
// terdaftar di tabel `license_keys` (lihat supabase/migrations/20260917_license_system.sql).
// Buat license key baru dari halaman Admin → Lisensi (super_admin), lalu
// tempel key tersebut di sini SEBELUM meng-copy folder ini ke server/customer
// yang baru. Kalau file ini tidak diganti, dua deployment berbeda akan
// berebut kuota device yang sama.

export const LICENSE_KEY = 'AFCO-AB12-CD34-EF56';

// Opsional: nama yang ditampilkan di halaman "lisensi diblokir" agar
// customer tahu harus menghubungi siapa.
export const LICENSE_SUPPORT_CONTACT = 'admin@afco.example.com';

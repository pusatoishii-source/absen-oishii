// src/services/license-service.js
//
// Menghasilkan "device id" yang cukup stabil untuk satu browser/device, lalu
// memvalidasi license key + device id itu ke Supabase lewat function
// `license_verify_device` (lihat migration SQL). Keputusan valid/tidaknya
// SELALU diambil di server (Postgres function), file ini hanya:
//   1. mengumpulkan sinyal device,
//   2. memanggil RPC,
//   3. menyimpan cache singkat supaya tidak ping server di setiap klik.
//
// Catatan jujur: browser modern membatasi akses ke identifier hardware asli
// (privacy sandbox), jadi "device id" di sini adalah fingerprint gabungan
// beberapa sinyal browser + random id yang disimpan di localStorage. Ini
// cukup untuk mencegah satu customer memakai 1 license di puluhan device
// sekaligus, tapi bukan DRM anti-cracking yang mustahil ditembus orang yang
// sangat niat mengedit source code. Kombinasikan dengan perjanjian lisensi
// & kontrol akses source code untuk perlindungan penuh.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Dibuat langsung dari CDN ESM URL (bukan lewat bare specifier "@supabase/supabase-js"
// atau import dari ./supabase-client.js) supaya guard ini bisa jalan di SEMUA halaman
// tanpa bergantung pada urutan <script type="importmap"> di tiap file HTML — beberapa
// halaman meletakkan importmap-nya di bawah, sebagian lagi (mis. index.html) malah
// tidak punya importmap sama sekali.
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const DEVICE_SEED_KEY = 'afco_device_seed_v1'
const CACHE_KEY = 'afco_license_cache_v1'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 jam: cukup jarang ping server, tapi tetap re-check berkala

async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text)
    const buf = await crypto.subtle.digest('SHA-256', enc)
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getOrCreateDeviceSeed() {
    try {
        let seed = localStorage.getItem(DEVICE_SEED_KEY)
        if (!seed) {
            seed = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random())
            localStorage.setItem(DEVICE_SEED_KEY, seed)
        }
        return seed
    } catch (e) {
        // localStorage tidak tersedia (mode privat ekstrem dsb) - pakai seed sesi saja
        return 'no-storage-' + Date.now()
    }
}

function collectFingerprintSignals() {
    const nav = navigator
    const scr = screen
    let canvasSig = 'no-canvas'
    try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
            ctx.textBaseline = 'top'
            ctx.font = '14px Arial'
            ctx.fillText('AFCO-device-check', 2, 2)
            canvasSig = canvas.toDataURL()
        }
    } catch (e) { /* abaikan */ }

    return [
        nav.userAgent || '',
        nav.language || '',
        nav.platform || '',
        String(nav.hardwareConcurrency || ''),
        String(scr.width) + 'x' + String(scr.height) + 'x' + String(scr.colorDepth),
        Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        canvasSig
    ].join('||')
}

let cachedDeviceId = null

export async function getDeviceId() {
    if (cachedDeviceId) return cachedDeviceId
    const seed = getOrCreateDeviceSeed()
    const signals = collectFingerprintSignals()
    cachedDeviceId = await sha256Hex(seed + '::' + signals)
    return cachedDeviceId
}

function getDeviceLabel() {
    const ua = navigator.userAgent || ''
    let browser = 'Browser'
    if (ua.includes('Edg/')) browser = 'Edge'
    else if (ua.includes('Chrome/')) browser = 'Chrome'
    else if (ua.includes('Firefox/')) browser = 'Firefox'
    else if (ua.includes('Safari/')) browser = 'Safari'

    let os = 'OS'
    if (ua.includes('Windows')) os = 'Windows'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
    else if (ua.includes('Mac OS')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'

    return `${browser} - ${os}`
}

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.checkedAt !== 'number') return null
        if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null
        return parsed
    } catch (e) {
        return null
    }
}

function writeCache(result) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ...result, checkedAt: Date.now() }))
    } catch (e) { /* abaikan */ }
}

export function clearLicenseCache() {
    try { localStorage.removeItem(CACHE_KEY) } catch (e) { /* abaikan */ }
}

/**
 * Cek lisensi ke server. `force=true` melewati cache (dipakai admin/QA).
 * Return: { valid, reason, devices_used?, max_devices?, label? }
 */
export async function checkLicense(licenseKey, { force = false } = {}) {
    if (!force) {
        const cached = readCache()
        if (cached && cached.license_key === licenseKey) return cached
    }

    const deviceId = await getDeviceId()
    const deviceLabel = getDeviceLabel()

    let result
    try {
        const { data, error } = await supabase.rpc('license_verify_device', {
            p_license_key: licenseKey,
            p_device_id: deviceId,
            p_device_label: deviceLabel
        })
        if (error) throw error
        result = { ...data, license_key: licenseKey }
    } catch (e) {
        console.error('License RPC error:', e)
        // Tidak bisa menghubungi server (mis. offline). Kalau ada cache lama
        // yang masih 'valid', pakai itu supaya user tidak ke-lock saat offline
        // sebentar. Kalau tidak ada cache sama sekali, anggap tidak valid.
        const staleCache = (() => {
            try {
                const raw = localStorage.getItem(CACHE_KEY)
                return raw ? JSON.parse(raw) : null
            } catch (_) { return null }
        })()
        if (staleCache && staleCache.valid && staleCache.license_key === licenseKey) {
            return { ...staleCache, reason: 'offline_grace' }
        }
        result = { valid: false, reason: 'network_error', license_key: licenseKey, debug: String(e && e.message || e) }
    }

    writeCache(result)
    return result
}

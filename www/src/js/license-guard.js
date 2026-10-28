// src/js/license-guard.js
//
// Sertakan di <head> setiap halaman yang mau dilindungi, sebelum konten
// lain dirender:
//
//   <script type="module" src="/src/js/license-guard.js"></script>
//
// Kalau lisensi/device tidak valid, browser langsung diarahkan ke
// /license-blocked.html sebelum sempat menampilkan isi halaman.

import { LICENSE_KEY } from '../services/license-config.js'
import { checkLicense } from '../services/license-service.js'

const BLOCKED_PAGE = '/license-blocked.html'

function isOnBlockedPage() {
    return window.location.pathname.endsWith('/license-blocked.html')
}

function redirectToBlocked(reason, debugInfo) {
    if (isOnBlockedPage()) return
    const params = new URLSearchParams({ reason: reason || 'unknown' })
    if (debugInfo) params.set('debug', debugInfo)
    window.location.replace(BLOCKED_PAGE + '?' + params.toString())
}

;(async function guard() {
    if (isOnBlockedPage()) return
    try {
        const result = await checkLicense(LICENSE_KEY)
        if (!result || !result.valid) {
            redirectToBlocked(result ? result.reason : 'unknown', result ? result.debug : null)
        }
    } catch (e) {
        console.error('License check failed:', e)
        redirectToBlocked('error', String(e && e.message || e))
    }
})()

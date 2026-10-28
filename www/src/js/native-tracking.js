// src/js/native-tracking.js
// Adapter tracking lokasi untuk APK Android (Capacitor).
//
// - Di APK: memakai plugin BackgroundGeolocation (foreground service + notifikasi),
//   sehingga lokasi tetap tercatat walau layar mati / aplikasi di latar belakang.
// - Di browser biasa (PWA): isNative = false, halaman memakai kode lama (setInterval).
// - Antrean offline: titik yang gagal dikirim disimpan di perangkat lalu dikirim ulang.
//
// Script ini klasik (bukan module) dan harus dimuat SEBELUM dashboard.js / attendance.js.
(function () {
    'use strict'

    var QUEUE_KEY = 'oishii_track_queue_v1'
    var GUIDE_KEY = 'oishii_bg_guide_seen_v1'
    var QUEUE_MAX = 500

    var cap = window.Capacitor
    var isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())

    function getPlugin(name) {
        if (!cap) return null
        if (cap.Plugins && cap.Plugins[name]) return cap.Plugins[name]
        if (typeof cap.registerPlugin === 'function') return cap.registerPlugin(name)
        return null
    }

    var BG = isNative ? getPlugin('BackgroundGeolocation') : null

    var watcherId = null
    var lastEmit = 0

    // ------------------------------------------------------------
    // Panduan izin & baterai
    // ------------------------------------------------------------
    function showGuide(reason) {
        if (document.getElementById('oishiiBgGuide')) return

        var wrap = document.createElement('div')
        wrap.id = 'oishiiBgGuide'
        wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);' +
            'display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;'

        var intro = reason === 'denied'
            ? '<p style="color:#b91c1c;margin:0 0 10px"><b>Izin lokasi belum diberikan.</b> Tanpa izin ini absensi dan pelacakan rute tidak bisa berjalan.</p>'
            : '<p style="margin:0 0 10px">Agar lokasi tetap tercatat saat layar mati, lakukan pengaturan berikut sekali saja.</p>'

        wrap.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;max-height:88vh;overflow:auto;padding:18px 18px 14px;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
            '<h3 style="margin:0 0 8px;font-size:18px">📍 Agar pelacakan tetap jalan</h3>' + intro +
            '<ol style="padding-left:20px;margin:0 0 10px;line-height:1.5;font-size:14px">' +
            '<li><b>Izin lokasi:</b> pilih <b>"Selalu izinkan"</b> (atau "Izinkan saat aplikasi digunakan") dan aktifkan <b>Lokasi presisi</b>.</li>' +
            '<li><b>Notifikasi:</b> izinkan notifikasi. Notifikasi "Absen Oishii aktif" harus tetap muncul selama bekerja, jangan dihapus paksa.</li>' +
            '<li><b>Baterai:</b> Pengaturan &rsaquo; Aplikasi &rsaquo; Absen Oishii &rsaquo; Baterai &rsaquo; pilih <b>"Tanpa batasan"</b> / "Tidak dioptimalkan".</li>' +
            '</ol>' +
            '<details style="font-size:13px;margin-bottom:12px"><summary style="cursor:pointer"><b>Khusus merek tertentu</b></summary>' +
            '<ul style="padding-left:18px;line-height:1.5;margin:6px 0 0">' +
            '<li><b>Xiaomi / Redmi / POCO:</b> aktifkan <i>Autostart</i>, Hemat baterai &rarr; <i>Tanpa batasan</i>, lalu kunci aplikasi di menu recent (tahan kartu &rarr; ikon gembok).</li>' +
            '<li><b>Oppo / Realme / OnePlus:</b> aktifkan <i>Izinkan aktivitas latar belakang</i> dan <i>Autostart</i>; kunci aplikasi di recent apps.</li>' +
            '<li><b>Vivo / iQOO:</b> Baterai &rarr; <i>Penggunaan baterai latar belakang</i> &rarr; Izinkan; aktifkan <i>Autostart</i>.</li>' +
            '<li><b>Samsung:</b> Baterai &rarr; <i>Batas penggunaan di latar belakang</i> &rarr; keluarkan Absen Oishii dari daftar "Aplikasi tidur".</li>' +
            '</ul></details>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
            (BG && BG.openSettings ? '<button id="oishiiBgOpen" style="padding:9px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:14px">Buka Pengaturan</button>' : '') +
            '<button id="oishiiBgClose" style="padding:9px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:14px">Mengerti</button>' +
            '</div></div>'

        document.body.appendChild(wrap)
        document.getElementById('oishiiBgClose').onclick = function () { wrap.remove() }
        var openBtn = document.getElementById('oishiiBgOpen')
        if (openBtn) openBtn.onclick = function () { try { BG.openSettings() } catch (e) { } }
    }

    function showGuideOnce() {
        try {
            if (localStorage.getItem(GUIDE_KEY)) return
            localStorage.setItem(GUIDE_KEY, '1')
        } catch (e) { }
        if (document.body) showGuide('first')
        else document.addEventListener('DOMContentLoaded', function () { showGuide('first') })
    }

    // ------------------------------------------------------------
    // Start / stop tracking native
    // ------------------------------------------------------------
    // onPosition(coords) dipanggil paling sering sekali per intervalMs, hanya jika
    // perangkat sudah berpindah >= distanceFilter meter (titik pertama langsung dikirim).
    async function start(onPosition, opts) {
        if (!isNative || !BG) return false
        opts = opts || {}
        var intervalMs = opts.intervalMs || 300000
        var distanceFilter = opts.distanceFilter || 20

        if (watcherId) return true
        lastEmit = 0

        try {
            watcherId = await BG.addWatcher(
                {
                    backgroundTitle: 'Absen Oishii aktif',
                    backgroundMessage: 'Lokasi dicatat selama jam kerja',
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: distanceFilter
                },
                function (loc, err) {
                    if (err) {
                        if (err.code === 'NOT_AUTHORIZED') showGuide('denied')
                        else console.error('[native-tracking] error:', err)
                        return
                    }
                    if (!loc) return

                    var now = Date.now()
                    if (now - lastEmit < intervalMs) return
                    lastEmit = now

                    try {
                        onPosition({
                            latitude: loc.latitude,
                            longitude: loc.longitude,
                            accuracy: loc.accuracy,
                            speed: loc.speed,
                            heading: loc.bearing
                        })
                    } catch (e) {
                        console.error('[native-tracking] handler error:', e)
                    }
                }
            )
            showGuideOnce()
            return true
        } catch (e) {
            console.error('[native-tracking] gagal start:', e)
            watcherId = null
            return false
        }
    }

    async function stop() {
        if (!BG || !watcherId) return
        var id = watcherId
        watcherId = null
        try { await BG.removeWatcher({ id: id }) } catch (e) { console.error(e) }
    }

    // ------------------------------------------------------------
    // Antrean offline (berlaku di APK maupun browser)
    // ------------------------------------------------------------
    function readQueue() {
        try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch (e) { return [] }
    }
    function writeQueue(q) {
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))) } catch (e) { }
    }

    function queue(row) {
        if (!row) return
        var q = readQueue()
        q.push(row)
        writeQueue(q)
        console.log('[native-tracking] titik masuk antrean offline:', q.length)
    }

    var flushing = false
    // insertFn(rows) harus mengembalikan Promise<{ error }> (hasil supabase .insert)
    async function flush(insertFn) {
        if (flushing || typeof insertFn !== 'function') return
        var q = readQueue()
        if (!q.length) return
        flushing = true
        try {
            var batch = q.slice(0, 100)
            var res = await insertFn(batch)
            if (!res || !res.error) {
                writeQueue(readQueue().slice(batch.length))
                console.log('[native-tracking] antrean terkirim:', batch.length)
            } else if (res.error.code) {
                // Ditolak server (data/izin salah), bukan masalah jaringan: buang agar antrean tidak macet
                console.warn('[native-tracking] antrean ditolak server, dibuang:', res.error.code)
                writeQueue(readQueue().slice(batch.length))
            }
        } catch (e) {
            console.warn('[native-tracking] flush gagal, coba lagi nanti')
        } finally {
            flushing = false
        }
    }

    window.NativeTracking = {
        isNative: isNative && !!BG,
        start: start,
        stop: stop,
        queue: queue,
        flush: flush,
        queueSize: function () { return readQueue().length },
        showGuide: function () { showGuide('manual') }
    }
})()

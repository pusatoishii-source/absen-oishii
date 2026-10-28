import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const $ = (id) => document.getElementById(id)

let profile = null
let licenses = []
let openLicenseId = null

function showStatus(msg, type = 'info', autoHide = 3500) {
    const el = $('statusMsg')
    el.textContent = msg
    el.className = `status-msg show ${type}`
    if (autoHide) setTimeout(() => el.classList.remove('show'), autoHide)
}

function fmtDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function reasonBadge(license) {
    if (!license.is_active) return '<span class="status-badge blocked">Nonaktif</span>'
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
        return '<span class="status-badge blocked">Kedaluwarsa</span>'
    }
    return '<span class="status-badge active">Aktif</span>'
}

async function init() {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session) {
        window.location.href = '../auth/login.html'
        return
    }

    const { data: prof, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single()

    if (profileError || !prof) {
        window.location.href = '../auth/login.html'
        return
    }

    profile = prof

    if (!['admin', 'super_admin'].includes(profile.role)) {
        window.location.href = '../salesman/dashboard.html'
        return
    }

    $('logoutBtn').addEventListener('click', async () => {
        await supabase.auth.signOut()
        window.location.href = '../auth/login.html'
    })

    $('refreshBtn').addEventListener('click', loadLicenses)

    await loadLicenses()
}

async function loadLicenses() {
    $('loadingOverlay').classList.add('show')
    try {
        const { data, error } = await supabase.rpc('license_admin_list')
        if (error) throw error
        licenses = data || []
        renderLicenses()
    } catch (e) {
        console.error(e)
        showStatus('Gagal memuat data lisensi: ' + e.message, 'error', 5000)
    } finally {
        $('loadingOverlay').classList.remove('show')
    }
}

function renderLicenses() {
    const container = $('licenseList')
    if (licenses.length === 0) {
        container.innerHTML = '<div class="empty-state">Belum ada license key. Buat satu di form atas.</div>'
        return
    }

    container.innerHTML = licenses.map(l => `
        <div class="license-card" data-id="${l.id}">
            <div class="license-card-head">
                <div>
                    <div class="license-key">${l.license_key}</div>
                    <div class="license-label">${l.label || '(tanpa label)'}</div>
                </div>
                ${reasonBadge(l)}
            </div>
            <div class="license-meta">
                <span>Maks device: <b>${l.max_devices}</b></span>
                <span>Kedaluwarsa: <b>${l.expires_at ? fmtDate(l.expires_at) : 'Tidak ada'}</b></span>
                <span>Dibuat: <b>${fmtDate(l.created_at)}</b></span>
            </div>
            <div class="license-actions">
                <button class="btn-small" data-action="toggle-devices">📱 Lihat Device</button>
            </div>
            <div class="device-list" id="devices-${l.id}" style="display:none;"></div>
        </div>
    `).join('')

    container.querySelectorAll('.license-card').forEach(card => {
        const id = card.dataset.id
        card.querySelector('[data-action="toggle-devices"]').addEventListener('click', () => toggleDevices(id))
    })
}

async function toggleDevices(licenseId) {
    const el = $('devices-' + licenseId)
    const isOpen = el.style.display !== 'none'
    if (isOpen) {
        el.style.display = 'none'
        return
    }

    el.style.display = 'block'
    el.innerHTML = '<div class="device-loading">Memuat perangkat...</div>'

    try {
        const { data, error } = await supabase.rpc('license_admin_list_devices', { p_license_id: licenseId })
        if (error) throw error
        renderDevices(el, licenseId, data || [])
    } catch (e) {
        el.innerHTML = `<div class="device-loading">Gagal memuat: ${e.message}</div>`
    }
}

function renderDevices(el, licenseId, devices) {
    if (devices.length === 0) {
        el.innerHTML = '<div class="device-loading">Belum ada device terdaftar untuk lisensi ini.</div>'
        return
    }

    el.innerHTML = `
        <table class="device-table">
            <thead>
                <tr><th>Device</th><th>Pertama Terlihat</th><th>Terakhir Aktif</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
                ${devices.map(d => `
                    <tr data-device-id="${d.id}">
                        <td>${d.device_label || '(tanpa label)'}<br><span class="device-id-fingerprint">${d.device_id.slice(0, 16)}…</span></td>
                        <td>${fmtDate(d.first_seen_at)}</td>
                        <td>${fmtDate(d.last_seen_at)}</td>
                        <td>${d.is_blocked ? '<span class="status-badge blocked">Diblokir</span>' : '<span class="status-badge active">Aktif</span>'}</td>
                        <td>
                            <button class="btn-tiny" data-action="block">${d.is_blocked ? 'Buka Blokir' : 'Blokir'}</button>
                            <button class="btn-tiny danger" data-action="remove">Hapus</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `

    el.querySelectorAll('tr[data-device-id]').forEach(row => {
        const deviceRowId = row.dataset.deviceId
        const device = devices.find(d => d.id === deviceRowId)

        row.querySelector('[data-action="block"]').addEventListener('click', async () => {
            try {
                const { error } = await supabase.rpc('license_admin_set_device_blocked', {
                    p_device_row_id: deviceRowId,
                    p_blocked: !device.is_blocked
                })
                if (error) throw error
                showStatus(device.is_blocked ? 'Device dibuka blokirnya.' : 'Device diblokir.', 'success')
                toggleDevices(licenseId) // tutup
                toggleDevices(licenseId) // buka lagi -> refresh
            } catch (e) {
                showStatus('Gagal: ' + e.message, 'error')
            }
        })

        row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
            if (!confirm('Hapus device ini dari daftar? Slot kuotanya akan terbebas dan device tsb akan dianggap baru lagi kalau login ulang.')) return
            try {
                const { error } = await supabase.rpc('license_admin_delete_device', { p_device_row_id: deviceRowId })
                if (error) throw error
                showStatus('Device dihapus.', 'success')
                toggleDevices(licenseId)
                toggleDevices(licenseId)
            } catch (e) {
                showStatus('Gagal: ' + e.message, 'error')
            }
        })
    })
}

init()

import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// SETTINGS CLASS
// ============================================================
class Settings {
    constructor() {
        this.user = null
        this.profile = null
        this.settingsId = null
        this.defaultSettings = {
            work_start: '08:00',
            work_end: '17:00',
            tracking_interval_minutes: 5,
            customer_radius_meter: 100,
            late_tolerance_minutes: 15,
            // Extra settings (tidak di database, hanya di frontend)
            min_movement: 20,
            online_threshold: 5,
            offline_threshold: 15,
            min_attendance: 20,
            require_checkout: true,
            allow_early_checkout: false,
            notif_gps_offline: true,
            notif_late: true,
            notif_checkin: true,
            language: 'id',
            timezone: 'Asia/Jakarta',
            company_logo: '',
            company_name: 'Oishii'
        }
    }

    async init() {
        try {
            // 1. Cek session
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()
            if (sessionError || !session) {
                window.location.href = '../auth/login.html'
                return
            }

            this.user = session.user

            // 2. Ambil profile
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('user_id', this.user.id)
                .single()

            if (profileError || !profile) {
                window.location.href = '../auth/login.html'
                return
            }

            this.profile = profile

            // 3. Cek role (hanya super_admin yang bisa akses pengaturan)
            if (profile.role !== 'super_admin') {
                this.showToast('⚠️ Hanya Super Admin yang dapat mengakses pengaturan')
                // Redirect ke dashboard
                setTimeout(() => {
                    window.location.href = 'dashboard.html'
                }, 2000)
                return
            }

            // 4. Setup UI
            this.updateDateTime()

            // 5. Load settings
            await this.loadSettings()

            // 6. Setup event listeners
            this.setupEventListeners()

        } catch (error) {
            console.error('Settings init error:', error)
        }
    }

    // ============================================================
    // LOAD SETTINGS
    // ============================================================

    async loadSettings() {
        try {
            const { data, error } = await supabase
                .from('work_settings')
                .select('*')
                .eq('active', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .single()

            if (error && error.code !== 'PGRST116') {
                throw error
            }

            if (data) {
                this.settingsId = data.id
                // Isi form dengan data dari database
                document.getElementById('workStart').value = data.work_start || '08:00'
                document.getElementById('workEnd').value = data.work_end || '17:00'
                document.getElementById('trackingInterval').value = data.tracking_interval_minutes || 5
                document.getElementById('customerRadius').value = data.customer_radius_meter || 100
                document.getElementById('lateTolerance').value = data.late_tolerance_minutes || 15
            } else {
                // Gunakan default
                this.settingsId = null
                this.setDefaultValues()
            }

            // Load extra settings dari localStorage
            this.loadExtraSettings()

        } catch (error) {
            console.error('Error loading settings:', error)
            this.setDefaultValues()
            this.loadExtraSettings()
        }
    }

    setDefaultValues() {
        document.getElementById('workStart').value = '08:00'
        document.getElementById('workEnd').value = '17:00'
        document.getElementById('trackingInterval').value = '5'
        document.getElementById('customerRadius').value = '100'
        document.getElementById('lateTolerance').value = '15'
    }

    loadExtraSettings() {
        const extra = JSON.parse(localStorage.getItem('afco_settings_extra') || '{}')

        document.getElementById('minMovement').value = extra.min_movement || 20
        document.getElementById('onlineThreshold').value = extra.online_threshold || 5
        document.getElementById('offlineThreshold').value = extra.offline_threshold || 15
        document.getElementById('minAttendance').value = extra.min_attendance || 20
        document.getElementById('requireCheckout').checked = extra.require_checkout !== undefined ? extra.require_checkout : true
        document.getElementById('allowEarlyCheckout').checked = extra.allow_early_checkout || false
        document.getElementById('notifGpsOffline').checked = extra.notif_gps_offline !== undefined ? extra.notif_gps_offline : true
        document.getElementById('notifLate').checked = extra.notif_late !== undefined ? extra.notif_late : true
        document.getElementById('notifCheckIn').checked = extra.notif_checkin !== undefined ? extra.notif_checkin : true
        document.getElementById('language').value = extra.language || 'id'
        document.getElementById('timezone').value = extra.timezone || 'Asia/Jakarta'
        document.getElementById('companyLogo').value = extra.company_logo || ''
        document.getElementById('companyName').value = extra.company_name || 'Oishii'
    }

    // ============================================================
    // SAVE SETTINGS
    // ============================================================

    async saveSettings() {
        const saveBtn = document.getElementById('saveSettings')
        saveBtn.disabled = true
        saveBtn.textContent = '⏳ Menyimpan...'

        try {
            // 1. Save ke database (work_settings)
            const workStart = document.getElementById('workStart').value
            const workEnd = document.getElementById('workEnd').value
            const trackingInterval = parseInt(document.getElementById('trackingInterval').value)
            const customerRadius = parseInt(document.getElementById('customerRadius').value)
            const lateTolerance = parseInt(document.getElementById('lateTolerance').value)

            const data = {
                work_start: workStart,
                work_end: workEnd,
                tracking_interval_minutes: trackingInterval,
                customer_radius_meter: customerRadius,
                late_tolerance_minutes: lateTolerance,
                updated_at: new Date().toISOString()
            }

            if (this.settingsId) {
                // Update
                const { error } = await supabase
                    .from('work_settings')
                    .update(data)
                    .eq('id', this.settingsId)

                if (error) throw error

            } else {
                // Insert
                data.active = true
                data.created_at = new Date().toISOString()
                const { data: inserted, error } = await supabase
                    .from('work_settings')
                    .insert([data])
                    .select()
                    .single()

                if (error) throw error
                this.settingsId = inserted.id
            }

            // 2. Save extra settings ke localStorage
            const extra = {
                min_movement: parseInt(document.getElementById('minMovement').value) || 20,
                online_threshold: parseInt(document.getElementById('onlineThreshold').value) || 5,
                offline_threshold: parseInt(document.getElementById('offlineThreshold').value) || 15,
                min_attendance: parseInt(document.getElementById('minAttendance').value) || 20,
                require_checkout: document.getElementById('requireCheckout').checked,
                allow_early_checkout: document.getElementById('allowEarlyCheckout').checked,
                notif_gps_offline: document.getElementById('notifGpsOffline').checked,
                notif_late: document.getElementById('notifLate').checked,
                notif_checkin: document.getElementById('notifCheckIn').checked,
                language: document.getElementById('language').value,
                timezone: document.getElementById('timezone').value,
                company_logo: document.getElementById('companyLogo').value,
                company_name: document.getElementById('companyName').value || 'Oishii'
            }

            localStorage.setItem('afco_settings_extra', JSON.stringify(extra))

            this.showToast('✅ Pengaturan berhasil disimpan!')
            await this.logAudit('update_settings', 'Pengaturan sistem diperbarui')

        } catch (error) {
            console.error('Error saving settings:', error)
            this.showToast('❌ Gagal menyimpan pengaturan: ' + error.message)
        } finally {
            saveBtn.disabled = false
            saveBtn.textContent = '💾 Simpan Semua Pengaturan'
        }
    }

    // ============================================================
    // RESET SETTINGS
    // ============================================================

    resetSettings() {
        if (!confirm('Yakin ingin mereset semua pengaturan ke default?')) return

        // Reset form ke default
        document.getElementById('workStart').value = this.defaultSettings.work_start
        document.getElementById('workEnd').value = this.defaultSettings.work_end
        document.getElementById('trackingInterval').value = this.defaultSettings.tracking_interval_minutes
        document.getElementById('customerRadius').value = this.defaultSettings.customer_radius_meter
        document.getElementById('lateTolerance').value = this.defaultSettings.late_tolerance_minutes

        document.getElementById('minMovement').value = this.defaultSettings.min_movement
        document.getElementById('onlineThreshold').value = this.defaultSettings.online_threshold
        document.getElementById('offlineThreshold').value = this.defaultSettings.offline_threshold
        document.getElementById('minAttendance').value = this.defaultSettings.min_attendance
        document.getElementById('requireCheckout').checked = this.defaultSettings.require_checkout
        document.getElementById('allowEarlyCheckout').checked = this.defaultSettings.allow_early_checkout
        document.getElementById('notifGpsOffline').checked = this.defaultSettings.notif_gps_offline
        document.getElementById('notifLate').checked = this.defaultSettings.notif_late
        document.getElementById('notifCheckIn').checked = this.defaultSettings.notif_checkin
        document.getElementById('language').value = this.defaultSettings.language
        document.getElementById('timezone').value = this.defaultSettings.timezone
        document.getElementById('companyLogo').value = this.defaultSettings.company_logo
        document.getElementById('companyName').value = this.defaultSettings.company_name

        // Hapus localStorage
        localStorage.removeItem('afco_settings_extra')

        this.showToast('✅ Pengaturan direset ke default')
    }

    // ============================================================
    // AUDIT LOG
    // ============================================================

    async logAudit(action, description) {
        try {
            await supabase
                .from('audit_logs')
                .insert([{
                    user_id: this.user.id,
                    action: action,
                    description: description,
                    user_agent: navigator.userAgent
                }])
        } catch (error) {
            console.error('Audit log error:', error)
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        document.getElementById('settingsDate').textContent = now.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
    }

    showToast(message) {
        const toast = document.createElement('div')
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 9999;
            font-size: 14px;
            font-family: Arial, sans-serif;
            max-width: 90%;
            text-align: center;
            transition: opacity 0.3s;
        `
        toast.textContent = message
        document.body.appendChild(toast)

        setTimeout(() => {
            toast.style.opacity = '0'
            setTimeout(() => toast.remove(), 300)
        }, 3000)
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    setupEventListeners() {
        // Save
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings()
        })

        // Reset
        document.getElementById('resetSettings').addEventListener('click', () => {
            this.resetSettings()
        })

        // Menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed')
        })

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await supabase.auth.signOut()
            window.location.href = '../auth/login.html'
        })

        // Enter key pada input
        document.querySelectorAll('#settingsContainer input, #settingsContainer select').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveSettings()
                }
            })
        })
    }
}

// ============================================================
// INIT
// ============================================================
const settings = new Settings()
settings.init()
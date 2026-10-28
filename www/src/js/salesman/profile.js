import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// PROFILE CLASS
// ============================================================
class SalesmanProfile {
    constructor() {
        this.user = null
        this.profile = null
        this.attendanceHistory = []
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
                .maybeSingle()

            if (profileError || !profile) {
                window.location.href = '../auth/login.html'
                return
            }

            this.profile = profile

            // 3. Cek role salesman
            if (profile.role !== 'salesman') {
                window.location.href = '../admin/dashboard.html'
                return
            }

            // 4. Setup UI
            this.updateDateTime()
            this.loadProfile()

            // 5. Setup event listeners
            this.setupEventListeners()

            // 6. Set default month = bulan ini
            const now = new Date()
            const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
            document.getElementById('historyMonth').value = monthStr

            // 7. Load attendance history
            await this.loadAttendanceHistory()

        } catch (error) {
            console.error('Profile init error:', error)
            this.showToast('❌ Gagal memuat profil: ' + error.message)
        }
    }

    // ============================================================
    // LOAD PROFILE
    // ============================================================

    loadProfile() {
        document.getElementById('profileName').textContent = this.profile.full_name
        document.getElementById('profileCode').textContent = this.profile.employee_code || '-'

        // Avatar - ambil inisial
        const initials = this.profile.full_name
            .split(' ')
            .map(w => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        document.getElementById('profileAvatar').textContent = initials || '👤'

        // Role
        const roleMap = {
            'salesman': '🟢 Salesman',
            'admin': '🟠 Admin',
            'super_admin': '🔴 Super Admin'
        }
        document.getElementById('profileRole').textContent = roleMap[this.profile.role] || this.profile.role

        // Email (ambil dari user)
        document.getElementById('profileEmail').textContent = this.user.email || '-'

        // Phone
        document.getElementById('profilePhone').textContent = this.profile.phone || '-'

        // Joined date
        if (this.profile.created_at) {
            const date = new Date(this.profile.created_at)
            document.getElementById('profileJoined').textContent = date.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            })
        }

        // Status
        document.getElementById('profileStatus').textContent = this.profile.active ? '✅ Aktif' : '❌ Nonaktif'
        document.getElementById('profileStatus').style.color = this.profile.active ? '#2e7d32' : '#c62828'
    }

    // ============================================================
    // LOAD ATTENDANCE HISTORY
    // ============================================================

    async loadAttendanceHistory() {
        const month = document.getElementById('historyMonth').value

        if (!month) {
            document.getElementById('historyList').innerHTML = '<div class="empty-text">Pilih bulan untuk melihat riwayat</div>'
            return
        }

        try {
            const [year, monthNum] = month.split('-').map(Number)
            const startDate = new Date(year, monthNum - 1, 1)
            const endDate = new Date(year, monthNum, 0) // last day of month

            const startStr = startDate.toISOString().split('T')[0]
            const endStr = endDate.toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('attendance')
                .select('*')
                .eq('user_id', this.user.id)
                .gte('attendance_date', startStr)
                .lte('attendance_date', endStr)
                .order('attendance_date', { ascending: false })

            if (error) throw error

            this.attendanceHistory = data || []
            this.renderAttendanceHistory()

        } catch (error) {
            console.error('Error loading attendance history:', error)
            this.showToast('❌ Gagal memuat riwayat absensi')
        }
    }

    renderAttendanceHistory() {
        const container = document.getElementById('historyList')

        if (this.attendanceHistory.length === 0) {
            container.innerHTML = `
                <div class="empty-text">
                    📭 Tidak ada data absensi untuk bulan ini
                </div>
            `
            return
        }

        let html = ''
        this.attendanceHistory.forEach(att => {
            const statusMap = {
                'checked_in': { label: '✅ Masuk', class: 'checked_in' },
                'checked_out': { label: '🏠 Pulang', class: 'checked_out' },
                'pending': { label: '⏳ Belum', class: 'pending' }
            }
            const status = statusMap[att.status] || statusMap.pending

            const checkIn = att.check_in_at
                ? new Date(att.check_in_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-'

            const checkOut = att.check_out_at
                ? new Date(att.check_out_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-'

            const date = new Date(att.attendance_date + 'T00:00:00')
            const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

            html += `
                <div class="history-item">
                    <div>
                        <div class="date">${date.getDate()} ${this.getMonthName(date.getMonth())} ${date.getFullYear()}</div>
                        <div style="font-size:11px;color:#999;">${days[date.getDay()]}</div>
                    </div>
                    <div class="times">
                        ${checkIn} - ${checkOut}
                    </div>
                    <span class="status ${status.class}">${status.label}</span>
                </div>
            `
        })

        container.innerHTML = html
    }

    getMonthName(month) {
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ]
        return months[month]
    }

    // ============================================================
    // LOGOUT
    // ============================================================

    async logout() {
        if (!confirm('Yakin ingin logout?')) return

        try {
            await supabase.auth.signOut()
            window.location.href = '../auth/login.html'
        } catch (error) {
            console.error('Logout error:', error)
            this.showToast('❌ Gagal logout')
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        document.getElementById('headerDate').textContent = now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    showToast(message) {
        const toast = document.createElement('div')
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 9999;
            font-size: 14px;
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
        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout()
        })

        // Load history
        document.getElementById('loadHistory').addEventListener('click', () => {
            this.loadAttendanceHistory()
        })

        // Enter key pada month input
        document.getElementById('historyMonth').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.loadAttendanceHistory()
            }
        })
    }
}

// ============================================================
// INIT
// ============================================================
const profile = new SalesmanProfile()
profile.init()
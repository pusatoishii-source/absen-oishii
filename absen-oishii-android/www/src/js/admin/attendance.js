import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

class AdminAttendance {
    constructor() {
        this.user = null
        this.profile = null
        this.salesmen = []
        this.salesmenMap = {}
        this.attendance = []
    }

    async init() {
        try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()
            if (sessionError || !session) {
                window.location.href = '../auth/login.html'
                return
            }

            this.user = session.user

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

            if (!['admin', 'super_admin'].includes(profile.role)) {
                window.location.href = '../salesman/dashboard.html'
                return
            }

            this.updateDateTime()
            await this.loadSalesmen()

            const today = new Date().toISOString().split('T')[0]
            document.getElementById('filterAttendanceDate').value = today

            await this.loadAttendance()
            this.setupEventListeners()

        } catch (error) {
            console.error('Attendance init error:', error)
        }
    }

    async loadSalesmen() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('user_id, full_name, employee_code')
                .eq('role', 'salesman')
                .eq('active', true)
                .order('full_name')

            if (error) throw error
            this.salesmen = data || []
            this.salesmenMap = {}
            this.salesmen.forEach(s => { this.salesmenMap[s.user_id] = s })

            const select = document.getElementById('filterSalesmanAttendance')
            select.innerHTML = '<option value="all">Semua Salesman</option>'
            this.salesmen.forEach(s => {
                const option = document.createElement('option')
                option.value = s.user_id
                option.textContent = `${s.full_name} (${s.employee_code})`
                select.appendChild(option)
            })

        } catch (error) {
            console.error('Error loading salesmen:', error)
        }
    }

    async loadAttendance() {
        const date = document.getElementById('filterAttendanceDate').value
        const salesmanId = document.getElementById('filterSalesmanAttendance').value
        const status = document.getElementById('filterStatusAttendance').value

        if (!date) {
            this.showToast('⚠️ Pilih tanggal terlebih dahulu')
            return
        }

        try {
            // ---- TANPA JOIN FK ----
            let query = supabase
                .from('attendance')
                .select('*')
                .eq('attendance_date', date)

            if (salesmanId !== 'all') {
                query = query.eq('user_id', salesmanId)
            }

            if (status !== 'all') {
                query = query.eq('status', status)
            }

            const { data, error } = await query.order('check_in_at', { ascending: false })
            if (error) throw error

            // Gabung manual dengan profiles
            this.attendance = (data || []).map(a => ({
                ...a,
                profiles: this.salesmenMap[a.user_id] || {}
            }))

            this.renderAttendance()
            this.renderStats()

        } catch (error) {
            console.error('Error loading attendance:', error)
            this.showToast('❌ Gagal memuat data absensi: ' + error.message)
        }
    }

    renderAttendance() {
        const tbody = document.getElementById('attendanceTableBody')

        if (this.attendance.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-text">Tidak ada data absensi untuk tanggal ini</td>
                </tr>
            `
            document.getElementById('attendanceCount').textContent = ''
            return
        }

        let html = ''
        this.attendance.forEach(att => {
            const checkIn = att.check_in_at
                ? new Date(att.check_in_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-'

            const checkOut = att.check_out_at
                ? new Date(att.check_out_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-'

            let duration = '-'
            if (att.check_in_at && att.check_out_at) {
                const start = new Date(att.check_in_at)
                const end = new Date(att.check_out_at)
                const diffMs = end - start
                const hours = Math.floor(diffMs / (1000 * 60 * 60))
                const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
                duration = `${hours}j ${minutes}m`
            }

            const statusMap = {
                'checked_in': { label: '✅ Masuk', class: 'checked_in' },
                'checked_out': { label: '🏠 Pulang', class: 'checked_out' },
                'pending': { label: '⏳ Belum', class: 'pending' }
            }
            const status = statusMap[att.status] || statusMap.pending

            const salesmanName = att.profiles?.full_name || 'Unknown'
            const employeeCode = att.profiles?.employee_code || '-'

            html += `
                <tr>
                    <td><strong>${salesmanName}</strong></td>
                    <td>${employeeCode}</td>
                    <td>${att.attendance_date}</td>
                    <td>${checkIn}</td>
                    <td>${checkOut}</td>
                    <td>${duration}</td>
                    <td><span class="status-badge ${status.class}">${status.label}</span></td>
                    <td>
                        <button class="btn-detail" data-userid="${att.user_id}" data-date="${att.attendance_date}">
                            Detail
                        </button>
                    </td>
                </tr>
            `
        })

        tbody.innerHTML = html
        document.getElementById('attendanceCount').textContent = `${this.attendance.length} data`

        tbody.querySelectorAll('.btn-detail').forEach(btn => {
            btn.addEventListener('click', () => {
                const userId = btn.dataset.userid
                const date = btn.dataset.date
                window.location.href = `history.html?userId=${userId}&date=${date}`
            })
        })
    }

    renderStats() {
        const stats = document.getElementById('attendanceStats')
        stats.style.display = 'grid'

        const total = this.attendance.length
        const checkedIn = this.attendance.filter(a => a.status === 'checked_in').length
        const checkedOut = this.attendance.filter(a => a.status === 'checked_out').length
        const pending = this.attendance.filter(a => a.status === 'pending').length

        document.getElementById('statTotal').textContent = total
        document.getElementById('statCheckedIn').textContent = checkedIn
        document.getElementById('statCheckedOut').textContent = checkedOut
        document.getElementById('statPending').textContent = pending
    }

    updateDateTime() {
        const now = new Date()
        document.getElementById('attendanceDate').textContent = now.toLocaleDateString('id-ID', {
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

    setupEventListeners() {
        document.getElementById('loadAttendance').addEventListener('click', () => {
            this.loadAttendance()
        })
        document.getElementById('filterAttendanceDate').addEventListener('change', () => {
            this.loadAttendance()
        })
        document.getElementById('filterAttendanceDate').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.loadAttendance()
        })
        document.getElementById('filterSalesmanAttendance').addEventListener('change', () => {
            this.loadAttendance()
        })
        document.getElementById('filterStatusAttendance').addEventListener('change', () => {
            this.loadAttendance()
        })
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed')
        })
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await supabase.auth.signOut()
            window.location.href = '../auth/login.html'
        })
    }
}

const attendance = new AdminAttendance()
attendance.init()
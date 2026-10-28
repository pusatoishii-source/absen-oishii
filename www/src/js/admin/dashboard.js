import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

class AdminDashboard {
    constructor() {
        this.data = {
            salesmen: [],
            attendance: [],
            locations: []
        }
        this.user = null
        this.profile = null
        this.loading = false
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
                .single()

            if (profileError || !profile) {
                window.location.href = '../auth/login.html'
                return
            }

            this.profile = profile

            if (!['admin', 'super_admin'].includes(profile.role)) {
                window.location.href = '../salesman/dashboard.html'
                return
            }

            this.setupUI()
            this.updateDateTime()
            await this.loadData()
            this.setupRealtime()
            this.setupEventListeners()

            setInterval(() => this.refreshData(true), 60000)

        } catch (error) {
            console.error('Dashboard init error:', error)
        }
    }

    setupUI() {
        document.getElementById('adminName').textContent = this.profile.full_name
    }

    updateDateTime() {
        const now = new Date()
        document.getElementById('adminDate').textContent = now.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    async loadData() {
        if (this.loading) return
        this.loading = true

        try {
            const today = new Date().toISOString().split('T')[0]

            // 1. Salesman
            const { data: salesmen, error: salesmenError } = await supabase
                .from('profiles')
                .select('*')
                .eq('role', 'salesman')
                .eq('active', true)
                .order('full_name')

            if (salesmenError) throw salesmenError
            this.data.salesmen = salesmen || []

            // 2. Attendance hari ini
            const { data: attendance, error: attendanceError } = await supabase
                .from('attendance')
                .select('*')
                .eq('attendance_date', today)

            if (!attendanceError) {
                this.data.attendance = attendance || []
            }

            // 3. Lokasi terakhir — manual, tanpa RPC
            if (this.data.salesmen.length > 0) {
                const userIds = this.data.salesmen.map(s => s.user_id)
                const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
                const { data: locations, error: locationError } = await supabase
                    .from('location_tracking')
                    .select('user_id, latitude, longitude, recorded_at, accuracy')
                    .in('user_id', userIds)
                    .gte('recorded_at', since)
                    .order('recorded_at', { ascending: false })

                if (!locationError) {
                    // Ambil lokasi terbaru per user
                    const latestMap = {}
                    ;(locations || []).forEach(loc => {
                        if (!latestMap[loc.user_id]) {
                            latestMap[loc.user_id] = loc
                        }
                    })
                    this.data.locations = Object.values(latestMap)
                }
            }

            this.updateStats()
            this.updateTable()

        } catch (error) {
            console.error('Error loading data:', error)
        } finally {
            this.loading = false
        }
    }

    updateStats() {
        const total = this.data.salesmen.length

        const checkedIn = this.data.attendance.filter(a => a.status === 'checked_in').length
        const checkedOut = this.data.attendance.filter(a => a.status === 'checked_out').length
        const pending = total - checkedIn - checkedOut

        let online = 0
        let offline = 0

        this.data.salesmen.forEach(salesman => {
            const location = this.data.locations.find(l => l.user_id === salesman.user_id)
            if (location) {
                const lastUpdate = new Date(location.recorded_at)
                const minutesSince = Math.floor((new Date() - lastUpdate) / 60000)
                if (minutesSince < 5) {
                    online++
                } else {
                    offline++
                }
            } else {
                offline++
            }
        })

        document.getElementById('totalSalesmen').textContent = total
        document.getElementById('checkedIn').textContent = checkedIn
        document.getElementById('pendingIn').textContent = pending > 0 ? pending : 0
        document.getElementById('checkedOut').textContent = checkedOut
        document.getElementById('gpsOnline').textContent = online
        document.getElementById('gpsOffline').textContent = offline
    }

    updateTable() {
        const tbody = document.getElementById('salesmanTableBody')

        if (this.data.salesmen.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-text">Tidak ada salesman aktif</td></tr>`
            return
        }

        let html = ''
        this.data.salesmen.forEach(salesman => {
            const attendance = this.data.attendance.find(a => a.user_id === salesman.user_id)
            const location = this.data.locations.find(l => l.user_id === salesman.user_id)

            const status = attendance ? attendance.status : 'pending'
            const checkInTime = attendance?.check_in_at
                ? new Date(attendance.check_in_at).toLocaleTimeString('id-ID')
                : '-'

            let gpsStatus = '🔴 OFFLINE'
            let gpsClass = 'offline'
            if (location) {
                const lastUpdate = new Date(location.recorded_at)
                const minutesSince = Math.floor((new Date() - lastUpdate) / 60000)
                if (minutesSince < 5) {
                    gpsStatus = '🟢 ONLINE'
                    gpsClass = 'online'
                } else if (minutesSince < 15) {
                    gpsStatus = '🟡 WARNING'
                    gpsClass = 'warning'
                }
            }

            const locationStr = location
                ? `${Number(location.latitude).toFixed(6)}, ${Number(location.longitude).toFixed(6)}`
                : '-'

            const lastUpdateStr = location?.recorded_at
                ? new Date(location.recorded_at).toLocaleTimeString('id-ID')
                : '-'

            const statusMap = {
                'pending': { label: 'Belum Absen', color: '#999' },
                'checked_in': { label: 'Sedang Bekerja', color: '#4CAF50' },
                'checked_out': { label: 'Selesai', color: '#666' }
            }
            const statusInfo = statusMap[status] || statusMap.pending

            html += `
                <tr>
                    <td>
                        <strong>${salesman.full_name}</strong>
                        <br>
                        <small style="color:#999;">${salesman.employee_code}</small>
                    </td>
                    <td>
                        <span class="status-badge" style="background:${statusInfo.color}">
                            ${statusInfo.label}
                        </span>
                    </td>
                    <td>${checkInTime}</td>
                    <td>${lastUpdateStr}</td>
                    <td><small>${locationStr}</small></td>
                    <td>
                        <span class="gps-status-badge ${gpsClass}">
                            ${gpsStatus}
                        </span>
                    </td>
                </tr>
            `
        })

        tbody.innerHTML = html
    }

    setupRealtime() {
        supabase
            .channel('admin-dashboard')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
                this.refreshData(true)
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_tracking' }, () => {
                this.refreshData(true)
            })
            .subscribe()
    }

    setupEventListeners() {
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed')
        })
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refreshData(false)
        })
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await supabase.auth.signOut()
            window.location.href = '../auth/login.html'
        })
    }

    async refreshData(silent = false) {
        await this.loadData()
        if (!silent) this.showToast('Data diperbarui')
    }

    showToast(message) {
        const toast = document.createElement('div')
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 9999;
            transition: opacity 0.3s;
            font-size: 14px;
        `
        toast.textContent = message
        document.body.appendChild(toast)

        setTimeout(() => {
            toast.style.opacity = '0'
            setTimeout(() => toast.remove(), 300)
        }, 2000)
    }
}

const dashboard = new AdminDashboard()
dashboard.init()
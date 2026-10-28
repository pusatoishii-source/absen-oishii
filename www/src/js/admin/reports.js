import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

class Reports {
    constructor() {
        this.user = null
        this.profile = null
        this.reportData = []
        this.salesmen = []
        this.salesmenMap = {}
        this.locations = []
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

            this.updateDateTime()
            await this.loadSalesmen()
            this.setDefaultDates()
            this.setupEventListeners()

        } catch (error) {
            console.error('Reports init error:', error)
        }
    }

    async loadSalesmen() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('user_id, full_name, employee_code')
                .eq('role', 'salesman')
                .order('full_name')

            if (error) throw error
            this.salesmen = data || []
            this.salesmenMap = {}
            this.salesmen.forEach(s => {
                this.salesmenMap[s.user_id] = s
            })

            const select = document.getElementById('filterSalesman')
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

    setDefaultDates() {
        const today = new Date()
        const startDate = new Date(today)
        startDate.setDate(today.getDate() - 30)

        document.getElementById('filterStartDate').value = startDate.toISOString().split('T')[0]
        document.getElementById('filterEndDate').value = today.toISOString().split('T')[0]
    }

    async generateReport() {
        const salesmanId = document.getElementById('filterSalesman').value
        const startDate = document.getElementById('filterStartDate').value
        const endDate = document.getElementById('filterEndDate').value
        const status = document.getElementById('filterStatus').value

        if (!startDate || !endDate) {
            this.showToast('⚠️ Pilih periode tanggal terlebih dahulu')
            return
        }

        try {
            this.showToast('⏳ Memuat data...')

            // ---- TAHAP 1: Ambil attendance (TANPA JOIN FK) ----
            let query = supabase
                .from('attendance')
                .select('*')
                .gte('attendance_date', startDate)
                .lte('attendance_date', endDate)
                .order('attendance_date', { ascending: false })

            if (salesmanId !== 'all') {
                query = query.eq('user_id', salesmanId)
            }

            if (status !== 'all') {
                query = query.eq('status', status)
            }

            const { data: attendance, error: attendanceError } = await query
            if (attendanceError) throw attendanceError

            // ---- TAHAP 2: Ambil semua profiles ----
            const userIds = [...new Set((attendance || []).map(a => a.user_id))]
            let profilesMap = {}
            if (userIds.length > 0) {
                const { data: profiles, error: profErr } = await supabase
                    .from('profiles')
                    .select('user_id, full_name, employee_code')
                    .in('user_id', userIds)
                if (!profErr) {
                    (profiles || []).forEach(p => { profilesMap[p.user_id] = p })
                }
            }

            // ---- TAHAP 3: Ambil tracking points ----
            let locationData = []
            if (userIds.length > 0) {
                const { data: locations, error: locationError } = await supabase
                    .from('location_tracking')
                    .select('user_id, latitude, longitude, recorded_at')
                    .in('user_id', userIds)
                    .gte('recorded_at', startDate + 'T00:00:00')
                    .lte('recorded_at', endDate + 'T23:59:59')

                if (!locationError) {
                    locationData = locations || []
                }
            }

            this.locations = locationData

            // ---- TAHAP 4: Gabung manual ----
            const enriched = (attendance || []).map(a => ({
                ...a,
                profiles: profilesMap[a.user_id] || {}
            }))

            this.reportData = this.processReportData(enriched, locationData)
            this.displayReport()
            this.displayStats()

            document.getElementById('reportTitle').textContent = `📋 Laporan Absensi (${startDate} - ${endDate})`
            document.getElementById('reportDateInfo').textContent = `Periode: ${startDate} s/d ${endDate}`

        } catch (error) {
            console.error('Error generating report:', error)
            this.showToast('❌ Gagal generate laporan: ' + error.message)
        }
    }

    // ============================================================
    // HELPER — Format tanggal & waktu
    // ============================================================

    formatTime(timestamp) {
        if (!timestamp) return '-'
        try {
            const date = new Date(timestamp)
            if (isNaN(date.getTime())) return '-'

            // Manual format HH:MM — lebih andal daripada toLocaleTimeString
            const hours = String(date.getHours()).padStart(2, '0')
            const minutes = String(date.getMinutes()).padStart(2, '0')
            return `${hours}:${minutes}`
        } catch (e) {
            console.error('Format time error:', e, timestamp)
            return '-'
        }
    }

    formatDuration(checkIn, checkOut) {
        if (!checkIn || !checkOut) return '-'
        try {
            const start = new Date(checkIn)
            const end = new Date(checkOut)
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-'

            const diffMs = end - start
            if (diffMs < 0) return '-'

            const hours = Math.floor(diffMs / (1000 * 60 * 60))
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
            return `${hours}j ${minutes}m`
        } catch (e) {
            return '-'
        }
    }

    processReportData(attendance, locations) {
        return attendance.map(a => {
            // Format waktu
            const checkInTime = this.formatTime(a.check_in_at)
            const checkOutTime = this.formatTime(a.check_out_at)
            const duration = this.formatDuration(a.check_in_at, a.check_out_at)

            // Hitung jarak
            const userLocations = locations.filter(l => l.user_id === a.user_id)
            const totalPoints = userLocations.length

            let totalDistance = 0
            if (userLocations.length > 1) {
                for (let i = 1; i < userLocations.length; i++) {
                    const prev = userLocations[i - 1]
                    const curr = userLocations[i]
                    totalDistance += this.calculateDistance(
                        prev.latitude, prev.longitude,
                        curr.latitude, curr.longitude
                    )
                }
            }

            const statusMap = {
                'checked_in': '🟢 Sedang Bekerja',
                'checked_out': '⚫ Selesai',
                'pending': '🔴 Belum Absen'
            }

            return {
                user_id: a.user_id,
                full_name: a.profiles?.full_name || 'Unknown',
                employee_code: a.profiles?.employee_code || '-',
                attendance_date: a.attendance_date,
                check_in_at: checkInTime,
                check_out_at: checkOutTime,
                duration: duration,
                status: statusMap[a.status] || a.status,
                status_raw: a.status,
                total_points: totalPoints,
                total_distance: totalDistance.toFixed(2),
                check_in_latitude: a.check_in_latitude,
                check_in_longitude: a.check_in_longitude,
                check_out_latitude: a.check_out_latitude,
                check_out_longitude: a.check_out_longitude,
                attendance_id: a.id
            }
        })
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371
        const dLat = this.toRad(lat2 - lat1)
        const dLon = this.toRad(lon2 - lon1)
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    toRad(deg) {
        return deg * Math.PI / 180
    }

    displayReport() {
        const tbody = document.getElementById('reportTableBody')
        const wrapper = document.getElementById('reportWrapper')

        if (this.reportData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-text">Tidak ada data untuk periode yang dipilih</td>
                </tr>
            `
            wrapper.classList.add('show')
            return
        }

        wrapper.classList.add('show')

        let html = ''
        this.reportData.forEach(row => {
            const statusColor = row.status_raw === 'checked_in' ? '#4CAF50' :
                               row.status_raw === 'checked_out' ? '#666' : '#999'

            html += `
                <tr>
                    <td><strong>${row.full_name}</strong></td>
                    <td>${row.employee_code}</td>
                    <td>${row.attendance_date}</td>
                    <td>${row.check_in_at}</td>
                    <td>${row.check_out_at}</td>
                    <td>${row.duration}</td>
                    <td><span style="color:${statusColor};font-weight:500;">${row.status}</span></td>
                    <td>${row.total_points}</td>
                    <td>${row.total_distance}</td>
                </tr>
            `
        })

        tbody.innerHTML = html
    }

    displayStats() {
        const total = this.reportData.length
        const checkIn = this.reportData.filter(r => r.status_raw === 'checked_in').length
        const checkOut = this.reportData.filter(r => r.status_raw === 'checked_out').length
        const pending = this.reportData.filter(r => r.status_raw === 'pending').length
        const totalPoints = this.reportData.reduce((sum, r) => sum + r.total_points, 0)

        let gpsOnline = 0
        const now = new Date()
        this.reportData.forEach(r => {
            if (r.status_raw === 'checked_in') {
                const locations = this.locations.filter(l => l.user_id === r.user_id)
                if (locations.length > 0) {
                    const lastLoc = locations[locations.length - 1]
                    const lastUpdate = new Date(lastLoc.recorded_at)
                    const minutesSince = Math.floor((now - lastUpdate) / 60000)
                    if (minutesSince < 5) gpsOnline++
                }
            }
        })

        document.getElementById('reportStats').style.display = 'grid'
        document.getElementById('statTotal').textContent = total
        document.getElementById('statCheckIn').textContent = checkIn
        document.getElementById('statCheckOut').textContent = checkOut
        document.getElementById('statPending').textContent = pending
        document.getElementById('statGpsOnline').textContent = gpsOnline
        document.getElementById('statTotalPoints').textContent = totalPoints
    }

    exportCSV() {
        if (this.reportData.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk diekspor')
            return
        }

        const headers = ['Salesman', 'Kode', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Durasi', 'Status', 'Jumlah GPS', 'Jarak (km)']
        let csv = headers.join(',') + '\n'

        this.reportData.forEach(row => {
            csv += [
                `"${row.full_name}"`,
                `"${row.employee_code}"`,
                row.attendance_date,
                row.check_in_at,
                row.check_out_at,
                row.duration,
                `"${row.status}"`,
                row.total_points,
                row.total_distance
            ].join(',') + '\n'
        })

        this.downloadFile(csv, 'text/csv', `laporan_${new Date().toISOString().split('T')[0]}.csv`)
        this.showToast('✅ CSV berhasil diekspor')
    }

    exportExcel() {
        if (this.reportData.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk diekspor')
            return
        }

        let html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" 
                  xmlns:x="urn:schemas-microsoft-com:office:excel" 
                  xmlns="http://www.w3.org/TR/REC-html40">
            <head><meta charset="UTF-8">
            <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
            <x:Name>Laporan</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
            <style>
                th { background: #d32f2f; color: white; padding: 8px; }
                td { padding: 6px 8px; border: 1px solid #ddd; }
                table { border-collapse: collapse; width: 100%; }
            </style>
            </head><body>
            <h2>Laporan Absensi Salesman</h2>
            <p>Periode: ${document.getElementById('filterStartDate').value} s/d ${document.getElementById('filterEndDate').value}</p>
            <table>
                <thead>
                    <tr>
                        <th>Salesman</th>
                        <th>Kode</th>
                        <th>Tanggal</th>
                        <th>Jam Masuk</th>
                        <th>Jam Pulang</th>
                        <th>Durasi</th>
                        <th>Status</th>
                        <th>Jumlah GPS</th>
                        <th>Jarak (km)</th>
                    </tr>
                </thead>
                <tbody>
        `

        this.reportData.forEach(row => {
            html += `
                <tr>
                    <td>${row.full_name}</td>
                    <td>${row.employee_code}</td>
                    <td>${row.attendance_date}</td>
                    <td>${row.check_in_at}</td>
                    <td>${row.check_out_at}</td>
                    <td>${row.duration}</td>
                    <td>${row.status}</td>
                    <td>${row.total_points}</td>
                    <td>${row.total_distance}</td>
                </tr>
            `
        })

        html += `
                </tbody>
            </table>
            <p><small>Generated: ${new Date().toLocaleString('id-ID')}</small></p>
            </body></html>
        `

        this.downloadFile(html, 'application/vnd.ms-excel', `laporan_${new Date().toISOString().split('T')[0]}.xls`)
        this.showToast('✅ Excel berhasil diekspor')
    }

    downloadFile(content, type, filename) {
        const blob = new Blob([content], { type: type + ';charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
    }

    printReport() {
        window.print()
    }

    updateDateTime() {
        const now = new Date()
        document.getElementById('reportsDate').textContent = now.toLocaleDateString('id-ID', {
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

    setupEventListeners() {
        document.getElementById('generateReport').addEventListener('click', () => {
            this.generateReport()
        })
        document.getElementById('exportCSV').addEventListener('click', () => {
            this.exportCSV()
        })
        document.getElementById('exportExcel').addEventListener('click', () => {
            this.exportExcel()
        })
        document.getElementById('printReport').addEventListener('click', () => {
            this.printReport()
        })
        document.getElementById('filterStartDate').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.generateReport()
        })
        document.getElementById('filterEndDate').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.generateReport()
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

const reports = new Reports()
reports.init()
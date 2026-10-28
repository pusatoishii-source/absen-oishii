import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// SALESMAN ATTENDANCE CLASS
// ============================================================
class SalesmanAttendance {
    constructor() {
        this.user = null
        this.profile = null
        this.attendance = null
        this.trackingInterval = null
        this.lastPosition = null
        this.isTracking = false
        this.trackingPoints = 0
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
            this.setupEventListeners()

            // 5. Load today's attendance
            await this.loadTodayAttendance()

            // 6. Check GPS status
            this.checkGPSStatus()

            // 7. Load recent history
            await this.loadRecentHistory()

            // 8. Realtime subscription
            this.setupRealtime()

            // 9. Update time every minute
            setInterval(() => this.updateDateTime(), 60000)

        } catch (error) {
            console.error('Attendance init error:', error)
            this.showToast('❌ Gagal memuat data: ' + error.message)
        }
    }

    // ============================================================
    // LOAD TODAY'S ATTENDANCE
    // ============================================================

    async loadTodayAttendance() {
        try {
            const today = new Date().toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('attendance')
                .select('*')
                .eq('user_id', this.user.id)
                .eq('attendance_date', today)
                .maybeSingle()

            if (error) {
                console.error('Attendance query error:', error)
                return
            }

            this.attendance = data
            this.updateTodayUI()

            if (data) {
                if (data.status === 'checked_in') {
                    this.updateCheckInUI()
                    this.startTracking()
                } else if (data.status === 'checked_out') {
                    this.updateCheckOutUI()
                }
            }

        } catch (error) {
            console.error('Error loading attendance:', error)
        }
    }

    // ============================================================
    // UPDATE UI
    // ============================================================

    updateTodayUI() {
        const statusMap = {
            'pending': { label: 'Belum Absen', class: 'pending' },
            'checked_in': { label: '🟢 Sedang Bekerja', class: 'checked_in' },
            'checked_out': { label: '⚫ Selesai Kerja', class: 'checked_out' }
        }

        const info = statusMap[this.attendance?.status] || statusMap.pending
        document.getElementById('todayStatus').textContent = info.label
        document.getElementById('todayStatus').className = `status-big ${info.class}`

        const checkIn = this.attendance?.check_in_at
            ? new Date(this.attendance.check_in_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '--:--'

        const checkOut = this.attendance?.check_out_at
            ? new Date(this.attendance.check_out_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '--:--'

        document.getElementById('todayCheckIn').textContent = checkIn
        document.getElementById('todayCheckOut').textContent = checkOut

        // Hitung durasi
        let duration = '--:--'
        if (this.attendance?.check_in_at && this.attendance?.check_out_at) {
            const start = new Date(this.attendance.check_in_at)
            const end = new Date(this.attendance.check_out_at)
            const diffMs = end - start
            const hours = Math.floor(diffMs / (1000 * 60 * 60))
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
            duration = `${hours}j ${minutes}m`
        } else if (this.attendance?.check_in_at) {
            const start = new Date(this.attendance.check_in_at)
            const now = new Date()
            const diffMs = now - start
            const hours = Math.floor(diffMs / (1000 * 60 * 60))
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
            duration = `${hours}j ${minutes}m (berjalan)`
        }

        document.getElementById('todayDuration').textContent = duration
    }

    updateCheckInUI() {
        const btn = document.getElementById('checkInBtn')
        btn.innerHTML = '✅ SUDAH ABSEN'
        btn.className = 'btn-primary success'
        btn.disabled = true
        document.getElementById('checkOutBtn').disabled = false
    }

    updateCheckOutUI() {
        const btn = document.getElementById('checkOutBtn')
        btn.innerHTML = '✅ SUDAH PULANG'
        btn.className = 'btn-primary success'
        btn.disabled = true
        document.getElementById('checkInBtn').disabled = true
    }

    // ============================================================
    // CHECK IN / OUT
    // ============================================================

    async handleCheckIn() {
        try {
            if (this.attendance && this.attendance.status === 'checked_in') {
                this.showToast('✅ Anda sudah absen masuk hari ini')
                return
            }

            const gpsStatus = await this.checkGPSStatus()
            if (!gpsStatus) {
                this.showToast('⚠️ Lokasi GPS wajib diaktifkan untuk absensi')
                return
            }

            const position = await this.getCurrentPosition()

            const today = new Date().toISOString().split('T')[0]
            const data = {
                user_id: this.user.id,
                attendance_date: today,
                check_in_at: new Date().toISOString(),
                check_in_latitude: position.coords.latitude,
                check_in_longitude: position.coords.longitude,
                check_in_accuracy: position.coords.accuracy,
                status: 'checked_in'
            }

            let result
            if (this.attendance) {
                const { data: updated, error } = await supabase
                    .from('attendance')
                    .update(data)
                    .eq('id', this.attendance.id)
                    .select()
                    .maybeSingle()

                if (error) throw error
                result = updated
            } else {
                const { data: inserted, error } = await supabase
                    .from('attendance')
                    .insert([data])
                    .select()
                    .maybeSingle()

                if (error) throw error
                result = inserted
            }

            this.attendance = result
            this.updateCheckInUI()
            this.updateTodayUI()
            this.startTracking()
            await this.logAudit('check_in', 'Salesman check in')

            this.showToast('✅ Absen masuk berhasil!')

        } catch (error) {
            console.error('Check-in error:', error)
            this.showToast('❌ Gagal absen masuk: ' + error.message)
        }
    }

    async handleCheckOut() {
        try {
            if (!this.attendance || this.attendance.status !== 'checked_in') {
                this.showToast('⚠️ Anda belum absen masuk')
                return
            }

            const position = await this.getCurrentPosition()

            const { data, error } = await supabase
                .from('attendance')
                .update({
                    check_out_at: new Date().toISOString(),
                    check_out_latitude: position.coords.latitude,
                    check_out_longitude: position.coords.longitude,
                    check_out_accuracy: position.coords.accuracy,
                    status: 'checked_out',
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.attendance.id)
                .select()
                .maybeSingle()

            if (error) throw error

            this.attendance = data
            this.updateCheckOutUI()
            this.updateTodayUI()
            this.stopTracking()
            await this.logAudit('check_out', 'Salesman check out')

            this.showToast('✅ Absen pulang berhasil!')

        } catch (error) {
            console.error('Check-out error:', error)
            this.showToast('❌ Gagal absen pulang: ' + error.message)
        }
    }

    // ============================================================
    // GPS TRACKING
    // ============================================================

    async checkGPSStatus() {
        if (!navigator.geolocation) {
            document.getElementById('gpsDot').style.backgroundColor = '#f44336'
            document.getElementById('gpsLabel').textContent = 'GPS: Tidak Didukung'
            return false
        }

        // navigator.permissions.query('geolocation') is unreliable on many
        // Android WebViews / installed PWAs: the OS-level location permission
        // can be granted while the per-origin browser permission it reports
        // is stuck on "prompt". So we don't trust it as the source of truth —
        // we actually try to get a position, which is what really matters,
        // and only use permissions.query (when available) as a live-update hint.
        try {
            const position = await this.getCurrentPosition()
            document.getElementById('gpsDot').style.backgroundColor = '#4CAF50'
            document.getElementById('gpsDot').classList.add('active')
            document.getElementById('gpsLabel').textContent = 'GPS: Aktif'
            this.lastPosition = position
            return true
        } catch (error) {
            console.error('GPS error:', error)

            // GeolocationPositionError codes: 1 = PERMISSION_DENIED,
            // 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
            if (error.code === 1) {
                document.getElementById('gpsDot').style.backgroundColor = '#f44336'
                document.getElementById('gpsDot').classList.remove('active')
                document.getElementById('gpsLabel').textContent = 'GPS: Diblokir'
            } else if (error.code === 3) {
                document.getElementById('gpsDot').style.backgroundColor = '#ff9800'
                document.getElementById('gpsDot').classList.remove('active')
                document.getElementById('gpsLabel').textContent = 'GPS: Timeout, coba lagi'
            } else {
                document.getElementById('gpsDot').style.backgroundColor = '#ff9800'
                document.getElementById('gpsDot').classList.remove('active')
                document.getElementById('gpsLabel').textContent = 'GPS: Tidak Tersedia'
            }
            return false
        } finally {
            // Live-update the badge if the user changes the permission later
            // (e.g. from the browser's site settings) without needing a reload.
            if (navigator.permissions && navigator.permissions.query && !this._gpsPermissionWatched) {
                this._gpsPermissionWatched = true
                try {
                    const result = await navigator.permissions.query({ name: 'geolocation' })
                    result.onchange = () => this.checkGPSStatus()
                } catch (e) {
                    // Permissions API not supported for geolocation on this browser — ignore
                }
            }
        }
    }

    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                resolve,
                reject, {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 5000
                }
            )
        })
    }

    startTracking() {
        if (this.isTracking) return

        this.isTracking = true
        this.trackingPoints = 0

        const interval = 300000

        // APK Android: pakai foreground service agar tetap jalan saat layar mati
        if (window.NativeTracking && window.NativeTracking.isNative) {
            window.NativeTracking.start((coords) => {
                this.saveTrackingPoint(coords)
            }, { intervalMs: interval, distanceFilter: 20 }).then(ok => {
                if (!ok) {
                    console.warn('📍 Native tracking gagal dimulai')
                    this.isTracking = false
                }
            })
            console.log('📍 Native tracking started for user:', this.user.id)
            return
        }

        this.trackingInterval = setInterval(async () => {
            try {
                const position = await this.getCurrentPosition()
                await this.saveTrackingPoint(position.coords)
            } catch (error) {
                console.error('Tracking error:', error)
            }
        }, interval)

        this.getCurrentPosition()
            .then(position => {
                this.saveTrackingPoint(position.coords)
                document.getElementById('gpsCoords').textContent =
                    `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`
            })
            .catch(err => console.error('Initial tracking error:', err))

        console.log('📍 Tracking started for user:', this.user.id)
    }

    async saveTrackingPoint(coords) {
        let pending = null
        try {
            if (this.lastPosition) {
                const distance = this.calculateDistance(
                    this.lastPosition.latitude,
                    this.lastPosition.longitude,
                    coords.latitude,
                    coords.longitude
                )
                if (distance < 0.02) {
                    console.log('📍 Location unchanged, skipping')
                    return
                }
            }

            let batteryLevel = null
            if (navigator.getBattery) {
                try {
                    const battery = await navigator.getBattery()
                    batteryLevel = battery.level * 100
                } catch (e) {}
            }

            const data = {
                user_id: this.user.id,
                attendance_id: this.attendance?.id || null,
                latitude: coords.latitude,
                longitude: coords.longitude,
                accuracy: coords.accuracy || null,
                speed: coords.speed || null,
                heading: coords.heading || null,
                battery_level: batteryLevel,
                recorded_at: new Date().toISOString()
            }
            pending = data

            const { error } = await supabase
                .from('location_tracking')
                .insert([data])

            if (error) throw error
            pending = null

            // Kirim ulang titik yang tertunda saat offline
            if (window.NativeTracking) {
                window.NativeTracking.flush(rows => supabase.from('location_tracking').insert(rows))
            }

            this.lastPosition = coords
            this.trackingPoints++
            document.getElementById('gpsCoords').textContent =
                `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`

            console.log('📍 Tracking point saved:', new Date().toISOString())

        } catch (error) {
            console.error('Save tracking error:', error)
            // Simpan di perangkat, dikirim ulang saat koneksi kembali
            if (pending && window.NativeTracking) window.NativeTracking.queue(pending)
        }
    }

    stopTracking() {
        if (window.NativeTracking && window.NativeTracking.isNative) {
            window.NativeTracking.stop()
        }
        if (this.trackingInterval) {
            clearInterval(this.trackingInterval)
            this.trackingInterval = null
        }
        this.isTracking = false
        console.log('📍 Tracking stopped')
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

    // ============================================================
    // RECENT HISTORY
    // ============================================================

    async loadRecentHistory() {
        try {
            const today = new Date()
            const endDate = new Date(today)
            endDate.setDate(today.getDate() - 5)

            const startStr = endDate.toISOString().split('T')[0]
            const endStr = today.toISOString().split('T')[0]

            const { data, error } = await supabase
                .from('attendance')
                .select('*')
                .eq('user_id', this.user.id)
                .gte('attendance_date', startStr)
                .lte('attendance_date', endStr)
                .order('attendance_date', { ascending: false })
                .limit(5)

            if (error) throw error

            const container = document.getElementById('recentHistory')

            if (!data || data.length === 0) {
                container.innerHTML = `<div class="empty-text">Belum ada data absensi</div>`
                return
            }

            let html = ''
            data.forEach(att => {
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
                            <div class="date">${date.getDate()} ${this.getMonthName(date.getMonth())}</div>
                            <div style="font-size:11px;color:#999;">${days[date.getDay()]}</div>
                        </div>
                        <div class="times">${checkIn} - ${checkOut}</div>
                        <span class="status ${status.class}">${status.label}</span>
                    </div>
                `
            })

            container.innerHTML = html

        } catch (error) {
            console.error('Error loading recent history:', error)
            document.getElementById('recentHistory').innerHTML = `
                <div class="empty-text">❌ Gagal memuat riwayat</div>
            `
        }
    }

    getMonthName(month) {
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ]
        return months[month]
    }

    // ============================================================
    // REALTIME
    // ============================================================

    setupRealtime() {
        supabase
            .channel('salesman-attendance')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'attendance',
                filter: `user_id=eq.${this.user.id}`
            }, (payload) => {
                this.attendance = payload.new
                this.updateTodayUI()
                if (payload.new.status === 'checked_out') {
                    this.updateCheckOutUI()
                    this.stopTracking()
                }
            })
            .subscribe()
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
        document.getElementById('headerDate').textContent = now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    showToast(message) {
        const toast = document.getElementById('toast')
        const toastMessage = document.getElementById('toastMessage')

        toastMessage.textContent = message
        toast.classList.remove('hidden')
        toast.classList.add('show')

        setTimeout(() => {
            toast.classList.remove('show')
            toast.classList.add('hidden')
        }, 3000)
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    setupEventListeners() {
        document.getElementById('checkInBtn').addEventListener('click', () => {
            this.handleCheckIn()
        })

        document.getElementById('checkOutBtn').addEventListener('click', () => {
            this.handleCheckOut()
        })
    }
}

// ============================================================
// INIT
// ============================================================
const attendance = new SalesmanAttendance()
attendance.init()
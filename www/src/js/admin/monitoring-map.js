import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// MONITORING MAP CLASS
// ============================================================
class MonitoringMap {
    constructor() {
        this.map = null
        this.markers = {}
        this.data = {
            salesmen: [],
            locations: [],
            attendance: []
        }
        this.user = null
        this.profile = null
        this.selectedSalesman = 'all'
        this.loading = false
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
                console.error('Profile error:', profileError)
                window.location.href = '../auth/login.html'
                return
            }

            this.profile = profile

            // 3. Cek role admin
            if (!['admin', 'super_admin'].includes(profile.role)) {
                window.location.href = '../salesman/dashboard.html'
                return
            }

            // 4. Setup UI
            this.updateDateTime()

            // 5. Init map
            this.initMap()

            // 6. Load data
            await this.loadData()

            // 7. Setup realtime
            this.setupRealtime()

            // 8. Setup event listeners
            this.setupEventListeners()

            // 9. Auto refresh setiap 30 detik
            setInterval(() => this.refreshData(), 30000)

        } catch (error) {
            console.error('Monitoring init error:', error)
        }
    }

    // ============================================================
    // MAP INITIALIZATION
    // ============================================================

    initMap() {
        const mapContainer = document.getElementById('map')
        if (!mapContainer) return

        // Center on Indonesia
        this.map = L.map('map').setView([-6.2088, 106.8456], 12)

        // Tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map)

        // Zoom control
        L.control.zoom({
            position: 'topright'
        }).addTo(this.map)

        // Handle resize
        setTimeout(() => {
            this.map.invalidateSize()
        }, 500)
    }

    // ============================================================
    // DATA LOADING
    // ============================================================

    async loadData() {
        if (this.loading) return
        this.loading = true

        try {
            const today = new Date().toISOString().split('T')[0]

            // 1. Ambil semua salesman
            const { data: salesmen, error: salesmenError } = await supabase
                .from('profiles')
                .select('*')
                .eq('role', 'salesman')
                .eq('active', true)
                .order('full_name')

            if (salesmenError) throw salesmenError
            this.data.salesmen = salesmen || []

            // 2. Update filter dropdown
            this.updateFilterDropdown()

            // 3. Ambil absensi hari ini
            const { data: attendance, error: attendanceError } = await supabase
                .from('attendance')
                .select('*')
                .eq('attendance_date', today)

            if (!attendanceError) {
                this.data.attendance = attendance || []
            }

            // 4. Ambil lokasi terakhir — TANPA RPC
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
                    // Ambil terbaru per user
                    const latestMap = {}
                    ;(locations || []).forEach(loc => {
                        if (!latestMap[loc.user_id]) {
                            latestMap[loc.user_id] = loc
                        }
                    })
                    this.data.locations = Object.values(latestMap)
                }
            }

            // 5. Update markers
            this.updateMarkers()

        } catch (error) {
            console.error('Error loading data:', error)
        } finally {
            this.loading = false
        }
    }

    // ============================================================
    // MARKERS
    // ============================================================

    updateMarkers() {
        // Clear existing markers
        Object.values(this.markers).forEach(marker => {
            if (this.map) this.map.removeLayer(marker)
        })
        this.markers = {}

        // Filter salesmen
        const filteredSalesmen = this.selectedSalesman === 'all'
            ? this.data.salesmen
            : this.data.salesmen.filter(s => s.user_id === this.selectedSalesman)

        if (filteredSalesmen.length === 0) {
            return
        }

        filteredSalesmen.forEach(salesman => {
            const location = this.data.locations.find(l => l.user_id === salesman.user_id)
            const attendance = this.data.attendance.find(a => a.user_id === salesman.user_id)

            const isActive = attendance && attendance.status === 'checked_in'
            const isCheckedOut = attendance && attendance.status === 'checked_out'

            let color = '#999' // Default (belum absen)
            let gpsStatus = 'offline'

            if (isActive && location) {
                const lastUpdate = new Date(location.recorded_at)
                const minutesSince = Math.floor((new Date() - lastUpdate) / 60000)

                if (minutesSince < 5) {
                    gpsStatus = 'online'
                    color = '#4CAF50'
                } else if (minutesSince < 15) {
                    gpsStatus = 'warning'
                    color = '#FF9800'
                } else {
                    color = '#f44336'
                }
            } else if (isCheckedOut) {
                color = '#666'
            }

            // Default position jika tidak ada lokasi
            const lat = location ? location.latitude : -6.2088
            const lng = location ? location.longitude : 106.8456

            // Custom icon
            const icon = L.divIcon({
                html: `
                    <div style="
                        width: 28px;
                        height: 28px;
                        background: ${color};
                        border: 3px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 12px;
                        font-weight: bold;
                        transition: all 0.3s;
                    ">
                        ${isActive ? '●' : isCheckedOut ? '○' : '✕'}
                    </div>
                `,
                className: 'custom-marker',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            })

            const marker = L.marker([lat, lng], { icon })
                .addTo(this.map)
                .bindPopup(this.createPopup(salesman, location, attendance, isActive, isCheckedOut, gpsStatus))

            this.markers[salesman.user_id] = marker

            // Pulsing animation untuk yang aktif dan online
            if (isActive && gpsStatus === 'online') {
                marker._icon.classList.add('pulse-marker')
            }
        })

        // Fit bounds jika ada marker
        const markerValues = Object.values(this.markers)
        if (markerValues.length > 0) {
            try {
                const group = L.featureGroup(markerValues)
                const bounds = group.getBounds()
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, { padding: [50, 50] })
                }
            } catch (e) {
                console.log('Fit bounds error:', e)
            }
        }
    }

    // ============================================================
    // POPUP
    // ============================================================

    createPopup(salesman, location, attendance, isActive, isCheckedOut, gpsStatus) {
        const statusText = isActive ? '🟢 Sedang Bekerja' :
            isCheckedOut ? '⚫ Selesai Kerja' : '🔴 Belum Absen'

        const gpsStatusMap = {
            'online': '🟢 ONLINE',
            'warning': '🟡 WARNING',
            'offline': '🔴 OFFLINE'
        }

        const checkInTime = attendance?.check_in_at ?
            new Date(attendance.check_in_at).toLocaleTimeString('id-ID') : '-'

        const lastUpdate = location?.recorded_at ?
            new Date(location.recorded_at).toLocaleTimeString('id-ID') : '-'

        const minutesSince = location?.recorded_at ?
            Math.floor((new Date() - new Date(location.recorded_at)) / 60000) : '-'

        const accuracy = location?.accuracy ? location.accuracy + 'm' : '-'

        return `
            <div class="custom-popup" style="min-width:200px;">
                <div class="popup-name">${salesman.full_name}</div>
                <div class="popup-status">
                    <strong>Status:</strong> ${statusText}
                </div>
                <div class="popup-time">
                    <strong>Absen Masuk:</strong> ${checkInTime}
                </div>
                <div class="popup-time">
                    <strong>GPS Terakhir:</strong> ${lastUpdate}
                </div>
                <div class="popup-time">
                    <strong>Update:</strong> ${minutesSince} menit yang lalu
                </div>
                <div class="popup-time">
                    <strong>GPS Status:</strong> ${gpsStatusMap[gpsStatus] || '🔴 OFFLINE'}
                </div>
                <div class="popup-time">
                    <strong>Accuracy:</strong> ${accuracy}
                </div>
                <div class="popup-time">
                    <strong>Kode:</strong> ${salesman.employee_code}
                </div>
                <button class="btn-detail-popup" data-userid="${salesman.user_id}">
                    📋 Lihat Detail
                </button>
            </div>
        `
    }

    // ============================================================
    // FILTER DROPDOWN
    // ============================================================

    updateFilterDropdown() {
        const select = document.getElementById('filterSalesman')
        if (!select) return

        const currentValue = select.value
        select.innerHTML = '<option value="all">👥 Semua Salesman</option>'

        this.data.salesmen.forEach(salesman => {
            const option = document.createElement('option')
            option.value = salesman.user_id
            option.textContent = `${salesman.full_name} (${salesman.employee_code})`
            select.appendChild(option)
        })

        if (currentValue) {
            select.value = currentValue
        }
    }

    // ============================================================
    // REALTIME
    // ============================================================

    setupRealtime() {
        supabase
            .channel('monitoring-map')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'location_tracking'
            }, () => {
                this.refreshData()
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'attendance'
            }, () => {
                this.refreshData()
            })
            .subscribe()
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    setupEventListeners() {
        // Menu toggle (mobile)
        document.getElementById('menuToggle')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('collapsed')
        })

        // Refresh
        document.getElementById('refreshMap')?.addEventListener('click', () => {
            this.refreshData()
        })

        // Zoom fit
        document.getElementById('zoomFit')?.addEventListener('click', () => {
            const markerValues = Object.values(this.markers)
            if (markerValues.length > 0) {
                try {
                    const group = L.featureGroup(markerValues)
                    const bounds = group.getBounds()
                    if (bounds.isValid()) {
                        this.map.fitBounds(bounds, { padding: [50, 50] })
                    }
                } catch (e) {
                    console.log('Zoom fit error:', e)
                }
            }
        })

        // Filter
        document.getElementById('filterSalesman')?.addEventListener('change', (e) => {
            this.selectedSalesman = e.target.value
            this.updateMarkers()
        })

        // Logout
        document.getElementById('logoutBtn')?.addEventListener('click', async () => {
            await supabase.auth.signOut()
            window.location.href = '../auth/login.html'
        })

        // Popup detail button (event delegation)
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-detail-popup')) {
                const userId = e.target.dataset.userid
                window.location.href = `detail.html?userId=${userId}`
            }
        })
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }
        document.getElementById('monitoringDate').textContent = now.toLocaleDateString('id-ID', options)
    }

    async refreshData() {
        await this.loadData()
        this.showToast('✅ Data diperbarui')
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
            font-family: Arial, sans-serif;
        `
        toast.textContent = message
        document.body.appendChild(toast)

        setTimeout(() => {
            toast.style.opacity = '0'
            setTimeout(() => toast.remove(), 300)
        }, 2000)
    }
}

// ============================================================
// INIT
// ============================================================
const monitoring = new MonitoringMap()
monitoring.init()
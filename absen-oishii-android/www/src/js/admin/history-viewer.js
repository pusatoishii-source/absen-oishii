import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// HISTORY VIEWER CLASS
// ============================================================
class HistoryViewer {
    constructor() {
        this.map = null
        this.polyline = null
        this.markers = []
        this.locations = []
        this.user = null
        this.profile = null
        this.salesmanId = null
        this.selectedDate = null
        this.routeColors = ['#d32f2f', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0']
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

            // 3. Cek role admin
            if (!['admin', 'super_admin'].includes(profile.role)) {
                window.location.href = '../salesman/dashboard.html'
                return
            }

            // 4. Setup UI
            this.updateDateTime()

            // 5. Init map
            this.initMap()

            // 6. Load salesmen
            await this.loadSalesmen()

            // 7. Setup event listeners
            this.setupEventListeners()

            // 8. Check URL params untuk auto-load
            const params = new URLSearchParams(window.location.search)
            const userId = params.get('userId')
            if (userId) {
                document.getElementById('historySalesman').value = userId
                const today = new Date().toISOString().split('T')[0]
                document.getElementById('historyDateInput').value = today
                await this.viewHistory()
            }

        } catch (error) {
            console.error('History viewer init error:', error)
        }
    }

    // ============================================================
    // MAP INIT
    // ============================================================

    initMap() {
        const mapContainer = document.getElementById('historyMap')
        if (!mapContainer) return

        this.map = L.map('historyMap').setView([-6.2088, 106.8456], 12)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map)

        L.control.zoom({
            position: 'topright'
        }).addTo(this.map)
    }

    // ============================================================
    // LOAD SALESMEN
    // ============================================================

    async loadSalesmen() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('role', 'salesman')
                .eq('active', true)
                .order('full_name')

            if (error) throw error

            const select = document.getElementById('historySalesman')
            select.innerHTML = '<option value="">📋 Pilih Salesman...</option>'

            data.forEach(salesman => {
                const option = document.createElement('option')
                option.value = salesman.user_id
                option.textContent = `${salesman.full_name} (${salesman.employee_code})`
                select.appendChild(option)
            })
        } catch (error) {
            console.error('Error loading salesmen:', error)
        }
    }

    // ============================================================
    // VIEW HISTORY
    // ============================================================

    async viewHistory() {
        this.salesmanId = document.getElementById('historySalesman').value
        this.selectedDate = document.getElementById('historyDateInput').value

        if (!this.salesmanId) {
            this.showToast('⚠️ Pilih salesman terlebih dahulu')
            return
        }

        if (!this.selectedDate) {
            this.showToast('⚠️ Pilih tanggal terlebih dahulu')
            return
        }

        try {
            // Ambil profil salesman
            const { data: salesman, error: salesmanError } = await supabase
                .from('profiles')
                .select('full_name, employee_code')
                .eq('user_id', this.salesmanId)
                .single()

            if (salesmanError) throw salesmanError

            // Ambil lokasi
            const startDate = new Date(this.selectedDate)
            startDate.setHours(0, 0, 0, 0)

            const endDate = new Date(this.selectedDate)
            endDate.setHours(23, 59, 59, 999)

            const { data: locations, error: locationError } = await supabase
                .from('location_tracking')
                .select('*')
                .eq('user_id', this.salesmanId)
                .gte('recorded_at', startDate.toISOString())
                .lte('recorded_at', endDate.toISOString())
                .order('recorded_at', { ascending: true })

            if (locationError) throw locationError

            this.locations = locations || []

            if (this.locations.length === 0) {
                document.getElementById('historyStats').style.display = 'none'
                document.getElementById('historyTimeline').style.display = 'none'
                document.getElementById('noData').style.display = 'block'
                this.clearMap()
                return
            }

            document.getElementById('noData').style.display = 'none'

            // Tampilkan di map
            this.displayRoute(salesman)

            // Tampilkan timeline
            this.displayTimeline(salesman)

            // Tampilkan stats
            this.displayStats()

        } catch (error) {
            console.error('Error viewing history:', error)
            this.showToast('❌ Error: ' + error.message)
        }
    }

    // ============================================================
    // DISPLAY ROUTE
    // ============================================================

    displayRoute(salesman) {
        this.clearMap()

        // Add markers
        this.locations.forEach((loc, index) => {
            const isFirst = index === 0
            const isLast = index === this.locations.length - 1

            const color = isFirst ? '#4CAF50' : isLast ? '#f44336' : '#2196F3'
            const icon = L.divIcon({
                html: `
                    <div style="
                        width: 14px;
                        height: 14px;
                        background: ${color};
                        border-radius: 50%;
                        border: 2px solid white;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                        ${isFirst ? 'width:18px;height:18px;' : ''}
                        ${isLast ? 'width:18px;height:18px;' : ''}
                    ">
                        ${isFirst ? '🏁' : isLast ? '🏁' : ''}
                    </div>
                `,
                className: 'custom-marker',
                iconSize: [isFirst || isLast ? 18 : 14, isFirst || isLast ? 18 : 14],
                iconAnchor: [isFirst || isLast ? 9 : 7, isFirst || isLast ? 9 : 7]
            })

            const time = new Date(loc.recorded_at).toLocaleTimeString('id-ID')
            const label = isFirst ? 'Mulai' : isLast ? 'Selesai' : `Titik ${index}`

            const marker = L.marker([loc.latitude, loc.longitude], { icon })
                .addTo(this.map)
                .bindPopup(`
                    <strong>${time}</strong>
                    <br>
                    ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
                    <br>
                    <span style="color:#999;font-size:12px;">${label}</span>
                    ${loc.accuracy ? `<br>Accuracy: ${loc.accuracy}m` : ''}
                    ${loc.speed ? `<br>Speed: ${(loc.speed * 3.6).toFixed(1)} km/h` : ''}
                    ${loc.battery_level ? `<br>Battery: ${loc.battery_level}%` : ''}
                `)

            this.markers.push(marker)
        })

        // Draw polyline
        const latlngs = this.locations.map(loc => [loc.latitude, loc.longitude])
        this.polyline = L.polyline(latlngs, {
            color: '#d32f2f',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(this.map)

        // Add arrow indicators
        this.addDirectionArrows()

        // Fit bounds
        if (latlngs.length > 0) {
            try {
                const bounds = L.latLngBounds(latlngs)
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, { padding: [40, 40] })
                }
            } catch (e) {
                console.log('Fit bounds error:', e)
            }
        }

        // Map title
        const title = document.createElement('div')
        title.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            padding: 8px 20px;
            border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            font-weight: bold;
            text-align: center;
            font-size: 14px;
            pointer-events: none;
            border: 1px solid #eee;
        `
        title.innerHTML = `
            ${salesman.full_name}
            <br>
            <span style="font-weight:normal;font-size:12px;color:#666;">
                ${this.formatDate(this.selectedDate)} · ${this.locations.length} titik GPS
            </span>
        `

        const mapContainer = document.getElementById('historyMap')
        const existingTitle = mapContainer.querySelector('.map-title')
        if (existingTitle) existingTitle.remove()

        title.className = 'map-title'
        mapContainer.appendChild(title)
    }

    addDirectionArrows() {
        const step = Math.floor(this.locations.length / 5)
        if (step < 1) return

        for (let i = step; i < this.locations.length - 1; i += step) {
            const p1 = this.locations[i]
            const p2 = this.locations[Math.min(i + 1, this.locations.length - 1)]

            const midLat = (p1.latitude + p2.latitude) / 2
            const midLng = (p1.longitude + p2.longitude) / 2

            // Simple arrow marker
            const arrowIcon = L.divIcon({
                html: '▶',
                className: 'direction-arrow',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })

            L.marker([midLat, midLng], {
                icon: arrowIcon
            }).addTo(this.map)
        }
    }

    // ============================================================
    // DISPLAY TIMELINE
    // ============================================================

    displayTimeline(salesman) {
        const container = document.getElementById('timelineContent')
        document.getElementById('historyTimeline').style.display = 'block'

        let html = `
            <div style="margin-bottom:12px;font-weight:500;color:#1a1a2e;">
                ${salesman.full_name}
                <span style="font-weight:normal;color:#666;font-size:14px;margin-left:12px;">
                    ${this.formatDate(this.selectedDate)}
                </span>
            </div>
        `

        this.locations.forEach((loc, index) => {
            const time = new Date(loc.recorded_at).toLocaleTimeString('id-ID')
            const isFirst = index === 0
            const isLast = index === this.locations.length - 1

            const dotColor = isFirst ? '#4CAF50' : isLast ? '#f44336' : '#d32f2f'
            const label = isFirst ? '🏁 Mulai' : isLast ? '🏁 Selesai' : `📍 Titik ${index}`

            html += `
                <div class="timeline-item">
                    <div class="timeline-dot" style="background:${dotColor};"></div>
                    <div class="timeline-time">${time}</div>
                    <div class="timeline-location">
                        ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
                        <span class="label">${label}</span>
                        ${loc.accuracy ? `<span class="accuracy">±${loc.accuracy}m</span>` : ''}
                        ${loc.speed ? `<span class="accuracy">${(loc.speed * 3.6).toFixed(1)} km/h</span>` : ''}
                    </div>
                </div>
            `
        })

        container.innerHTML = html
    }

    // ============================================================
    // DISPLAY STATS
    // ============================================================

    displayStats() {
        document.getElementById('historyStats').style.display = 'grid'

        // Total points
        document.getElementById('totalPoints').textContent = this.locations.length

        // Total distance
        const distance = this.calculateTotalDistance()
        document.getElementById('totalDistance').textContent = distance.toFixed(2) + ' km'

        // Duration
        if (this.locations.length > 0) {
            const first = new Date(this.locations[0].recorded_at)
            const last = new Date(this.locations[this.locations.length - 1].recorded_at)
            const durationMs = last - first
            const hours = Math.floor(durationMs / (1000 * 60 * 60))
            const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))
            document.getElementById('duration').textContent = hours + ' jam ' + minutes + ' menit'
        }

        // Potential visits (placeholder)
        document.getElementById('potentialVisits').textContent = '0'
    }

    // ============================================================
    // HELPERS
    // ============================================================

    calculateTotalDistance() {
        let total = 0
        for (let i = 1; i < this.locations.length; i++) {
            const prev = this.locations[i - 1]
            const curr = this.locations[i]
            total += this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            )
        }
        return total
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

    clearMap() {
        if (this.polyline) {
            this.map.removeLayer(this.polyline)
            this.polyline = null
        }

        this.markers.forEach(marker => {
            this.map.removeLayer(marker)
        })
        this.markers = []

        const title = document.querySelector('.map-title')
        if (title) title.remove()
    }

    formatDate(dateString) {
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ]
        const parts = dateString.split('-')
        return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parseInt(parts[0])}`
    }

    updateDateTime() {
        const now = new Date()
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }
        document.getElementById('historyDate').textContent = now.toLocaleDateString('id-ID', options)

        // Set default date input
        const dateInput = document.getElementById('historyDateInput')
        if (dateInput && !dateInput.value) {
            dateInput.value = now.toISOString().split('T')[0]
            dateInput.max = now.toISOString().split('T')[0]
        }
    }

    // ============================================================
    // EXPORT CSV
    // ============================================================

    async exportCSV() {
        if (this.locations.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk diekspor')
            return
        }

        try {
            const { data: salesman, error } = await supabase
                .from('profiles')
                .select('full_name, employee_code')
                .eq('user_id', this.salesmanId)
                .single()

            if (error) throw error

            let csv = 'Waktu,Latitude,Longitude,Accuracy,Speed,Battery,Heading\n'
            this.locations.forEach(loc => {
                const time = new Date(loc.recorded_at).toLocaleString('id-ID')
                csv +=
                    `${time},${loc.latitude},${loc.longitude},${loc.accuracy || ''},${loc.speed || ''},${loc.battery_level || ''},${loc.heading || ''}\n`
            })

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `History_${salesman.full_name}_${this.selectedDate}.csv`
            a.click()
            URL.revokeObjectURL(url)

            this.showToast('✅ CSV berhasil diekspor')

        } catch (error) {
            console.error('Export error:', error)
            this.showToast('❌ Gagal export CSV')
        }
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    setupEventListeners() {
        // View button
        document.getElementById('viewHistory').addEventListener('click', () => {
            this.viewHistory()
        })

        // Enter key pada date input
        document.getElementById('historyDateInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.viewHistory()
            }
        })

        // Export
        document.getElementById('exportHistory').addEventListener('click', () => {
            this.exportCSV()
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
    }

    // ============================================================
    // TOAST
    // ============================================================

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
            transition: opacity 0.3s;
            font-size: 14px;
            font-family: Arial, sans-serif;
            max-width: 90%;
            text-align: center;
        `
        toast.textContent = message
        document.body.appendChild(toast)

        setTimeout(() => {
            toast.style.opacity = '0'
            setTimeout(() => toast.remove(), 300)
        }, 3000)
    }
}

// ============================================================
// INIT
// ============================================================
const viewer = new HistoryViewer()
viewer.init()
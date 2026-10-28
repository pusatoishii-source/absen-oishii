import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// ROUTE CLASS
// ============================================================
class SalesmanRoute {
    constructor() {
        this.map = null
        this.polyline = null
        this.markers = []
        this.locations = []
        this.user = null
        this.profile = null
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

            // 5. Init map
            this.initMap()

            // 6. Load today's route
            await this.loadTodayRoute()

            // 7. Setup event listeners
            this.setupEventListeners()

        } catch (error) {
            console.error('Route init error:', error)
            this.showToast('❌ Gagal memuat rute: ' + error.message)
        }
    }

    // ============================================================
    // MAP
    // ============================================================

    initMap() {
        const mapContainer = document.getElementById('routeMap')
        if (!mapContainer) return

        this.map = L.map('routeMap').setView([-6.2088, 106.8456], 12)

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map)

        L.control.zoom({
            position: 'topright'
        }).addTo(this.map)

        setTimeout(() => {
            this.map.invalidateSize()
        }, 500)
    }

    // ============================================================
    // LOAD TODAY'S ROUTE
    // ============================================================

    async loadTodayRoute() {
        try {
            const today = new Date().toISOString().split('T')[0]
            const startDate = new Date(today)
            startDate.setHours(0, 0, 0, 0)

            const endDate = new Date(today)
            endDate.setHours(23, 59, 59, 999)

            const { data: locations, error: locationError } = await supabase
                .from('location_tracking')
                .select('*')
                .eq('user_id', this.user.id)
                .gte('recorded_at', startDate.toISOString())
                .lte('recorded_at', endDate.toISOString())
                .order('recorded_at', { ascending: true })

            if (locationError) throw locationError

            this.locations = locations || []

            if (this.locations.length === 0) {
                document.getElementById('routeStats').style.display = 'none'
                document.getElementById('routeTimeline').style.display = 'none'
                document.getElementById('noData').style.display = 'block'
                this.clearMap()
                return
            }

            document.getElementById('noData').style.display = 'none'

            // Tampilkan di map
            this.displayRoute()

            // Tampilkan timeline
            this.displayTimeline()

            // Tampilkan stats
            this.displayStats()

        } catch (error) {
            console.error('Error loading route:', error)
            this.showToast('❌ Gagal memuat rute: ' + error.message)
        }
    }

    // ============================================================
    // DISPLAY ROUTE
    // ============================================================

    displayRoute() {
        this.clearMap()

        // Add markers
        this.locations.forEach((loc, index) => {
            const isFirst = index === 0
            const isLast = index === this.locations.length - 1

            let color = '#2196F3'
            let dotClass = 'mid'
            let label = `Titik ${index}`

            if (isFirst) {
                color = '#4CAF50'
                dotClass = 'start'
                label = '🏁 Mulai'
            } else if (isLast) {
                color = '#f44336'
                dotClass = 'end'
                label = '🏁 Selesai'
            }

            const icon = L.divIcon({
                html: `
                    <div style="
                        width: ${isFirst || isLast ? 16 : 12}px;
                        height: ${isFirst || isLast ? 16 : 12}px;
                        background: ${color};
                        border-radius: 50%;
                        border: 2px solid white;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 8px;
                        font-weight: bold;
                    ">
                        ${isFirst ? 'S' : isLast ? 'E' : ''}
                    </div>
                `,
                className: 'route-marker',
                iconSize: [isFirst || isLast ? 16 : 12, isFirst || isLast ? 16 : 12],
                iconAnchor: [isFirst || isLast ? 8 : 6, isFirst || isLast ? 8 : 6]
            })

            const time = new Date(loc.recorded_at).toLocaleTimeString('id-ID')

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

        // Add direction arrows
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
        title.className = 'map-title'
        title.textContent = `${this.profile.full_name} - ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`
        document.getElementById('routeMap').appendChild(title)
    }

    addDirectionArrows() {
        const step = Math.floor(this.locations.length / 5)
        if (step < 1) return

        for (let i = step; i < this.locations.length - 1; i += step) {
            const p1 = this.locations[i]
            const p2 = this.locations[Math.min(i + 1, this.locations.length - 1)]

            const midLat = (p1.latitude + p2.latitude) / 2
            const midLng = (p1.longitude + p2.longitude) / 2

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

    displayTimeline() {
        const container = document.getElementById('timelineContent')
        document.getElementById('routeTimeline').style.display = 'block'

        let html = ''

        this.locations.forEach((loc, index) => {
            const time = new Date(loc.recorded_at).toLocaleTimeString('id-ID')
            const isFirst = index === 0
            const isLast = index === this.locations.length - 1

            let dotClass = 'mid'
            let label = `Titik ${index}`
            if (isFirst) {
                dotClass = 'start'
                label = '🏁 Mulai'
            } else if (isLast) {
                dotClass = 'end'
                label = '🏁 Selesai'
            }

            html += `
                <div class="timeline-item">
                    <div class="timeline-dot ${dotClass}"></div>
                    <div class="timeline-time">${time}</div>
                    <div class="timeline-location">
                        ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}
                        <span class="label">${label}</span>
                        ${loc.accuracy ? `<span class="label">±${loc.accuracy}m</span>` : ''}
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
        document.getElementById('routeStats').style.display = 'grid'

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
            document.getElementById('duration').textContent = hours + 'j ' + minutes + 'm'
        }
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
        document.getElementById('refreshRoute').addEventListener('click', () => {
            this.loadTodayRoute()
            this.showToast('🔄 Rute diperbarui')
        })
    }
}

// ============================================================
// INIT
// ============================================================
const route = new SalesmanRoute()
route.init()
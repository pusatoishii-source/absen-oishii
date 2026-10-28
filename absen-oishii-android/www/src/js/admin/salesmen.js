import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// SALESMEN MANAGER CLASS
// ============================================================
class SalesmenManager {
    constructor() {
        this.user = null
        this.profile = null
        this.salesmen = []
        this.isEditing = false
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

            // 5. Load data
            await this.loadSalesmen()

            // 6. Setup event listeners
            this.setupEventListeners()

        } catch (error) {
            console.error('Salesmen manager init error:', error)
        }
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
                .order('full_name')

            if (error) throw error
            this.salesmen = data || []
            this.renderTable()

        } catch (error) {
            console.error('Error loading salesmen:', error)
            this.showToast('❌ Gagal memuat data salesman')
        }
    }

    // ============================================================
    // RENDER TABLE
    // ============================================================

    renderTable() {
        const tbody = document.getElementById('salesmenTableBody')

        if (this.salesmen.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-text">Belum ada salesman</td>
                </tr>
            `
            return
        }

        let html = ''
        this.salesmen.forEach(salesman => {
            const statusClass = salesman.active ? 'active' : 'inactive'
            const statusText = salesman.active ? '✅ Aktif' : '❌ Nonaktif'
            const roleBadge = salesman.role === 'super_admin' ? 'super_admin' : ''

            html += `
                <tr>
                    <td><strong>${salesman.full_name}</strong></td>
                    <td>${salesman.employee_code}</td>
                    <td>${salesman.phone || '-'}</td>
                    <td><span class="badge-role ${roleBadge}">${salesman.role}</span></td>
                    <td><span class="badge-active ${statusClass}">${statusText}</span></td>
                    <td>
                        <button class="btn-edit" data-id="${salesman.id}">✏️ Edit</button>
                        <button class="btn-toggle" data-id="${salesman.id}" data-active="${salesman.active}">
                            ${salesman.active ? '🔴 Nonaktifkan' : '🟢 Aktifkan'}
                        </button>
                    </td>
                </tr>
            `
        })

        tbody.innerHTML = html

        // Event listeners untuk tombol
        tbody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                this.editSalesman(id)
            })
        })

        tbody.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                const current = btn.dataset.active === 'true'
                this.toggleSalesman(id, !current)
            })
        })
    }

    // ============================================================
    // ADD / EDIT SALESMAN
    // ============================================================

    async addSalesman() {
        this.isEditing = false
        document.getElementById('modalTitle').textContent = '➕ Tambah Salesman'
        document.getElementById('editId').value = ''
        document.getElementById('fullName').value = ''
        document.getElementById('employeeCode').value = ''
        document.getElementById('phone').value = ''
        document.getElementById('email').value = ''
        document.getElementById('password').value = ''
        document.getElementById('password').required = true
        document.getElementById('passwordGroup').style.display = 'block'
        document.getElementById('role').value = 'salesman'
        document.getElementById('active').value = 'true'

        document.getElementById('modalOverlay').classList.add('show')
    }

    async editSalesman(id) {
        this.isEditing = true

        try {
            const salesman = this.salesmen.find(s => s.id === id)
            if (!salesman) {
                this.showToast('❌ Data salesman tidak ditemukan')
                return
            }

            // Email tidak bisa diambil dari auth.users dari client-side
            // Kita tampilkan saja placeholder atau kosongkan
            // User bisa update email hanya melalui super admin di dashboard Supabase

            document.getElementById('modalTitle').textContent = '✏️ Edit Salesman'
            document.getElementById('editId').value = salesman.id
            document.getElementById('fullName').value = salesman.full_name
            document.getElementById('employeeCode').value = salesman.employee_code
            document.getElementById('phone').value = salesman.phone || ''
            document.getElementById('email').value = '' // Tidak bisa ditampilkan
            document.getElementById('email').placeholder = 'Email tidak dapat diubah di sini'
            document.getElementById('email').disabled = true // Disable karena tidak bisa diubah
            document.getElementById('password').value = ''
            document.getElementById('password').required = false
            document.getElementById('passwordGroup').style.display = 'block'
            document.getElementById('role').value = salesman.role
            document.getElementById('active').value = salesman.active ? 'true' : 'false'

            document.getElementById('modalOverlay').classList.add('show')

        } catch (error) {
            console.error('Error editing salesman:', error)
            this.showToast('❌ Gagal memuat data salesman')
        }
    }

    async saveSalesman(e) {
        e.preventDefault()

        const id = document.getElementById('editId').value
        const fullName = document.getElementById('fullName').value.trim()
        const employeeCode = document.getElementById('employeeCode').value.trim()
        const phone = document.getElementById('phone').value.trim()
        const email = document.getElementById('email').value.trim()
        const password = document.getElementById('password').value
        const role = document.getElementById('role').value
        const active = document.getElementById('active').value === 'true'

        // Validasi
        if (!fullName) {
            this.showToast('⚠️ Nama harus diisi')
            return
        }
        if (!employeeCode) {
            this.showToast('⚠️ Kode salesman harus diisi')
            return
        }

        try {
            if (this.isEditing) {
                // EDIT: Update profile (email tidak diupdate)
                const updateData = {
                    full_name: fullName,
                    employee_code: employeeCode,
                    phone: phone || null,
                    role: role,
                    active: active,
                    updated_at: new Date().toISOString()
                }

                const { error: updateError } = await supabase
                    .from('profiles')
                    .update(updateData)
                    .eq('id', id)

                if (updateError) throw updateError

                this.showToast('✅ Salesman berhasil diupdate')
                this.closeModal()
                await this.loadSalesmen()

            } else {
                // ADD: Buat user auth dulu
                if (!email) {
                    this.showToast('⚠️ Email harus diisi untuk salesman baru')
                    return
                }
                if (!password || password.length < 6) {
                    this.showToast('⚠️ Password minimal 6 karakter')
                    return
                }

                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            full_name: fullName,
                            role: role
                        }
                    }
                })

                if (authError) {
                    if (authError.message.includes('already registered')) {
                        this.showToast('❌ Email sudah terdaftar')
                    } else {
                        this.showToast('❌ Gagal membuat user: ' + authError.message)
                    }
                    return
                }

                if (!authData.user) {
                    this.showToast('❌ Gagal membuat user')
                    return
                }

                // Buat profile
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert([{
                        user_id: authData.user.id,
                        full_name: fullName,
                        employee_code: employeeCode,
                        phone: phone || null,
                        role: role,
                        active: active
                    }])

                if (profileError) {
                    throw profileError
                }

                this.showToast('✅ Salesman berhasil ditambahkan')
                this.closeModal()
                await this.loadSalesmen()
            }

        } catch (error) {
            console.error('Error saving salesman:', error)
            this.showToast('❌ Gagal menyimpan: ' + error.message)
        }
    }

    // ============================================================
    // TOGGLE SALESMAN
    // ============================================================

    async toggleSalesman(id, active) {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    active: active,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error

            this.showToast(`✅ Salesman ${active ? 'diaktifkan' : 'dinonaktifkan'}`)
            await this.loadSalesmen()

        } catch (error) {
            console.error('Error toggling salesman:', error)
            this.showToast('❌ Gagal mengubah status')
        }
    }

    // ============================================================
    // MODAL
    // ============================================================

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('show')
        document.getElementById('salesmanForm').reset()
        // Enable email field kembali
        document.getElementById('email').disabled = false
        document.getElementById('email').placeholder = 'email@example.com'
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        document.getElementById('salesmenDate').textContent = now.toLocaleDateString('id-ID', {
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
        // Add button
        document.getElementById('addSalesmanBtn').addEventListener('click', () => {
            this.addSalesman()
        })

        // Cancel modal
        document.getElementById('cancelModal').addEventListener('click', () => {
            this.closeModal()
        })

        // Close modal on overlay click
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('modalOverlay')) {
                this.closeModal()
            }
        })

        // Form submit
        document.getElementById('salesmanForm').addEventListener('submit', (e) => {
            this.saveSalesman(e)
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
}

// ============================================================
// INIT
// ============================================================
const manager = new SalesmenManager()
manager.init()
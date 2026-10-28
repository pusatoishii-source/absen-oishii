import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// ADMINS MANAGER CLASS
// ============================================================
class AdminsManager {
    constructor() {
        this.user = null
        this.profile = null
        this.admins = []
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

            // 3. Cek role (hanya super_admin yang bisa kelola admin)
            if (profile.role !== 'super_admin') {
                this.showToast('⚠️ Hanya Super Admin yang dapat mengelola admin')
                setTimeout(() => {
                    window.location.href = 'dashboard.html'
                }, 2000)
                return
            }

            // 4. Setup UI
            this.updateDateTime()

            // 5. Load data
            await this.loadAdmins()

            // 6. Setup event listeners
            this.setupEventListeners()

        } catch (error) {
            console.error('Admins manager init error:', error)
        }
    }

    // ============================================================
    // LOAD ADMINS
    // ============================================================

    async loadAdmins() {
        try {
            // Ambil semua profile dengan role admin atau super_admin
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .in('role', ['admin', 'super_admin'])
                .order('full_name')

            if (error) throw error
            this.admins = data || []

            this.admins.forEach(admin => {
                admin.email = admin.email || '-'
            })

            this.renderTable()

        } catch (error) {
            console.error('Error loading admins:', error)
            this.showToast('❌ Gagal memuat data admin')
        }
    }

    // ============================================================
    // RENDER TABLE
    // ============================================================

    renderTable() {
        const tbody = document.getElementById('adminsTableBody')

        if (this.admins.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-text">Belum ada admin</td>
                </tr>
            `
            return
        }

        let html = ''
        this.admins.forEach(admin => {
            const statusClass = admin.active ? 'active' : 'inactive'
            const statusText = admin.active ? '✅ Aktif' : '❌ Nonaktif'
            const roleBadge = admin.role === 'super_admin' ? 'super_admin' : 'admin'

            // Cek apakah ini adalah akun yang sedang login
            const isCurrentUser = admin.user_id === this.user.id

            html += `
                <tr>
                    <td>
                        <strong>${admin.full_name}</strong>
                        ${isCurrentUser ? ' <span style="font-size:11px;color:#2196F3;">(Anda)</span>' : ''}
                    </td>
                    <td>${admin.email || '-'}</td>
                    <td>${admin.phone || '-'}</td>
                    <td><span class="badge-role ${roleBadge}">${admin.role}</span></td>
                    <td><span class="badge-active ${statusClass}">${statusText}</span></td>
                    <td>
                        <button class="btn-edit" data-id="${admin.id}" ${isCurrentUser ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            ✏️ Edit
                        </button>
                        <button class="btn-toggle" data-id="${admin.id}" data-active="${admin.active}" ${isCurrentUser ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            ${admin.active ? '🔴 Nonaktifkan' : '🟢 Aktifkan'}
                        </button>
                        <button class="btn-delete" data-id="${admin.id}" ${isCurrentUser ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                            🗑️ Hapus
                        </button>
                    </td>
                </tr>
            `
        })

        tbody.innerHTML = html

        // Event listeners untuk tombol
        tbody.querySelectorAll('.btn-edit:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                this.editAdmin(id)
            })
        })

        tbody.querySelectorAll('.btn-toggle:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                const current = btn.dataset.active === 'true'
                this.toggleAdmin(id, !current)
            })
        })

        tbody.querySelectorAll('.btn-delete:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                this.deleteAdmin(id)
            })
        })
    }

    // ============================================================
    // ADD / EDIT ADMIN
    // ============================================================

    async addAdmin() {
        this.isEditing = false
        document.getElementById('modalTitle').textContent = '➕ Tambah Admin'
        document.getElementById('editId').value = ''
        document.getElementById('fullName').value = ''
        document.getElementById('email').value = ''
        document.getElementById('phone').value = ''
        document.getElementById('password').value = ''
        document.getElementById('password').required = true
        document.getElementById('passwordRequired').style.display = 'inline'
        document.getElementById('passwordHelp').textContent = 'Minimal 6 karakter'
        document.getElementById('role').value = 'admin'
        document.getElementById('active').value = 'true'

        document.getElementById('modalOverlay').classList.add('show')
    }

    async editAdmin(id) {
        this.isEditing = true

        try {
            const admin = this.admins.find(a => a.id === id)
            if (!admin) {
                this.showToast('❌ Data admin tidak ditemukan')
                return
            }

            document.getElementById('modalTitle').textContent = '✏️ Edit Admin'
            document.getElementById('editId').value = admin.id
            document.getElementById('fullName').value = admin.full_name
            document.getElementById('email').value = admin.email || ''
            document.getElementById('phone').value = admin.phone || ''
            document.getElementById('password').value = ''
            document.getElementById('password').required = false
            document.getElementById('passwordRequired').style.display = 'none'
            document.getElementById('passwordHelp').textContent = 'Kosongkan jika tidak ingin mengubah password'
            document.getElementById('role').value = admin.role
            document.getElementById('active').value = admin.active ? 'true' : 'false'

            document.getElementById('modalOverlay').classList.add('show')

        } catch (error) {
            console.error('Error editing admin:', error)
            this.showToast('❌ Gagal memuat data admin')
        }
    }

    async saveAdmin(e) {
        e.preventDefault()

        const id = document.getElementById('editId').value
        const fullName = document.getElementById('fullName').value.trim()
        const email = document.getElementById('email').value.trim()
        const phone = document.getElementById('phone').value.trim()
        const password = document.getElementById('password').value
        const role = document.getElementById('role').value
        const active = document.getElementById('active').value === 'true'

        // Validasi
        if (!fullName) {
            this.showToast('⚠️ Nama harus diisi')
            return
        }
        if (!email) {
            this.showToast('⚠️ Email harus diisi')
            return
        }

        // Validasi password untuk tambah baru
        if (!this.isEditing && (!password || password.length < 6)) {
            this.showToast('⚠️ Password minimal 6 karakter')
            return
        }

        try {
            if (this.isEditing) {
                // EDIT: Update profile
                const { error: updateError } = await supabase
                    .from('profiles')
                    .update({
                        full_name: fullName,
                        phone: phone || null,
                        role: role,
                        active: active,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id)

                if (updateError) throw updateError

                this.showToast('✅ Admin berhasil diupdate')
                this.closeModal()
                await this.loadAdmins()

            } else {
                // ADD: Buat user auth dulu
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
                        phone: phone || null,
                        role: role,
                        active: active,
                        employee_code: `ADM${String(this.admins.length + 1).padStart(3, '0')}`
                    }])

                if (profileError) {
                    throw profileError
                }

                this.showToast('✅ Admin berhasil ditambahkan')
                this.closeModal()
                await this.loadAdmins()
            }

        } catch (error) {
            console.error('Error saving admin:', error)
            this.showToast('❌ Gagal menyimpan: ' + error.message)
        }
    }

    // ============================================================
    // TOGGLE ADMIN
    // ============================================================

    async toggleAdmin(id, active) {
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    active: active,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error

            this.showToast(`✅ Admin ${active ? 'diaktifkan' : 'dinonaktifkan'}`)
            await this.loadAdmins()

        } catch (error) {
            console.error('Error toggling admin:', error)
            this.showToast('❌ Gagal mengubah status')
        }
    }

    // ============================================================
    // DELETE ADMIN
    // ============================================================

    async deleteAdmin(id) {
        if (!confirm('Yakin ingin menghapus admin ini?')) return

        try {
            const admin = this.admins.find(a => a.id === id)
            if (!admin) {
                this.showToast('❌ Data admin tidak ditemukan')
                return
            }

            // Hapus profile dulu
            const { error: profileError } = await supabase
                .from('profiles')
                .delete()
                .eq('id', id)

            if (profileError) throw profileError

            this.showToast('✅ Admin berhasil dihapus')
            await this.loadAdmins()

        } catch (error) {
            console.error('Error deleting admin:', error)
            this.showToast('❌ Gagal menghapus admin: ' + error.message)
        }
    }

    // ============================================================
    // MODAL
    // ============================================================

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('show')
        document.getElementById('adminForm').reset()
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        document.getElementById('adminsDate').textContent = now.toLocaleDateString('id-ID', {
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
        document.getElementById('addAdminBtn').addEventListener('click', () => {
            this.addAdmin()
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
        document.getElementById('adminForm').addEventListener('submit', (e) => {
            this.saveAdmin(e)
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
const manager = new AdminsManager()
manager.init()
import { createClient } from '@supabase/supabase-js'

// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================================
// CUSTOMERS MANAGER CLASS
// ============================================================
class CustomersManager {
    constructor() {
        this.user = null
        this.profile = null
        this.customers = []
        this.salesmen = []
        this.isEditing = false
        this.searchTerm = ''
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
            await this.loadCustomers()

            // 6. Setup event listeners
            this.setupEventListeners()

        } catch (error) {
            console.error('Customers manager init error:', error)
        }
    }

    // ============================================================
    // LOAD DATA
    // ============================================================

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

            // Update dropdown
            const select = document.getElementById('salesmanId')
            select.innerHTML = '<option value="">Tidak Ditugaskan</option>'
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

    async loadCustomers() {
        try {
            const { data, error } = await supabase
                .from('customers')
                .select('*')
                .order('customer_name')

            if (error) throw error
            this.customers = data || []
            this.renderTable()

        } catch (error) {
            console.error('Error loading customers:', error)
            this.showToast('❌ Gagal memuat data customer')
        }
    }

    // ============================================================
    // RENDER TABLE
    // ============================================================

    renderTable() {
        const tbody = document.getElementById('customersTableBody')

        // Filter by search
        let filtered = this.customers
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase()
            filtered = this.customers.filter(c =>
                c.customer_name.toLowerCase().includes(term) ||
                c.customer_code.toLowerCase().includes(term) ||
                (c.address && c.address.toLowerCase().includes(term))
            )
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-text">
                        ${this.customers.length === 0 ? 'Belum ada customer' : 'Tidak ada customer yang cocok'}
                    </td>
                </tr>
            `
            return
        }

        let html = ''
        filtered.forEach(customer => {
            const statusClass = customer.active ? 'active' : 'inactive'
            const statusText = customer.active ? '✅ Aktif' : '❌ Nonaktif'

            // Cari nama salesman
            let salesmanName = '-'
            if (customer.salesman_id) {
                const salesman = this.salesmen.find(s => s.user_id === customer.salesman_id)
                if (salesman) salesmanName = salesman.full_name
            }

            html += `
                <tr>
                    <td><strong>${customer.customer_code}</strong></td>
                    <td>${customer.customer_name}</td>
                    <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${customer.address || '-'}
                    </td>
                    <td><span class="salesman-name">${salesmanName}</span></td>
                    <td><span class="badge-active ${statusClass}">${statusText}</span></td>
                    <td>
                        <button class="btn-edit" data-id="${customer.id}">✏️ Edit</button>
                        <button class="btn-delete" data-id="${customer.id}">🗑️ Hapus</button>
                    </td>
                </tr>
            `
        })

        tbody.innerHTML = html

        // Event listeners
        tbody.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                this.editCustomer(id)
            })
        })

        tbody.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id
                this.deleteCustomer(id)
            })
        })
    }

    // ============================================================
    // ADD / EDIT CUSTOMER
    // ============================================================

    async addCustomer() {
        this.isEditing = false
        document.getElementById('modalTitle').textContent = '➕ Tambah Customer'
        document.getElementById('editId').value = ''
        document.getElementById('customerCode').value = ''
        document.getElementById('customerName').value = ''
        document.getElementById('address').value = ''
        document.getElementById('latitude').value = ''
        document.getElementById('longitude').value = ''
        document.getElementById('salesmanId').value = ''
        document.getElementById('active').value = 'true'

        document.getElementById('modalOverlay').classList.add('show')
    }

    async editCustomer(id) {
        this.isEditing = true

        try {
            const customer = this.customers.find(c => c.id === id)
            if (!customer) {
                this.showToast('❌ Data customer tidak ditemukan')
                return
            }

            document.getElementById('modalTitle').textContent = '✏️ Edit Customer'
            document.getElementById('editId').value = customer.id
            document.getElementById('customerCode').value = customer.customer_code
            document.getElementById('customerName').value = customer.customer_name
            document.getElementById('address').value = customer.address || ''
            document.getElementById('latitude').value = customer.latitude || ''
            document.getElementById('longitude').value = customer.longitude || ''
            document.getElementById('salesmanId').value = customer.salesman_id || ''
            document.getElementById('active').value = customer.active ? 'true' : 'false'

            document.getElementById('modalOverlay').classList.add('show')

        } catch (error) {
            console.error('Error editing customer:', error)
            this.showToast('❌ Gagal memuat data customer')
        }
    }

    async saveCustomer(e) {
        e.preventDefault()

        const id = document.getElementById('editId').value
        const customerCode = document.getElementById('customerCode').value.trim()
        const customerName = document.getElementById('customerName').value.trim()
        const address = document.getElementById('address').value.trim()
        const latitude = document.getElementById('latitude').value
        const longitude = document.getElementById('longitude').value
        const salesmanId = document.getElementById('salesmanId').value || null
        const active = document.getElementById('active').value === 'true'

        // Validasi
        if (!customerCode) {
            this.showToast('⚠️ Kode customer harus diisi')
            return
        }
        if (!customerName) {
            this.showToast('⚠️ Nama customer harus diisi')
            return
        }

        try {
            const data = {
                customer_code: customerCode,
                customer_name: customerName,
                address: address || null,
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null,
                salesman_id: salesmanId,
                active: active,
                updated_at: new Date().toISOString()
            }

            if (this.isEditing) {
                // UPDATE
                const { error } = await supabase
                    .from('customers')
                    .update(data)
                    .eq('id', id)

                if (error) throw error
                this.showToast('✅ Customer berhasil diupdate')

            } else {
                // INSERT
                data.created_at = new Date().toISOString()
                const { error } = await supabase
                    .from('customers')
                    .insert([data])

                if (error) throw error
                this.showToast('✅ Customer berhasil ditambahkan')
            }

            this.closeModal()
            await this.loadCustomers()

        } catch (error) {
            console.error('Error saving customer:', error)
            this.showToast('❌ Gagal menyimpan: ' + error.message)
        }
    }

    // ============================================================
    // DELETE CUSTOMER
    // ============================================================

    async deleteCustomer(id) {
        if (!confirm('Yakin ingin menghapus customer ini?')) return

        try {
            const { error } = await supabase
                .from('customers')
                .delete()
                .eq('id', id)

            if (error) throw error

            this.showToast('✅ Customer berhasil dihapus')
            await this.loadCustomers()

        } catch (error) {
            console.error('Error deleting customer:', error)
            this.showToast('❌ Gagal menghapus customer: ' + error.message)
        }
    }

    // ============================================================
    // MODAL
    // ============================================================

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('show')
        document.getElementById('customerForm').reset()
    }

    // ============================================================
    // HELPERS
    // ============================================================

    updateDateTime() {
        const now = new Date()
        document.getElementById('customersDate').textContent = now.toLocaleDateString('id-ID', {
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
        document.getElementById('addCustomerBtn').addEventListener('click', () => {
            this.addCustomer()
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
        document.getElementById('customerForm').addEventListener('submit', (e) => {
            this.saveCustomer(e)
        })

        // Search
        document.getElementById('searchCustomer').addEventListener('input', (e) => {
            this.searchTerm = e.target.value
            this.renderTable()
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
const manager = new CustomersManager()
manager.init()
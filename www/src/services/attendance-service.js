// src/services/attendance-service.js
import { supabase } from './supabase-client.js'

export const AttendanceService = {
    // Get today's attendance for a user
    async getTodayAttendance(userId) {
        const today = new Date()
        const dateStr = today.toISOString().split('T')[0]
        
        const { data, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .eq('attendance_date', dateStr)
            .single()
        
        if (error && error.code !== 'PGRST116') {
            throw error
        }
        return data
    },

    // Check-in
    async checkIn(userId, latitude, longitude, accuracy) {
        const today = new Date()
        const dateStr = today.toISOString().split('T')[0]
        
        // Check if already checked in
        const existing = await this.getTodayAttendance(userId)
        if (existing && existing.status === 'checked_in') {
            throw new Error('Anda sudah absen masuk hari ini')
        }

        // Get device info
        const deviceInfo = {
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            language: navigator.language,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            browser: this.getBrowserInfo()
        }

        const attendanceData = {
            user_id: userId,
            attendance_date: dateStr,
            check_in_at: new Date().toISOString(),
            check_in_latitude: latitude,
            check_in_longitude: longitude,
            check_in_accuracy: accuracy,
            status: 'checked_in'
        }

        let result
        if (existing) {
            // Update existing attendance
            const { data, error } = await supabase
                .from('attendance')
                .update(attendanceData)
                .eq('id', existing.id)
                .select()
                .single()
            
            if (error) throw error
            result = data
        } else {
            // Create new attendance
            const { data, error } = await supabase
                .from('attendance')
                .insert([attendanceData])
                .select()
                .single()
            
            if (error) throw error
            result = data
        }

        // Create notification
        await this.createNotification(
            userId,
            'Absen Masuk',
            `Anda telah absen masuk pada ${new Date().toLocaleTimeString('id-ID')}`,
            'success'
        )

        return result
    },

    // Check-out
    async checkOut(attendanceId, latitude, longitude, accuracy) {
        const checkOutData = {
            check_out_at: new Date().toISOString(),
            check_out_latitude: latitude,
            check_out_longitude: longitude,
            check_out_accuracy: accuracy,
            status: 'checked_out',
            updated_at: new Date().toISOString()
        }

        const { data, error } = await supabase
            .from('attendance')
            .update(checkOutData)
            .eq('id', attendanceId)
            .select()
            .single()

        if (error) throw error

        // Create notification
        await this.createNotification(
            data.user_id,
            'Absen Pulang',
            `Anda telah absen pulang pada ${new Date().toLocaleTimeString('id-ID')}`,
            'success'
        )

        return data
    },

    // Get attendance history for a user
    async getAttendanceHistory(userId, startDate, endDate) {
        let query = supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .order('attendance_date', { ascending: false })

        if (startDate) {
            query = query.gte('attendance_date', startDate)
        }
        if (endDate) {
            query = query.lte('attendance_date', endDate)
        }

        const { data, error } = await query
        if (error) throw error
        return data
    },

    // Get all attendance for admin
    async getAllAttendance(date) {
        let query = supabase
            .from('attendance')
            .select(`
                *,
                profiles:user_id (
                    full_name,
                    employee_code,
                    phone
                )
            `)
            .order('check_in_at', { ascending: false })

        if (date) {
            query = query.eq('attendance_date', date)
        }

        const { data, error } = await query
        if (error) throw error
        return data
    },

    // Get attendance summary for dashboard
    async getAttendanceSummary(date) {
        const { data, error } = await supabase
            .from('attendance')
            .select('status')
            .eq('attendance_date', date)

        if (error) throw error

        const summary = {
            total: data.length,
            checked_in: data.filter(a => a.status === 'checked_in').length,
            checked_out: data.filter(a => a.status === 'checked_out').length,
            pending: data.filter(a => a.status === 'pending').length
        }

        return summary
    },

    // Create notification
    async createNotification(userId, title, message, type = 'info') {
        const { error } = await supabase
            .from('notifications')
            .insert([{
                user_id: userId,
                title,
                message,
                type
            }])

        if (error) console.error('Error creating notification:', error)
    },

    // Get browser info
    getBrowserInfo() {
        const ua = navigator.userAgent
        let browser = 'Unknown'
        
        if (ua.indexOf('Firefox') > -1) browser = 'Firefox'
        else if (ua.indexOf('SamsungBrowser') > -1) browser = 'Samsung Browser'
        else if (ua.indexOf('Chrome') > -1) browser = 'Chrome'
        else if (ua.indexOf('Safari') > -1) browser = 'Safari'
        else if (ua.indexOf('Edge') > -1) browser = 'Edge'
        else if (ua.indexOf('Opera') > -1) browser = 'Opera'
        
        return browser
    },

    // Validate check-out conditions
    async validateCheckOut(userId) {
        const attendance = await this.getTodayAttendance(userId)

        if (!attendance) {
            throw new Error('Anda belum absen masuk hari ini')
        }

        if (attendance.status === 'checked_out') {
            throw new Error('Anda sudah absen pulang hari ini')
        }

        if (attendance.status !== 'checked_in') {
            throw new Error('Status absensi tidak valid')
        }

        return attendance
    }
}
// src/services/location-service.js
import { supabase } from './supabase-client.js'

export const LocationService = {
    // Save tracking point
    async saveTrackingPoint(userId, attendanceId, coords) {
        const trackingData = {
            user_id: userId,
            attendance_id: attendanceId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy || null,
            speed: coords.speed || null,
            heading: coords.heading || null,
            recorded_at: new Date().toISOString()
        }

        // Add battery if available
        if (navigator.getBattery) {
            try {
                const battery = await navigator.getBattery()
                trackingData.battery_level = battery.level * 100
            } catch (e) {
                // Battery API not available
            }
        }

        const { data, error } = await supabase
            .from('location_tracking')
            .insert([trackingData])
            .select()
            .single()

        if (error) throw error
        return data
    },

    // Get latest location for a user
    async getLatestLocation(userId) {
        const { data, error } = await supabase
            .from('location_tracking')
            .select('*')
            .eq('user_id', userId)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    // Get all locations for a user on a date
    async getUserLocations(userId, date) {
        const startDate = new Date(date)
        startDate.setHours(0, 0, 0, 0)
        
        const endDate = new Date(date)
        endDate.setHours(23, 59, 59, 999)

        const { data, error } = await supabase
            .from('location_tracking')
            .select('*')
            .eq('user_id', userId)
            .gte('recorded_at', startDate.toISOString())
            .lte('recorded_at', endDate.toISOString())
            .order('recorded_at', { ascending: true })

        if (error) throw error
        return data
    },

    // Get all active salesmen locations (for admin)
    async getAllActiveLocations() {
        // Get all checked-in salesmen
        const { data: attendanceData, error: attendanceError } = await supabase
            .from('attendance')
            .select('user_id')
            .eq('status', 'checked_in')
            .eq('attendance_date', new Date().toISOString().split('T')[0])

        if (attendanceError) throw attendanceError

        if (!attendanceData || attendanceData.length === 0) {
            return []
        }

        const userIds = attendanceData.map(a => a.user_id)

        // Get latest location for each user
        const { data: locationData, error: locationError } = await supabase
            .rpc('get_latest_locations', { user_ids: userIds })

        if (locationError) throw locationError
        return locationData
    },

    // Get tracking statistics for a user
    async getTrackingStats(userId, date) {
        const { data, error } = await supabase
            .from('location_tracking')
            .select('*')
            .eq('user_id', userId)
            .gte('recorded_at', new Date(date).toISOString().split('T')[0])
            .lte('recorded_at', new Date(date).toISOString().split('T')[0] + ' 23:59:59')

        if (error) throw error

        if (!data || data.length === 0) {
            return {
                totalPoints: 0,
                totalDistance: 0,
                avgSpeed: 0,
                maxSpeed: 0
            }
        }

        // Calculate distance between points
        let totalDistance = 0
        let maxSpeed = 0
        let speedSum = 0
        let speedCount = 0

        for (let i = 1; i < data.length; i++) {
            const prev = data[i - 1]
            const curr = data[i]
            
            const distance = this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            )
            totalDistance += distance

            if (curr.speed) {
                maxSpeed = Math.max(maxSpeed, curr.speed)
                speedSum += curr.speed
                speedCount++
            }
        }

        return {
            totalPoints: data.length,
            totalDistance: totalDistance,
            avgSpeed: speedCount > 0 ? speedSum / speedCount : 0,
            maxSpeed: maxSpeed
        }
    },

    // Calculate distance between two points (Haversine formula)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371 // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1)
        const dLon = this.toRad(lon2 - lon1)
        
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2)
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
        return R * c // Distance in km
    },

    toRad(deg) {
        return deg * Math.PI / 180
    },

    // Check if location has changed significantly
    hasMovedSignificantly(lat1, lon1, lat2, lon2, threshold = 0.02) {
        // threshold in km (default 20 meters)
        const distance = this.calculateDistance(lat1, lon1, lat2, lon2)
        return distance > threshold
    },

    // Get GPS status for a user
    getGPSStatus(locations) {
        if (!locations || locations.length === 0) {
            return {
                status: 'offline',
                label: '🔴 OFFLINE',
                lastUpdate: null,
                minutesSince: null
            }
        }

        const lastLocation = locations[0]
        const lastUpdate = new Date(lastLocation.recorded_at)
        const now = new Date()
        const minutesSince = Math.floor((now - lastUpdate) / (1000 * 60))

        let status, label
        if (minutesSince < 5) {
            status = 'online'
            label = '🟢 ONLINE'
        } else if (minutesSince < 15) {
            status = 'warning'
            label = '🟡 WARNING'
        } else {
            status = 'offline'
            label = '🔴 OFFLINE'
        }

        return {
            status,
            label,
            lastUpdate,
            minutesSince
        }
    },

    // Clean up old tracking data (admin function)
    async cleanupOldData(daysToKeep = 90) {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

        const { error } = await supabase
            .from('location_tracking')
            .delete()
            .lt('recorded_at', cutoffDate.toISOString())

        if (error) throw error
        return true
    }
}

// ==========================================
// Supabase Function: get_latest_locations
// ==========================================
/*
CREATE OR REPLACE FUNCTION get_latest_locations(user_ids UUID[])
RETURNS TABLE(
    user_id UUID,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    recorded_at TIMESTAMP WITH TIME ZONE,
    accuracy DECIMAL(10,2),
    speed DECIMAL(10,2),
    battery_level DECIMAL(5,2)
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (lt.user_id)
        lt.user_id,
        lt.latitude,
        lt.longitude,
        lt.recorded_at,
        lt.accuracy,
        lt.speed,
        lt.battery_level
    FROM location_tracking lt
    WHERE lt.user_id = ANY(user_ids)
    ORDER BY lt.user_id, lt.recorded_at DESC;
END;
$$;
*/
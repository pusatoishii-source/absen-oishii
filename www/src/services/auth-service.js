// src/services/auth-service.js
import { supabase } from './supabase-client.js'

export const AuthService = {
    // Login with email & password
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })
        if (error) throw error
        return data
    },

    // Logout
    async logout() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
        localStorage.removeItem('user')
        localStorage.removeItem('profile')
    },

    // Get current user
    async getCurrentUser() {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error) throw error
        return user
    },

    // Get user profile with role
    async getUserProfile(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .single()
        if (error) throw error
        return data
    },

    // Register new user (admin only)
    // NOTE: supabase.auth.admin.* requires the service_role key, which must
    // NEVER be exposed in client-side code. Creating users as an admin
    // should be done through a Supabase Edge Function (using the service
    // role key server-side) that this method calls, not directly from the
    // browser with the anon key. This method is kept for reference but the
    // rollback step below will fail with an auth error from the client.
    async registerUser(email, password, profileData) {
        // First create auth user
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
        })
        if (authError) throw authError

        // Then create profile
        const { data: profileDataResult, error: profileError } = await supabase
            .from('profiles')
            .insert([{
                user_id: authData.user.id,
                ...profileData
            }])
            .select()
            .single()

        if (profileError) {
            // Best-effort rollback: this requires the service_role key and
            // will fail when called with the anon key from the client. See
            // the note above — move this whole flow to an Edge Function.
            try {
                await supabase.auth.admin.deleteUser(authData.user.id)
            } catch (rollbackError) {
                console.error('Rollback failed (expected from client-side anon key):', rollbackError)
            }
            throw profileError
        }

        return { auth: authData, profile: profileDataResult }
    },

    // Check if user has role
    async checkUserRole(requiredRole) {
        const user = await this.getCurrentUser()
        if (!user) return false
        
        const profile = await this.getUserProfile(user.id)
        if (!profile) return false

        if (requiredRole === 'salesman') {
            return profile.role === 'salesman'
        } else if (requiredRole === 'admin') {
            return profile.role === 'admin' || profile.role === 'super_admin'
        } else if (requiredRole === 'super_admin') {
            return profile.role === 'super_admin'
        }
        return false
    },

    // Check if session is valid
    async checkSession() {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
            return false
        }
        return true
    },

    // Password reset
    async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        })
        if (error) throw error
        return true
    },

    // Update user password
    async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        })
        if (error) throw error
        return true
    }
}
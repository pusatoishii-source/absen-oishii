// src/services/supabase-client.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pfboaxblozrfranaipzx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmYm9heGJsb3pyZnJhbmFpcHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NjY3NTIsImV4cCI6MjEwNTA0Mjc1Mn0.OjuzFEmBDSjOoQExh15ySZqKDM89Jbkkc7724fh-sxc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Enable realtime
export const enableRealtime = (table) => {
    return supabase
        .channel('realtime-' + table)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: table }, 
            (payload) => {
                console.log('Realtime update:', payload)
            }
        )
        .subscribe()
}
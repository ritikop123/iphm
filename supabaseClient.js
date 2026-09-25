// Supabase Client Configuration for IPHM.NETWORK
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://izutiszeevhhkfaolblw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_H3Qw7GUcirt3D-m737aJ2Q_Rwvc5wwO';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export default supabase;

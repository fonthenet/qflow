import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

/**
 * Supabase client for the customer mobile app.
 *
 * Uses AsyncStorage for session persistence so the user stays logged in
 * across app launches. Session is refreshed automatically (autoRefreshToken).
 *
 * The customer app uses anonymous / phone-less access for browsing queues;
 * authenticated sessions are created via Supabase Magic Link or OAuth when
 * the user opts to save their booking history.
 *
 * TODO(web-engineer): Wire up the edge function for push token registration
 *   once the customer auth flow is implemented.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// These are pulled from environment variables.
// In Expo, EXPO_PUBLIC_ prefix makes them available at build time.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and fill in your credentials.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── Auth helpers ────────────────────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

const ISSUE_PHOTOS_BUCKET = 'issue-photos';

export async function uploadIssuePhoto(
  localUri: string,
  fileName: string
): Promise<string | null> {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const { data, error } = await supabase.storage
    .from(ISSUE_PHOTOS_BUCKET)
    .upload(`public/${fileName}`, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error || !data) {
    console.error('Photo upload error:', error);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(ISSUE_PHOTOS_BUCKET)
    .getPublicUrl(data.path);

  return publicUrl;
}

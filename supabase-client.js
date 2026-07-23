// ============================================================
// NairaPlus — Supabase client
// Get these two values from: Supabase Dashboard → Project Settings → API
//   Project URL      -> SUPABASE_URL
//   anon public key  -> SUPABASE_ANON_KEY   (safe to expose in the browser)
// Never put your service_role key or Paystack secret key in this file.
// ============================================================
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

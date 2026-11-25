import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "./config";

/** For requests with no visitor behind them. The game holds a device token, not a session. */
export const createAnonSupabase = () =>
  createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabaseConfigured = () => Boolean(supabaseUrl && supabaseKey);

export const OAUTH_PROVIDERS = ["discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const isOAuthProvider = (value: string | null): value is OAuthProvider =>
  OAUTH_PROVIDERS.some((provider) => provider === value);

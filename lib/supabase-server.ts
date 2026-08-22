import { createClient, type User } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'attendant';

export type UserProfile = {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getSupabaseAdmin() {
  return createClient(
    requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnvironment('SUPABASE_SECRET_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function getSupabasePublicConfiguration() {
  return {
    url: requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: requiredEnvironment('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
}

export async function requireSupabaseUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function getUserProfile(user: User): Promise<UserProfile | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .select('user_id, email, display_name, role, active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return {
    userId: data.user_id,
    email: data.email,
    displayName: data.display_name?.trim() || userDisplayName(user),
    role: data.role as UserRole,
    active: data.active,
  };
}

export async function requireUserProfile(request: Request) {
  const user = await requireSupabaseUser(request);
  if (!user) return null;
  const profile = await getUserProfile(user);
  return profile ? { user, profile } : null;
}

export async function requireAdminProfile(request: Request) {
  const authenticated = await requireUserProfile(request);
  return authenticated?.profile.role === 'admin' ? authenticated : null;
}

export function userDisplayName(user: User) {
  const metadataName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name
    : typeof user.user_metadata?.name === 'string'
      ? user.user_metadata.name
      : null;
  return metadataName?.trim().split(' ')[0] || user.email?.split('@')[0] || 'Usuário';
}

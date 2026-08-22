'use client';

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { LockKeyhole, LogIn, ShieldCheck, Truck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import type { UserProfile } from '../lib/supabase-server';
import InboxClient from './inbox-client';

type PublicConfiguration = { url: string; publishableKey: string };

export default function AuthGate() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    fetch('/api/config')
      .then(async (response) => {
        const payload = await response.json() as PublicConfiguration & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Configuração indisponível.');
        return payload;
      })
      .then(async (configuration) => {
        if (!active) return;
        const supabase = createClient(configuration.url, configuration.publishableKey);
        setClient(supabase);
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setProfile(null);
          setError('');
          setSession(nextSession);
        });
        unsubscribe = () => listener.data.subscription.unsubscribe();
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a Central.'))
      .finally(() => setLoading(false));

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { profile?: UserProfile; error?: string };
        if (!response.ok || !payload.profile) throw new Error(payload.error || 'Perfil indisponível.');
        if (active) setProfile(payload.profile);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Perfil indisponível.');
      });
    return () => { active = false; };
  }, [session]);

  if (loading || (session && !profile && !error)) return <AuthLoading />;
  if (session && client && profile) {
    return <InboxClient profile={profile} accessToken={session.access_token} onSignOut={() => client.auth.signOut()} />;
  }
  if (session && client && !profile) {
    return <main className="auth-page auth-setup-page"><section className="auth-form-panel"><div className="auth-form setup-notice"><span className="auth-lock"><ShieldCheck size={20} /></span><p className="auth-eyebrow">Configuração inicial</p><h2>Preparando seu perfil</h2><p className="auth-description">{error || 'O perfil de acesso ainda não foi criado no banco.'}</p><button type="button" onClick={() => window.location.reload()}>Tentar novamente</button><button className="link-button" type="button" onClick={() => void client.auth.signOut()}>Sair desta conta</button></div></section></main>;
  }

  return <LoginScreen client={client} initialError={error} />;
}

function LoginScreen({ client, initialError }: { client: SupabaseClient | null; initialError: string }) {
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || submitting) return;
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    const { error: authError } = await client.auth.signInWithPassword({
      email: String(data.get('email') || '').trim(),
      password: String(data.get('password') || ''),
    });
    if (authError) setError('E-mail ou senha inválidos.');
    setSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span>F</span><strong>Central Frota</strong></div>
        <div className="auth-brand-copy"><p>OPERAÇÃO INTEGRADA</p><h1>Do WhatsApp ao fechamento fiscal.</h1><span>Atendimento, notas, placas, DRE, Benner e Portal Fiscal em uma única trilha.</span></div>
        <div className="auth-flow"><div><Truck size={17} /><span>Frota & LOG20</span></div><i /><div><ShieldCheck size={17} /><span>Ambiente protegido</span></div></div>
      </section>
      <section className="auth-form-panel">
        <form className="auth-form" onSubmit={signIn}>
          <span className="auth-lock"><LockKeyhole size={20} /></span>
          <p className="auth-eyebrow">Acesso restrito</p>
          <h2>Entrar na Central</h2>
          <p className="auth-description">Use o acesso criado pelo administrador da frota.</p>
          <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="nome@empresa.com.br" /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required placeholder="Sua senha" /></label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={!client || submitting}>{submitting ? 'Entrando…' : <><LogIn size={15} /> Entrar</>}</button>
          <small>Em caso de acesso bloqueado, procure o responsável pelo sistema.</small>
        </form>
      </section>
    </main>
  );
}

function AuthLoading() {
  return <main className="auth-loading"><span className="brand-mark">F</span><p>Preparando a Central…</p></main>;
}

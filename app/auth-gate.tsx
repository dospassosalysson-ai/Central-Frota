'use client';

import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ArrowLeft, Check, KeyRound, LockKeyhole, LogIn, Mail, ShieldCheck, Truck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import type { UserProfile } from '../lib/supabase-server';
import InboxClient from './inbox-client';

type PublicConfiguration = { url: string; publishableKey: string };

export default function AuthGate() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [firstAccess, setFirstAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const passwordDefinitionRequired = Boolean(session && !session.user.user_metadata?.first_access_completed_at);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const openedFromFirstAccessLink = isFirstAccessLink();

    fetch('/api/config')
      .then(async (response) => {
        if (active && openedFromFirstAccessLink) setFirstAccess(true);
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
        const listener = supabase.auth.onAuthStateChange((event, nextSession) => {
          setProfile(null);
          setError('');
          setSession(nextSession);
          if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && isFirstAccessLink())) setFirstAccess(true);
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

  if (loading) return <AuthLoading />;
  if (session && client && (firstAccess || passwordDefinitionRequired)) {
    return (
      <FirstAccessScreen
        client={client}
        email={session.user.email || ''}
        onComplete={(updatedUser) => {
          setSession((current) => current ? { ...current, user: updatedUser } : current);
          clearFirstAccessLink();
          setFirstAccess(false);
          setError('');
        }}
        onSignOut={() => {
          clearFirstAccessLink();
          setFirstAccess(false);
          void client.auth.signOut();
        }}
      />
    );
  }
  if (session && !profile && !error) return <AuthLoading />;
  if (session && client && profile) {
    return <InboxClient profile={profile} accessToken={session.access_token} onSignOut={() => client.auth.signOut()} />;
  }
  if (session && client && !profile) {
    return <main className="auth-page auth-setup-page"><section className="auth-form-panel"><div className="auth-form setup-notice"><span className="auth-lock"><ShieldCheck size={20} /></span><p className="auth-eyebrow">Configuração inicial</p><h2>Preparando seu perfil</h2><p className="auth-description">{error || 'O perfil de acesso ainda não foi criado no banco.'}</p><button type="button" onClick={() => window.location.reload()}>Tentar novamente</button><button className="link-button" type="button" onClick={() => void client.auth.signOut()}>Sair desta conta</button></div></section></main>;
  }
  if (firstAccess) {
    return <ExpiredAccessScreen onReturn={() => { clearFirstAccessLink(); setFirstAccess(false); setError(''); }} />;
  }

  return <LoginScreen client={client} initialError={error} />;
}

function FirstAccessScreen({ client, email, onComplete, onSignOut }: { client: SupabaseClient; email: string; onComplete: (user: User) => void; onSignOut: () => void }) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function definePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('confirmation') || '');

    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Use pelo menos 10 caracteres, incluindo letras e números.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas informadas não são iguais.');
      return;
    }

    setSubmitting(true);
    setError('');
    const { data: updateData, error: updateError } = await client.auth.updateUser({
      password,
      data: { first_access_completed_at: new Date().toISOString() },
    });
    if (updateError) {
      setError(updateError.message.toLowerCase().includes('same password')
        ? 'Escolha uma senha diferente da atual.'
        : 'Não foi possível salvar a senha. Solicite um novo link de primeiro acesso.');
      setSubmitting(false);
      return;
    }
    onComplete(updateData.user);
  }

  return (
    <main className="auth-page first-access-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span>F</span><strong>Central Frota</strong></div>
        <div className="auth-brand-copy first-access-copy"><p>PRIMEIRO ACESSO</p><h1>Seu ambiente de gestão está pronto.</h1><span>Defina uma senha pessoal para entrar com segurança na operação da frota.</span></div>
        <div className="first-access-steps">
          <div className="done"><span><Check size={14} /></span><p><strong>Conta validada</strong><small>Identidade confirmada pelo Supabase</small></p></div>
          <div className="active"><span>2</span><p><strong>Crie sua senha</strong><small>Uso exclusivo para esta Central</small></p></div>
          <div><span>3</span><p><strong>Acesso liberado</strong><small>Entrada direta na sala de controle</small></p></div>
        </div>
      </section>
      <section className="auth-form-panel">
        <form className="auth-form first-access-form" onSubmit={definePassword}>
          <span className="auth-lock"><KeyRound size={20} /></span>
          <p className="auth-eyebrow">Configuração da conta</p>
          <h2>Crie sua senha</h2>
          <p className="auth-description">O acesso foi confirmado para <strong>{email}</strong>. Esta etapa acontece apenas uma vez.</p>
          <label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="Mínimo de 10 caracteres" /></label>
          <label>Confirmar nova senha<input name="confirmation" type="password" autoComplete="new-password" minLength={10} required placeholder="Digite novamente" /></label>
          <div className="password-guidance"><span><Check size={11} /> 10 ou mais caracteres</span><span><Check size={11} /> Letras e números</span></div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? 'Salvando…' : <><ShieldCheck size={15} /> Salvar senha e entrar</>}</button>
          <button className="link-button" type="button" onClick={onSignOut}>Sair desta conta</button>
        </form>
      </section>
    </main>
  );
}

function ExpiredAccessScreen({ onReturn }: { onReturn: () => void }) {
  return (
    <main className="auth-page auth-setup-page">
      <section className="auth-form-panel">
        <div className="auth-form setup-notice">
          <span className="auth-lock"><KeyRound size={20} /></span>
          <p className="auth-eyebrow">Primeiro acesso</p>
          <h2>Este link não está mais válido</h2>
          <p className="auth-description">O link pode ter expirado ou já ter sido utilizado. Volte ao login e solicite um novo em Primeiro acesso.</p>
          <button type="button" onClick={onReturn}>Voltar para o login</button>
        </div>
      </section>
    </main>
  );
}

function LoginScreen({ client, initialError }: { client: SupabaseClient | null; initialError: string }) {
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationSent, setActivationSent] = useState(false);

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

  async function requestFirstAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || submitting) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || '').trim().toLowerCase();
    setSubmitting(true);
    setError('');

    try {
      await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/?first_access=1`,
      });
      setActivationSent(true);
    } catch {
      setError('Não foi possível concluir a solicitação agora. Tente novamente em alguns minutos.');
    } finally {
      setSubmitting(false);
    }
  }

  function returnToLogin() {
    setActivationOpen(false);
    setActivationSent(false);
    setError('');
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><span>F</span><strong>Central Frota</strong></div>
        <div className="auth-brand-copy"><p>OPERAÇÃO INTEGRADA</p><h1>Do WhatsApp ao fechamento fiscal.</h1><span>Atendimento, notas, placas, DRE, Benner e Portal Fiscal em uma única trilha.</span></div>
        <div className="auth-flow"><div><Truck size={17} /><span>Frota & LOG20</span></div><i /><div><ShieldCheck size={17} /><span>Ambiente protegido</span></div></div>
      </section>
      <section className="auth-form-panel">
        {activationOpen ? (
          <form className="auth-form" onSubmit={requestFirstAccess}>
            <span className="auth-lock"><Mail size={20} /></span>
            <p className="auth-eyebrow">Ativação segura</p>
            <h2>Primeiro acesso</h2>
            {activationSent ? (
              <>
                <p className="auth-description">Se este e-mail estiver cadastrado, você receberá um link para definir sua senha. Verifique também a caixa de spam.</p>
                <button type="button" onClick={returnToLogin}><ArrowLeft size={15} /> Voltar para o login</button>
              </>
            ) : (
              <>
                <p className="auth-description">Informe o e-mail do usuário já criado. Enviaremos um link individual para você definir sua senha.</p>
                <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="nome@empresa.com.br" /></label>
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" disabled={!client || submitting}>{submitting ? 'Solicitando…' : <><KeyRound size={15} /> Receber link de acesso</>}</button>
                <button className="link-button" type="button" onClick={returnToLogin}><ArrowLeft size={13} /> Voltar para o login</button>
              </>
            )}
          </form>
        ) : (
          <form className="auth-form" onSubmit={signIn}>
            <span className="auth-lock"><LockKeyhole size={20} /></span>
            <p className="auth-eyebrow">Acesso restrito</p>
            <h2>Entrar na Central</h2>
            <p className="auth-description">Use seu e-mail corporativo e a senha definida no primeiro acesso.</p>
            <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="nome@empresa.com.br" /></label>
            <label>Senha<input name="password" type="password" autoComplete="current-password" required placeholder="Sua senha" /></label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={!client || submitting}>{submitting ? 'Entrando…' : <><LogIn size={15} /> Entrar</>}</button>
            <button className="link-button" type="button" onClick={() => { setActivationOpen(true); setError(''); }}>Primeiro acesso ou esqueci minha senha</button>
            <small>Em caso de acesso bloqueado, procure o responsável pelo sistema.</small>
          </form>
        )}
      </section>
    </main>
  );
}

function AuthLoading() {
  return <main className="auth-loading"><span className="brand-mark">F</span><p>Preparando a Central…</p></main>;
}

function isFirstAccessLink() {
  if (typeof window === 'undefined') return false;
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const linkType = query.get('type') || hash.get('type');
  return query.get('first_access') === '1' || linkType === 'invite' || linkType === 'recovery';
}

function clearFirstAccessLink() {
  if (typeof window !== 'undefined') window.history.replaceState({}, document.title, window.location.pathname || '/');
}

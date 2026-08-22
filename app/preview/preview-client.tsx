'use client';

import InboxClient from '../inbox-client';

export default function PreviewClient() {
  return <InboxClient profile={{ userId: 'preview-admin', email: 'gestao@empresa.com.br', displayName: 'Gestão da Frota', jobTitle: 'Administrador da Central', role: 'admin', active: true }} accessToken="preview-only" onSignOut={() => undefined} />;
}

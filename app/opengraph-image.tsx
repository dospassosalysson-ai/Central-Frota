import { ImageResponse } from 'next/og';

export const alt = 'Central Frota — operação integrada';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#07121f',
        color: '#f8fafc',
        display: 'flex',
        fontFamily: 'Arial, sans-serif',
        height: '100%',
        justifyContent: 'center',
        padding: '72px',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, width: '100%' }}>
        <div style={{ color: '#2dd4bf', display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: 8 }}>
          OPERAÇÃO INTEGRADA
        </div>
        <div style={{ display: 'flex', fontSize: 88, fontWeight: 800, letterSpacing: -4 }}>
          Central Frota
        </div>
        <div style={{ color: '#cbd5e1', display: 'flex', fontSize: 35, lineHeight: 1.35, maxWidth: 1000 }}>
          Atendimento, planos de ação, equipe, financeiro e documentos fiscais em uma única central.
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 18 }}>
          {['WhatsApp', 'Benner', 'Frota', 'Gestão'].map((label) => (
            <div
              key={label}
              style={{
                background: '#0f2538',
                border: '1px solid #1f485e',
                borderRadius: 999,
                color: '#dbeafe',
                display: 'flex',
                fontSize: 24,
                padding: '13px 24px',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>,
    size,
  );
}

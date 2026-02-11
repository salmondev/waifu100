/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';

// Route segment config
export const runtime = 'edge';
export const alt = 'Waifu100 Community Showcase';
export const contentType = 'image/png';

export default async function Image() {
  const size = {
    width: 1200,
    height: 630,
  };

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(to bottom right, #09090b, #18181b)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background Accents */}
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '600px', height: '600px', borderRadius: '50%', background: 'rgba(139, 92, 246, 0.2)', filter: 'blur(100px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '600px', height: '600px', borderRadius: '50%', background: 'rgba(236, 72, 153, 0.2)', filter: 'blur(100px)' }} />

        {/* Content Container */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, gap: 10 }}>
            
            {/* Logo/Icon placeholder */}
            <div style={{ 
                width: 80, 
                height: 80, 
                borderRadius: 40, 
                background: 'linear-gradient(135deg, #a855f7, #ec4899)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.5)',
                marginBottom: 20
            }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                    fontSize: 80,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    backgroundImage: 'linear-gradient(to right, #a78bfa, #f472b6)',
                    backgroundClip: 'text',
                    color: 'transparent',
                    lineHeight: 1,
                    marginBottom: 10
                } as any}>
                    Waifu100
                </div>
                <div style={{ fontSize: 50, fontWeight: 300, color: '#e4e4e7', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Community
                </div>
            </div>

            <div style={{ 
                marginTop: 40, 
                padding: '15px 40px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 100,
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#a1a1aa',
                fontSize: 24,
                fontWeight: 500 
            }}>
                Discover • Share • Challenge
            </div>

        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { redis } from '@/lib/redis';

// Route segment config
export const runtime = 'nodejs';
export const revalidate = 60; // Revalidate every minute
export const alt = 'Waifu100 Community Showcase';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  // Fetch latest 3 grids
  let grids: { id: string; imageUrl: string | null }[] = [];
  
  try {
    const ids = await redis.zrevrange('waifu100:feed', 0, 2);
    if (ids && ids.length > 0) {
      const pipeline = redis.pipeline();
      ids.forEach((id) => pipeline.get(`waifu100:share:${id}`));
      const results = await pipeline.exec();
      
      grids = results?.map((result, index) => {
         const [err, data] = result;
         if (err || !data) return null;
         try {
             const parsed = JSON.parse(data as string);
             // Verify it has an image
             if (!parsed.meta?.imageUrl) return null;
             return {
                 id: ids[index],
                 imageUrl: parsed.meta.imageUrl
             };
         } catch { return null; }
      }).filter((g): g is { id: string; imageUrl: string } => g !== null) || [];
    }
  } catch (e) {
    console.error("OG Image Fetch Error:", e);
  }

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, gap: 20 }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                <div style={{ width: 12, height: 12, borderRadius: 6, background: '#a855f7' }} />
                <div style={{ fontSize: 60, fontWeight: 800, color: 'white', letterSpacing: '-0.02em', backgroundImage: 'linear-gradient(to right, #a78bfa, #f472b6)', backgroundClip: 'text', color: 'transparent' }}>
                    Waifu100
                </div>
                <div style={{ fontSize: 60, fontWeight: 300, color: '#a1a1aa' }}>
                    Community
                </div>
            </div>

            {/* Grid Preview */}
            <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
                {grids.length > 0 ? (
                    grids.slice(0, 3).map((grid, i) => (
                        <div key={grid.id} style={{
                            display: 'flex',
                            width: 250,
                            height: 250,
                            borderRadius: 24,
                            overflow: 'hidden',
                            border: '2px solid rgba(255,255,255,0.1)',
                            boxShadow: '0 20px 50px -10px rgba(0,0,0,0.5)',
                            transform: i === 1 ? 'translateY(-20px) scale(1.1)' : 'none',
                            zIndex: i === 1 ? 20 : 10,
                        }}>
                            <img 
                                src={grid.imageUrl} 
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        </div>
                    ))
                ) : (
                   <div style={{ fontSize: 24, color: '#71717a' }}>Join the challenge to be featured!</div>
                )}
            </div>
            
            <div style={{ marginTop: 40, fontSize: 24, color: '#a1a1aa', fontWeight: 500 }}>
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

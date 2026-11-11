// Cloudflare Pages Function: /api/frames
// Returns available frame layouts & templates from Cloudflare D1 Database

export async function onRequestGet(context) {
  const { env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // Default system frames fallback
  const defaultFrames = [
    {
      id: 'frame_newspaper_default',
      name: 'The Songwat Times',
      mode: 'newspaper',
      layout: 'newspaper',
      title: 'THE SONGWAT CHRONICLE',
      color: '#2b231d',
      imageUrl: ''
    },
    {
      id: 'frame_receipt_default',
      name: 'Vintage Cafe Slip',
      mode: 'receipt',
      layout: 'receipt',
      title: 'KEPT • MEMORY RECEIPT',
      color: '#10B981',
      imageUrl: ''
    },
    {
      id: 'frame_strip_neon',
      name: 'Cyber Neon Strip',
      mode: 'strip',
      layout: 'strip',
      title: 'KEPT CYBER BOOTH',
      color: '#A855F7',
      imageUrl: ''
    },
    {
      id: 'frame_newspaper_drive',
      name: 'Songwat Heritage',
      mode: 'newspaper',
      layout: 'newspaper',
      title: 'SONGWAT HERITAGE ARCHIVES',
      color: '#B45309',
      imageUrl: ''
    }
  ];

  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(`
        SELECT id, name, mode, layout, title, color, image_url as imageUrl
        FROM frames
        WHERE is_active = 1
        ORDER BY id ASC
      `).all();

      if (results && results.length > 0) {
        return new Response(JSON.stringify({
          success: true,
          source: 'Cloudflare D1 Database',
          frames: results
        }), { headers: corsHeaders });
      }
    } catch (dbErr) {
      console.log('Frames D1 fallback to default:', dbErr.message);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    source: 'Built-in System Templates',
    frames: defaultFrames
  }), { headers: corsHeaders });
}

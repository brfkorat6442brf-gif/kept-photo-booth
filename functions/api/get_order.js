// Cloudflare Pages Function: /api/get_order
// Handles GET requests to retrieve order details and framed artwork from Cloudflare D1 or KV

export async function onRequestGet(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const url = new URL(request.url);
  const orderId = url.searchParams.get('order');

  if (!orderId) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Missing order parameter'
    }), { status: 400, headers: corsHeaders });
  }

  try {
    // 1. Try querying Cloudflare D1 Database
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`
          SELECT * FROM orders WHERE order_id = ? LIMIT 1
        `).bind(orderId).first();

        if (row) {
          let shots = [];
          try {
            shots = JSON.parse(row.shots_json || '[]');
          } catch (e) {}

          return new Response(JSON.stringify({
            success: true,
            source: 'Cloudflare D1 Database',
            orderId: row.order_id,
            dateFolder: row.date_folder,
            frameName: row.frame_name,
            frameLayout: row.frame_layout,
            timestamp: row.timestamp,
            note: row.note,
            printJpg: row.print_jpg,
            animatedGif: row.animated_gif,
            downloadUrl: row.download_url,
            gdriveDailyFolder: row.gdrive_daily_folder,
            gdriveFolderId: row.gdrive_folder_id || '1giOkC-Y37veBgt4AshEYiatunVuzEtw2',
            shots: shots,
            files: {
              printJpg: row.print_jpg,
              animatedGif: row.animated_gif
            }
          }), { headers: corsHeaders });
        }
      } catch (dbErr) {
        console.error('D1 Query Error:', dbErr);
      }
    }

    // 2. Try querying Cloudflare KV Storage
    if (env.BOOTH_KV) {
      try {
        const kvData = await env.BOOTH_KV.get('order:' + orderId, 'json');
        if (kvData) {
          return new Response(JSON.stringify({
            success: true,
            source: 'Cloudflare KV Storage',
            ...kvData
          }), { headers: corsHeaders });
        }
      } catch (kvErr) {
        console.error('KV Query Error:', kvErr);
      }
    }

    // 3. Fallback mock response if newly placed or DB empty
    return new Response(JSON.stringify({
      success: false,
      orderId: orderId,
      message: 'Order not found in Cloudflare Database. Please verify order ID.'
    }), { status: 404, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

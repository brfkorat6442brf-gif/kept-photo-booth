// Cloudflare Pages Function: /api/sync_stats
// Health check and real-time database stats for Cloudflare D1

export async function onRequestGet(context) {
  const { env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  const status = {
    status: 'online',
    platform: 'Cloudflare Pages & Workers',
    d1_database_connected: false,
    total_orders: 0,
    today_orders: 0,
    latest_order: null,
    gdrive_target_folder: '1giOkC-Y37veBgt4AshEYiatunVuzEtw2'
  };

  if (env.DB) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const totalRow = await env.DB.prepare('SELECT COUNT(*) as count FROM orders').first();
      const todayRow = await env.DB.prepare('SELECT COUNT(*) as count FROM orders WHERE date_folder = ?').bind(today).first();
      const latestRow = await env.DB.prepare('SELECT order_id, date_folder, frame_name, timestamp FROM orders ORDER BY id DESC LIMIT 1').first();

      status.d1_database_connected = true;
      status.total_orders = totalRow ? totalRow.count : 0;
      status.today_orders = todayRow ? todayRow.count : 0;
      status.latest_order = latestRow || null;
    } catch (e) {
      status.d1_error = e.message;
    }
  }

  return new Response(JSON.stringify(status, null, 2), { headers: corsHeaders });
}

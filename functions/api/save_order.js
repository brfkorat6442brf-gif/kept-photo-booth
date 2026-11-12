// Cloudflare Pages Function: /api/save_order
// Handles POST requests to save orders and framed artwork into Cloudflare D1 Database & KV

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  try {
    const data = await request.json();
    const orderId = data.orderId || ('KP-BKK-' + Math.floor(1000 + Math.random() * 9000));
    const now = new Date();
    const dateFolder = data.dateFolder || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const frameName = data.frameName || 'Framed Photo';
    const frameLayout = data.frameLayout || 'newspaper';
    const timestamp = data.timestamp || now.toLocaleString('th-TH');
    const note = data.note || '';
    const printJpg = data.printJpg || (data.files && data.files.printJpg) || '';
    const animatedGif = data.animatedGif || (data.files && data.files.animatedGif) || '';
    const downloadUrl = data.downloadUrl || '';
    const gdriveDailyFolder = data.gdriveDailyFolder || dateFolder;
    const gdriveFolderId = data.gdriveFolderId || '1giOkC-Y37veBgt4AshEYiatunVuzEtw2';
    const shotsJson = JSON.stringify(data.shots || []);
    const shotsCount = Array.isArray(data.shots) ? data.shots.length : 0;

    let d1Saved = false;
    let kvSaved = false;

    // 1. Save to Cloudflare D1 SQL Database if bound
    if (env.DB) {
      try {
        // Auto-ensure orders table exists on first request
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL UNIQUE,
            date_folder TEXT NOT NULL,
            frame_name TEXT,
            frame_layout TEXT,
            timestamp TEXT,
            note TEXT,
            print_jpg TEXT,
            animated_gif TEXT,
            download_url TEXT,
            gdrive_daily_folder TEXT,
            gdrive_folder_id TEXT DEFAULT '1giOkC-Y37veBgt4AshEYiatunVuzEtw2',
            shots_json TEXT,
            shots_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        await env.DB.prepare(`
          INSERT INTO orders (
            order_id, date_folder, frame_name, frame_layout,
            timestamp, note, print_jpg, animated_gif,
            download_url, gdrive_daily_folder, gdrive_folder_id,
            shots_json, shots_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(order_id) DO UPDATE SET
            date_folder = excluded.date_folder,
            frame_name = excluded.frame_name,
            frame_layout = excluded.frame_layout,
            timestamp = excluded.timestamp,
            note = excluded.note,
            print_jpg = excluded.print_jpg,
            animated_gif = excluded.animated_gif,
            download_url = excluded.download_url,
            gdrive_daily_folder = excluded.gdrive_daily_folder,
            gdrive_folder_id = excluded.gdrive_folder_id,
            shots_json = excluded.shots_json,
            shots_count = excluded.shots_count
        `).bind(
          orderId, dateFolder, frameName, frameLayout,
          timestamp, note, printJpg, animatedGif,
          downloadUrl, gdriveDailyFolder, gdriveFolderId,
          shotsJson, shotsCount
        ).run();
        d1Saved = true;
      } catch (dbErr) {
        console.error('Cloudflare D1 Insert Error:', dbErr);
      }
    }

    // 2. Save full payload to Cloudflare KV for ultra-fast edge lookup
    if (env.BOOTH_KV) {
      try {
        await env.BOOTH_KV.put('order:' + orderId, JSON.stringify(data), {
          expirationTtl: 86400 * 30 // Keep for 30 days
        });
        kvSaved = true;
      } catch (kvErr) {
        console.error('Cloudflare KV Put Error:', kvErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      orderId: orderId,
      dateFolder: dateFolder,
      timestamp: timestamp,
      storage: {
        d1_database: d1Saved,
        kv_storage: kvSaved,
        status: (d1Saved || kvSaved) ? 'Saved to Cloudflare Cloud' : 'Cloudflare DB binding pending'
      },
      message: '✓ บันทึกข้อมูลออเดอร์ลงระบบ Cloudflare สำเร็จเรียบร้อย'
    }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), { status: 400, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

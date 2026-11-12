/**
 * Kept Photo Booth - Cloudflare Pages Advanced Worker (_worker.js)
 * Works seamlessly with BOTH Direct Upload (Drag-and-Drop / ZIP) and Git/Wrangler deploys.
 * Connects to Cloudflare D1 Database (binding: DB) and optional KV (binding: BOOTH_KV).
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

async function ensureD1Tables(db) {
  if (!db) return;
  await db.prepare(`
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

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      layout TEXT NOT NULL,
      title TEXT,
      color TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ================= API ROUTE 1: POST /api/save_order =================
    if (pathname === '/api/save_order' && request.method === 'POST') {
      try {
        const data = await request.json();
        const orderId = data.orderId || ('KP-BKK-' + Math.floor(1000 + Math.random() * 9000));
        const now = new Date();
        const dateFolder = data.dateFolder || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
        let d1Error = null;

        // 1. Save to Cloudflare D1 SQL Database
        if (env.DB) {
          try {
            await ensureD1Tables(env.DB);
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
          } catch (err) {
            d1Error = err.message;
          }
        }

        // 2. Save to Cloudflare KV if bound (edge cache for 30 days)
        if (env.BOOTH_KV) {
          try {
            await env.BOOTH_KV.put('order:' + orderId, JSON.stringify(data), {
              expirationTtl: 86400 * 30,
            });
            kvSaved = true;
          } catch (kvErr) {
            console.error('KV put error:', kvErr);
          }
        }

        return jsonResponse({
          success: true,
          orderId,
          dateFolder,
          timestamp,
          storage: {
            d1_database: d1Saved,
            kv_storage: kvSaved,
            d1_error: d1Error,
            status: (d1Saved || kvSaved) ? 'Saved to Cloudflare Cloud' : 'Waiting for D1 Binding (DB)',
          },
          message: '✓ บันทึกข้อมูลออเดอร์ลงระบบ Cloudflare สำเร็จเรียบร้อย',
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 400);
      }
    }

    // ================= API ROUTE 2: GET /api/get_order =================
    if (pathname === '/api/get_order' && request.method === 'GET') {
      const orderId = url.searchParams.get('order');
      if (!orderId) {
        return jsonResponse({ success: false, error: 'Missing order parameter' }, 400);
      }

      // 1. Query Cloudflare D1 Database
      if (env.DB) {
        try {
          const row = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ? LIMIT 1')
            .bind(orderId)
            .first();

          if (row) {
            let shots = [];
            try {
              shots = JSON.parse(row.shots_json || '[]');
            } catch (e) {}

            return jsonResponse({
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
              shots,
              files: {
                printJpg: row.print_jpg,
                animatedGif: row.animated_gif,
              },
            });
          }
        } catch (err) {
          console.error('D1 query error:', err);
        }
      }

      // 2. Fallback to Cloudflare KV
      if (env.BOOTH_KV) {
        try {
          const kvData = await env.BOOTH_KV.get('order:' + orderId, 'json');
          if (kvData) {
            return jsonResponse({
              success: true,
              source: 'Cloudflare KV Storage',
              ...kvData,
            });
          }
        } catch (err) {
          console.error('KV query error:', err);
        }
      }

      return jsonResponse({
        success: false,
        orderId,
        message: 'Order not found in Cloudflare Database.',
      }, 404);
    }

    // ================= API ROUTE 3: GET /api/frames =================
    if (pathname === '/api/frames' && request.method === 'GET') {
      const defaultFrames = [
        { id: 'frame_newspaper_default', name: 'The Songwat Times', mode: 'newspaper', layout: 'newspaper', title: 'THE SONGWAT CHRONICLE', color: '#2b231d', imageUrl: '' },
        { id: 'frame_receipt_default', name: 'Vintage Cafe Slip', mode: 'receipt', layout: 'receipt', title: 'KEPT • MEMORY RECEIPT', color: '#10B981', imageUrl: '' },
        { id: 'frame_strip_neon', name: 'Cyber Neon Strip', mode: 'strip', layout: 'strip', title: 'KEPT CYBER BOOTH', color: '#A855F7', imageUrl: '' },
        { id: 'frame_newspaper_drive', name: 'Songwat Heritage', mode: 'newspaper', layout: 'newspaper', title: 'SONGWAT HERITAGE ARCHIVES', color: '#B45309', imageUrl: '' },
      ];

      if (env.DB) {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            'SELECT id, name, mode, layout, title, color, image_url as imageUrl FROM frames WHERE is_active = 1 ORDER BY id ASC'
          ).all();
          if (results && results.length > 0) {
            return jsonResponse({ success: true, source: 'Cloudflare D1 Database', frames: results });
          }
        } catch (e) {}
      }

      return jsonResponse({ success: true, source: 'Built-in Templates', frames: defaultFrames });
    }

    // ================= API ROUTE 4: GET /api/sync_stats =================
    if (pathname === '/api/sync_stats' && request.method === 'GET') {
      const status = {
        status: 'online',
        platform: 'Cloudflare Workers + Static Assets & D1',
        d1_database_connected: false,
        d1_database_id: '51ad5752-04ac-4f8d-803a-2a4d48ee7853',
        total_orders: 0,
        today_orders: 0,
        latest_order: null,
        gdrive_target_folder: '1giOkC-Y37veBgt4AshEYiatunVuzEtw2',
      };

      if (env.DB) {
        try {
          await ensureD1Tables(env.DB);
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

      return jsonResponse(status);
    }

    // ================= API ROUTE 5: GET /api/get_remote_frame =================
    if (pathname === '/api/get_remote_frame') {
      return jsonResponse({ image: null, active: false, timestamp: Date.now() });
    }

    // ================= iOS MOBILECONFIG MIME TYPE =================
    if (pathname === '/Kept_PhotoBooth.mobileconfig' || pathname === '/api/install_profile') {
      const assetUrl = new URL('/Kept_PhotoBooth.mobileconfig', request.url);
      const assetRes = await env.ASSETS.fetch(new Request(assetUrl));
      if (assetRes.ok) {
        const body = await assetRes.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/x-apple-aspen-config',
            'Content-Disposition': 'attachment; filename="Kept_PhotoBooth.mobileconfig"',
            'Cache-Control': 'no-store, must-revalidate',
          },
        });
      }
      return assetRes;
    }

    // ================= STATIC ASSETS FALLBACK =================
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  },
};

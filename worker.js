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

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function getD1Setting(db, key) {
  if (!db) return '';
  try {
    await ensureD1Tables(db);
    const row = await db.prepare('SELECT value FROM settings WHERE key = ? LIMIT 1').bind(key).first();
    return row && row.value ? String(row.value) : '';
  } catch (e) {
    return '';
  }
}

async function setD1Setting(db, key, value) {
  if (!db) return false;
  await ensureD1Tables(db);
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).bind(key, String(value || '')).run();
  return true;
}

function decodeDataUrlBytes(dataUrlOrBase64, defaultMime = 'application/octet-stream') {
  if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== 'string') return null;
  let mimeType = defaultMime;
  let b64 = dataUrlOrBase64.trim();
  const match = b64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    mimeType = match[1];
    b64 = match[2];
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mimeType, bytes };
}

async function getOAuthAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GDRIVE_CLIENT_ID,
      client_secret: env.GDRIVE_CLIENT_SECRET,
      refresh_token: env.GDRIVE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'OAuth token exchange failed');
  }
  return json.access_token;
}

async function findOrCreateDriveFolder(accessToken, parentId, folderName) {
  const safeName = folderName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`'${parentId}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchJson = await searchRes.json();
  if (searchJson.files && searchJson.files.length > 0) {
    return searchJson.files[0];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok || !created.id) {
    throw new Error((created.error && created.error.message) || 'Failed to create Drive folder');
  }
  return created;
}

async function uploadMultipartToDrive(accessToken, folderId, filename, dataUrl, defaultMime) {
  const decoded = decodeDataUrlBytes(dataUrl, defaultMime);
  if (!decoded) return null;

  const boundary = 'kept_drive_boundary_' + Math.random().toString(36).slice(2);
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${decoded.mimeType}\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;

  const enc = new TextEncoder();
  const headBytes = enc.encode(metadataPart);
  const tailBytes = enc.encode(closingPart);
  const body = new Uint8Array(headBytes.length + decoded.bytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(decoded.bytes, headBytes.length);
  body.set(tailBytes, headBytes.length + decoded.bytes.length);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error((uploadJson.error && uploadJson.error.message) || `Drive upload failed for ${filename}`);
  }
  return uploadJson.webViewLink || `https://drive.google.com/file/d/${uploadJson.id}/view`;
}

async function uploadOrderToGoogleDrive({ orderId, dateFolder, gdriveFolderId, printJpg, animatedGif, shots, gdriveWebhookUrl }, env) {
  // Method 1: OAuth2 Direct Google Drive API v3 (if env secrets configured)
  if (env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN) {
    try {
      const accessToken = await getOAuthAccessToken(env);
      const dailyFolder = await findOrCreateDriveFolder(accessToken, gdriveFolderId, dateFolder);
      const jpgUrl = printJpg ? await uploadMultipartToDrive(accessToken, dailyFolder.id, `Kept_${orderId}_Framed.jpg`, printJpg, 'image/jpeg') : null;
      const gifUrl = animatedGif ? await uploadMultipartToDrive(accessToken, dailyFolder.id, `Kept_${orderId}_Framed.gif`, animatedGif, 'image/gif') : null;
      if (Array.isArray(shots)) {
        for (let i = 0; i < shots.length; i++) {
          if (shots[i]) {
            await uploadMultipartToDrive(accessToken, dailyFolder.id, `Kept_${orderId}_Shot_${i + 1}.jpg`, shots[i], 'image/jpeg');
          }
        }
      }
      return {
        synced: Boolean(jpgUrl || gifUrl),
        method: 'oauth2_drive_api',
        dailyFolderUrl: dailyFolder.webViewLink || `https://drive.google.com/drive/folders/${dailyFolder.id}`,
        jpgUrl,
        gifUrl,
        error: null,
      };
    } catch (err) {
      return { synced: false, method: 'oauth2_drive_api', error: err.message };
    }
  }

  // Method 2: Google Apps Script Web App Webhook (saved in env or D1 settings or request)
  const storedWebhook = await getD1Setting(env.DB, 'gdrive_webhook_url');
  const webhookUrl = (env.GDRIVE_WEBHOOK_URL || storedWebhook || gdriveWebhookUrl || '').trim();
  if (!webhookUrl) {
    return {
      synced: false,
      method: 'unconfigured',
      error: 'ยังไม่ได้ตั้งค่า Google Apps Script Web App URL ในหน้า Admin -> Drive',
    };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        orderId,
        dateFolder,
        folderId: gdriveFolderId,
        printJpg,
        animatedGif,
        shots: Array.isArray(shots) ? shots : [],
      }),
      redirect: 'follow',
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {}

    if (parsed && parsed.success) {
      return {
        synced: true,
        method: 'apps_script_webhook',
        dailyFolderUrl: parsed.dailyFolderUrl || `https://drive.google.com/drive/folders/${gdriveFolderId}`,
        jpgUrl: parsed.jpgUrl || null,
        gifUrl: parsed.gifUrl || null,
        error: null,
      };
    }

    return {
      synced: false,
      method: 'apps_script_webhook',
      error: (parsed && parsed.error) || `Webhook HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      synced: false,
      method: 'apps_script_webhook',
      error: err.message,
    };
  }
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

        // 3. Upload framed JPG, GIF, and individual shots to Google Drive (daily subfolder)
        const googleDriveResult = await uploadOrderToGoogleDrive({
          orderId,
          dateFolder,
          gdriveFolderId,
          printJpg,
          animatedGif,
          shots: data.shots,
          gdriveWebhookUrl: data.gdriveWebhookUrl,
        }, env);

        return jsonResponse({
          success: true,
          orderId,
          dateFolder,
          timestamp,
          storage: {
            d1_database: d1Saved,
            kv_storage: kvSaved,
            d1_error: d1Error,
            google_drive: googleDriveResult,
            status: (d1Saved || kvSaved) ? 'Saved to Cloudflare Cloud' : 'Waiting for D1 Binding (DB)',
          },
          message: googleDriveResult.synced
            ? '✓ บันทึกออเดอร์ลง Cloudflare และอัปโหลดเข้า Google Drive เรียบร้อย'
            : '✓ บันทึกออเดอร์ลง Cloudflare สำเร็จ (รอตั้งค่า Google Drive Sync)',
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
      const savedWebhook = await getD1Setting(env.DB, 'gdrive_webhook_url');
      const status = {
        status: 'online',
        platform: 'Cloudflare Workers + Static Assets & D1',
        d1_database_connected: false,
        d1_database_id: '51ad5752-04ac-4f8d-803a-2a4d48ee7853',
        total_orders: 0,
        today_orders: 0,
        latest_order: null,
        gdrive_target_folder: '1giOkC-Y37veBgt4AshEYiatunVuzEtw2',
        gdrive_webhook_configured: Boolean(env.GDRIVE_WEBHOOK_URL || savedWebhook),
        gdrive_oauth_configured: Boolean(env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN),
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

    // ================= API ROUTE 4B: GET/POST /api/gdrive_settings =================
    if (pathname === '/api/gdrive_settings' && request.method === 'GET') {
      const storedWebhook = await getD1Setting(env.DB, 'gdrive_webhook_url');
      return jsonResponse({
        success: true,
        gdriveFolderId: '1giOkC-Y37veBgt4AshEYiatunVuzEtw2',
        gdriveWebhookUrl: storedWebhook || '',
        hasEnvWebhook: Boolean(env.GDRIVE_WEBHOOK_URL),
        hasOAuthEnv: Boolean(env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN),
      });
    }

    if (pathname === '/api/gdrive_settings' && request.method === 'POST') {
      try {
        const body = await request.json();
        const webhookUrl = String(body.gdriveWebhookUrl || '').trim();
        if (webhookUrl && !webhookUrl.startsWith('https://')) {
          return jsonResponse({ success: false, error: 'Webhook URL ต้องขึ้นต้นด้วย https://' }, 400);
        }
        await setD1Setting(env.DB, 'gdrive_webhook_url', webhookUrl);

        let pingResult = null;
        if (webhookUrl && body.testPing) {
          try {
            const pingRes = await fetch(webhookUrl, { method: 'GET', redirect: 'follow' });
            const pingText = await pingRes.text();
            pingResult = JSON.parse(pingText);
          } catch (e) {
            pingResult = { status: 'error', error: e.message };
          }
        }

        return jsonResponse({
          success: true,
          gdriveWebhookUrl: webhookUrl,
          pingResult,
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 400);
      }
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

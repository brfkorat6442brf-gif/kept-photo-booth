#!/usr/bin/env python3
import http.server
import ssl
import socket
import os
import sys
import json
import threading
import time
import base64
import urllib.parse
import urllib.request
import glob

GDRIVE_SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saved_orders', 'gdrive_settings.json')

def load_local_gdrive_webhook():
    env_url = os.environ.get('GDRIVE_WEBHOOK_URL', '').strip()
    if env_url:
        return env_url
    try:
        if os.path.exists(GDRIVE_SETTINGS_FILE):
            with open(GDRIVE_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return (json.load(f).get('gdriveWebhookUrl') or '').strip()
    except Exception:
        pass
    return ''

def save_local_gdrive_webhook(url_val):
    os.makedirs(os.path.dirname(GDRIVE_SETTINGS_FILE), exist_ok=True)
    with open(GDRIVE_SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump({'gdriveWebhookUrl': (url_val or '').strip()}, f, indent=2)

def forward_to_gdrive_webhook(webhook_url, payload):
    if not webhook_url:
        return {'synced': False, 'method': 'unconfigured', 'error': 'ยังไม่ได้ตั้งค่า Google Apps Script Web App URL'}
    try:
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'text/plain;charset=utf-8'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            parsed = json.loads(raw)
            if parsed.get('success'):
                return {
                    'synced': True,
                    'method': 'apps_script_webhook',
                    'dailyFolderUrl': parsed.get('dailyFolderUrl'),
                    'jpgUrl': parsed.get('jpgUrl'),
                    'gifUrl': parsed.get('gifUrl'),
                    'error': None
                }
            return {'synced': False, 'method': 'apps_script_webhook', 'error': parsed.get('error', 'Unknown error')}
    except Exception as err:
        return {'synced': False, 'method': 'apps_script_webhook', 'error': str(err)}

PORT_HTTPS = 8443
PORT_HTTP = 8080

def get_ip():
    for iface in ['en0', 'en1', 'en2', 'en5', 'bridge0']:
        try:
            res = os.popen(f"ipconfig getifaddr {iface} 2>/dev/null").read().strip()
            if res and not res.startswith("127."):
                return res
        except Exception:
            pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "192.168.1.42"

# Shared memory for wireless phone camera stream
latest_remote_frame = None
latest_frame_time = 0

# In-memory orders cache
orders_cache = {}

class KeptServerHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mobileconfig': 'application/x-apple-aspen-config',
        '.ipa': 'application/octet-stream',
        '.json': 'application/json',
        '.gif': 'image/gif',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
    }

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        if self.path in ['/api/export_app_zip', '/Kept_PhotoBooth.mobileconfig', '/api/status']:
            self.send_response(200)
            if self.path.endswith('.zip'):
                self.send_header('Content-Type', 'application/zip')
            elif self.path.endswith('.mobileconfig'):
                self.send_header('Content-Type', 'application/x-apple-aspen-config')
            else:
                self.send_header('Content-Type', 'application/json')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_POST(self):
        global latest_remote_frame, latest_frame_time
        if self.path == '/api/upload_remote_frame':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                latest_remote_frame = data.get('image', None)
                latest_frame_time = time.time()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"invalid_json"}')
        elif self.path == '/api/save_order':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                order_id = data.get('orderId', f"KP-BKK-{int(time.time())}")
                gdrive_folder = data.get('gdriveFolderId', '1giOkC-Y37veBgt4AshEYiatunVuzEtw2')
                date_folder = data.get('dateFolder') or time.strftime("%Y-%m-%d")
                
                # Save to disk under saved_orders/<date_folder>/<order_id>/ and root saved_orders/<order_id>/
                base_dir = os.path.dirname(__file__)
                daily_dir = os.path.join(base_dir, 'saved_orders', date_folder, order_id)
                legacy_dir = os.path.join(base_dir, 'saved_orders', order_id)
                os.makedirs(daily_dir, exist_ok=True)
                os.makedirs(legacy_dir, exist_ok=True)
                
                # 1. Save high-resolution printable slip (.JPG)
                if data.get('printJpg'):
                    try:
                        jpg_raw = data['printJpg'].split('base64,')[-1]
                        jpg_bytes = base64.b64decode(jpg_raw)
                        with open(os.path.join(daily_dir, 'print.jpg'), 'wb') as f:
                            f.write(jpg_bytes)
                        with open(os.path.join(legacy_dir, 'print.jpg'), 'wb') as f:
                            f.write(jpg_bytes)
                    except Exception as err:
                        print(f"Error saving print.jpg: {err}")

                # 2. Save animated Boomerang loop (.GIF)
                if data.get('animatedGif'):
                    try:
                        gif_raw = data['animatedGif'].split('base64,')[-1]
                        gif_bytes = base64.b64decode(gif_raw)
                        with open(os.path.join(daily_dir, 'animated.gif'), 'wb') as f:
                            f.write(gif_bytes)
                        with open(os.path.join(legacy_dir, 'animated.gif'), 'wb') as f:
                            f.write(gif_bytes)
                    except Exception as err:
                        print(f"Error saving animated.gif: {err}")

                # 3. Save individual photo shots (.JPG)
                if data.get('shots'):
                    for idx, s_b64 in enumerate(data['shots']):
                        try:
                            s_raw = s_b64.split('base64,')[-1]
                            s_bytes = base64.b64decode(s_raw)
                            with open(os.path.join(daily_dir, f'shot_{idx+1}.jpg'), 'wb') as f:
                                f.write(s_bytes)
                            with open(os.path.join(legacy_dir, f'shot_{idx+1}.jpg'), 'wb') as f:
                                f.write(s_bytes)
                        except Exception as err:
                            print(f"Error saving shot_{idx+1}.jpg: {err}")

                # 4. Save metadata JSON and Google Drive export registry
                meta = {
                    "orderId": order_id,
                    "dateFolder": date_folder,
                    "frameName": data.get('frameName', 'Framed Photo'),
                    "frameLayout": data.get('frameLayout', 'newspaper'),
                    "timestamp": data.get('timestamp', time.strftime("%Y-%m-%d %H:%M:%S")),
                    "gdriveFolderId": gdrive_folder,
                    "gdriveDailyFolder": date_folder,
                    "gdriveUrl": f"https://drive.google.com/drive/folders/{gdrive_folder}?usp=sharing",
                    "status": "synced_to_drive",
                    "files": {
                        "printJpg": f"/saved_orders/{date_folder}/{order_id}/print.jpg",
                        "animatedGif": f"/saved_orders/{date_folder}/{order_id}/animated.gif"
                    }
                }
                with open(os.path.join(daily_dir, 'meta.json'), 'w') as f:
                    json.dump(meta, f, indent=2)
                with open(os.path.join(legacy_dir, 'meta.json'), 'w') as f:
                    json.dump(meta, f, indent=2)

                orders_cache[order_id] = {
                    **meta,
                    "frameName": data.get('frameName', 'Framed Photo'),
                    "frameLayout": data.get('frameLayout', 'newspaper'),
                    "printJpg": data.get('printJpg'),
                    "animatedGif": data.get('animatedGif'),
                    "shots": data.get('shots', [])
                }

                print(f"✓ Saved Order #{order_id} (Daily: {date_folder}) | Local Backup [{gdrive_folder}]")

                webhook_url = (data.get('gdriveWebhookUrl') or load_local_gdrive_webhook() or '').strip()
                gdrive_result = forward_to_gdrive_webhook(webhook_url, {
                    "orderId": order_id,
                    "dateFolder": date_folder,
                    "folderId": gdrive_folder,
                    "printJpg": data.get('printJpg', ''),
                    "animatedGif": data.get('animatedGif', ''),
                    "shots": data.get('shots', [])
                })

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                resp = json.dumps({
                    "status": "ok",
                    "orderId": order_id,
                    "dateFolder": date_folder,
                    "gdriveFolderId": gdrive_folder,
                    "downloadUrl": f"/download.html?order={order_id}",
                    "storage": {
                        "local_disk": True,
                        "google_drive": gdrive_result
                    }
                })
                self.wfile.write(resp.encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/gdrive_settings':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8'))
                webhook_url = (body.get('gdriveWebhookUrl') or '').strip()
                if webhook_url and not webhook_url.startswith('https://'):
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Webhook URL ต้องขึ้นต้นด้วย https://"}).encode('utf-8'))
                    return
                save_local_gdrive_webhook(webhook_url)
                ping_result = None
                if webhook_url and body.get('testPing'):
                    try:
                        with urllib.request.urlopen(webhook_url, timeout=10) as r:
                            ping_result = json.loads(r.read().decode('utf-8', errors='replace'))
                    except Exception as pe:
                        ping_result = {"status": "error", "error": str(pe)}
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "gdriveWebhookUrl": webhook_url,
                    "pingResult": ping_result
                }).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        else:
            super().do_POST()

    def do_GET(self):
        global latest_remote_frame, latest_frame_time
        if self.path == '/api/get_remote_frame':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            is_active = (time.time() - latest_frame_time < 3.0) and (latest_remote_frame is not None)
            resp = json.dumps({
                "image": latest_remote_frame if is_active else None,
                "active": is_active,
                "timestamp": latest_frame_time
            })
            self.wfile.write(resp.encode('utf-8'))
        elif self.path.startswith('/api/get_order'):
            query = self.path.split('?')[-1]
            params = dict(urllib.parse.parse_qsl(query))
            order_id = params.get('order', '')
            order_data = orders_cache.get(order_id)
            if not order_data:
                # Search both legacy and date-separated folders
                meta_matches = glob.glob(os.path.join(os.path.dirname(__file__), 'saved_orders', '**', order_id, 'meta.json'), recursive=True)
                if meta_matches:
                    try:
                        with open(meta_matches[0], 'r') as f:
                            order_data = json.load(f)
                    except Exception:
                        pass

            if order_data:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(order_data).encode('utf-8'))
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error":"not_found"}')
        elif self.path == '/api/gdrive_settings':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": True,
                "gdriveFolderId": "1giOkC-Y37veBgt4AshEYiatunVuzEtw2",
                "gdriveWebhookUrl": load_local_gdrive_webhook(),
                "hasEnvWebhook": bool(os.environ.get('GDRIVE_WEBHOOK_URL', '').strip()),
                "hasOAuthEnv": False
            }).encode('utf-8'))
        elif self.path == '/api/status':
            my_ip = get_ip()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            is_active = (time.time() - latest_frame_time < 3.0) and (latest_remote_frame is not None)
            resp = json.dumps({
                "status": "online",
                "ip": my_ip,
                "port_https": PORT_HTTPS,
                "port_http": PORT_HTTP,
                "remote_camera_active": is_active,
                "gdrive_folder": "1giOkC-Y37veBgt4AshEYiatunVuzEtw2",
                "current_daily_folder": time.strftime("%Y-%m-%d")
            })
            self.wfile.write(resp.encode('utf-8'))
        elif self.path == '/Kept_PhotoBooth.mobileconfig':
            my_ip = get_ip()
            config_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>FullScreen</key>
			<true/>
			<key>IsRemovable</key>
			<true/>
			<key>Label</key>
			<string>Kept Booth</string>
			<key>PayloadDescription</key>
			<string>Kept Receipt &amp; Newspaper Photo Booth Application for iPad</string>
			<key>PayloadDisplayName</key>
			<string>Kept Photo Booth</string>
			<key>PayloadIdentifier</key>
			<string>com.kept.photobooth.webclip</string>
			<key>PayloadType</key>
			<string>com.apple.webClip.managed</string>
			<key>PayloadUUID</key>
			<string>B41CE91E-87CB-47A2-8BD5-CF8ACC68DFDF</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>Precomposed</key>
			<true/>
			<key>URL</key>
			<string>https://{my_ip}:8443/index.html</string>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>โปรไฟล์ติดตั้งแอป Kept Photo Booth บน iPad แบบเต็มหน้าจอ (Kiosk Fullscreen)</string>
	<key>PayloadDisplayName</key>
	<string>Kept Photo Booth Installer (iPad)</string>
	<key>PayloadIdentifier</key>
	<string>com.kept.photobooth.installer</string>
	<key>PayloadOrganization</key>
	<string>Kept Photo Booth Studio</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>76D3A0A2-99B1-4A56-A4F7-1C5D0B2E8F9A</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>"""
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-apple-aspen-config')
            self.send_header('Content-Disposition', 'attachment; filename="Kept_PhotoBooth.mobileconfig"')
            self.end_headers()
            self.wfile.write(config_xml.encode('utf-8'))
        elif self.path == '/api/export_app_zip':
            import zipfile, io
            base_dir = os.path.dirname(__file__)
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                for root, dirs, files in os.walk(base_dir):
                    if 'saved_orders' in root or '.git' in root or '__pycache__' in root:
                        continue
                    for file in files:
                        if file.endswith(('.html', '.js', '.css', '.json', '.mobileconfig', '.pem', '.py', '.png', '.jpg', '.svg', '.md', '.ipa', '.sh')):
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, base_dir)
                            zip_file.write(file_path, arcname)
            zip_buffer.seek(0)
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="Kept_PhotoBooth_App.zip"')
            self.end_headers()
            self.wfile.write(zip_buffer.getvalue())
        else:
            super().do_GET()

def start_http_worker(my_ip):
    try:
        httpd_insecure = http.server.ThreadingHTTPServer(('0.0.0.0', PORT_HTTP), KeptServerHandler)
        httpd_insecure.serve_forever()
    except Exception as e:
        print(f"Notice: HTTP server on port {PORT_HTTP} could not start ({e}). HTTPS is active.")

def run_servers():
    my_ip = get_ip()
    
    # Launch HTTP port 8080 in background thread
    t_http = threading.Thread(target=start_http_worker, args=(my_ip,), daemon=True)
    t_http.start()

    # Launch HTTPS port 8443
    server_address = ('0.0.0.0', PORT_HTTPS)
    httpd = http.server.ThreadingHTTPServer(server_address, KeptServerHandler)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    cert_file = os.path.join(os.path.dirname(__file__), 'cert.pem')
    key_file = os.path.join(os.path.dirname(__file__), 'key.pem')
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print("=" * 65)
    print("📸 KEPT PHOTO BOOTH • SERVER ACTIVE (WITH GOOGLE DRIVE & GIF EXPORT)")
    print("=" * 65)
    print(f"📍 IP ปัจจุบัน: {my_ip}")
    print(f"👉 ตู้ Photo Booth บน iPad (Safari):")
    print(f"   🔗 https://{my_ip}:{PORT_HTTPS}/index.html")
    print("")
    print(f"📱 หน้าสแกนดาวน์โหลดไฟล์ภาพ .JPG และ .GIF สำหรับลูกค้า:")
    print(f"   🔗 https://{my_ip}:{PORT_HTTPS}/download.html")
    print("")
    print(f"☁️ Google Drive โฟลเดอร์สำรองข้อมูล (แยกรายวันอัตโนมัติ):")
    print(f"   🔗 https://drive.google.com/drive/folders/1giOkC-Y37veBgt4AshEYiatunVuzEtw2")
    print("=" * 65)
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Kept server...")
        httpd.server_close()

if __name__ == '__main__':
    run_servers()

# ☁️ คู่มือการนำ Kept Photo Booth ขึ้น Cloudflare Hosting & เชื่อมต่อ Database D1

ระบบ **Kept Photo Booth** ได้รับการจัดเตรียมโครงสร้างสำหรับ **Cloudflare Pages** และ **Cloudflare D1 Database** เรียบร้อยแล้ว พร้อม Edge API Serverless ในตัวโฟลเดอร์ `functions/api/`

---

## 🏗️ โครงสร้างระบบบน Cloudflare

```
📁 app photo Booth/
├── 📄 index.html             # หน้าตู้ถ่ายรูป Photo Booth (Frontend)
├── 📄 download.html          # หน้าดาวน์โหลดรูปภาพและ GIF สำหรับลูกค้า
├── 📄 qrcode.min.js          # ระบบสร้าง QR Code แบบ Offline/Edge
├── 📄 gif_encoder.js         # เอนจินสร้างภาพขยับ GIF ความเร็วสูงในตัว
├── 📄 schema.sql             # SQL Schema สำหรับฐานข้อมูล Cloudflare D1
├── 📄 wrangler.toml          # ไฟล์คอนฟิก Cloudflare Pages & D1
├── 📄 _headers               # คอนฟิกแคชและความปลอดภัยของ Cloudflare
└── 📁 functions/api/         # Serverless Edge APIs
    ├── ⚡ save_order.js      # API บันทึกออเดอร์ลง Cloudflare D1 & KV
    ├── ⚡ get_order.js       # API ดึงรูปถ่ายและ GIF เพื่อสแกนดาวน์โหลด
    ├── ⚡ frames.js          # API จัดการกรอบรูป (Newspaper, Slip, Strip)
    └── ⚡ sync_stats.js      # API ตรวจสอบสถานะฐานข้อมูลและยอดถ่ายประจำวัน
```

---

## 🚀 วิธีที่ 1: Deploy ผ่าน Cloudflare Dashboard (แนะนำ - สะดวกและฟรี 100%)

### ขั้นตอนที่ 1: สร้างฐานข้อมูล Cloudflare D1
1. เข้าไปที่ [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. ในแถบเมนูด้านซ้าย เลือก **Storage & Databases** > **D1 SQL Database**
3. คลิกปุ่ม **Create database**
4. ตั้งชื่อฐานข้อมูล: `kept_photobooth_db` แล้วกด **Create**
5. คลิกเข้าไปที่ฐานข้อมูลที่เพิ่งสร้าง > เลือกแท็บ **Console**
6. เปิดไฟล์ [`schema.sql`](file:///Users/admin/Documents/app%20photo%20Booth/schema.sql) ในโปรเจกต์นี้ คัดลอกคำสั่ง SQL ทั้งหมดไปวางในช่อง Console แล้วกด **Execute**
   *(ระบบจะสร้างตาราง `orders` และ `frames` พร้อมเพิ่มกรอบมาตรฐานให้ทันที)*

### ขั้นตอนที่ 2: อัปโหลด Web App ขึ้น Cloudflare Pages
1. ใน Cloudflare Dashboard เมนูด้านซ้าย เลือก **Compute (Workers) > Workers & Pages**
2. คลิกปุ่ม **Create** > เลือกแท็บ **Pages**
3. เลือกได้ 2 ช่องทาง:
   - **ทางเลือก A (Connect to Git)**: เชื่อมต่อ GitHub / GitLab แล้วเลือก Repository นี้
   - **ทางเลือก B (Direct Upload)**: ลากโฟลเดอร์โปรเจกต์ขึ้น Cloudflare Pages ได้โดยตรง
4. การตั้งค่า Build Settings:
   - **Framework preset**: `None`
   - **Build command**: (เว้นว่างไว้ ไม่ต้องกรอก)
   - **Build output directory**: `.` (จุดเดียว หรือเว้นว่าง)
5. คลิก **Save and Deploy** รอเพียง 10-20 วินาที จะได้รับ URL สด เช่น `https://kept-photo-booth.pages.dev`

### ขั้นตอนที่ 3: ผูกฐานข้อมูล D1 เข้ากับ Pages (Database Binding)
1. ในหน้าโปรเจกต์ Pages บน Cloudflare ไปที่แท็บ **Settings** > เมนูด้านซ้ายเลือก **Functions**
2. เลื่อนลงมาที่หัวข้อ **D1 Database Bindings** > คลิก **Add binding**
3. กำหนดค่า:
   - **Variable name**: `DB`  *(ต้องใช้ตัวพิมพ์ใหญ่ DB ตรงตามโค้ด)*
   - **D1 database**: เลือก `kept_photobooth_db`
4. กด **Save** แล้วทำการ **Redeploy** หนึ่งครั้ง
5. **เสร็จสิ้น!** เว็บแอปพลิเคชันจะเชื่อมต่อฐานข้อมูล Cloudflare D1 สมบูรณ์แบบ

---

## ⚡ วิธีที่ 2: Deploy ด้วยคำสั่ง Wrangler CLI ผ่าน Terminal

หากเครื่องมี Node.js / Wrangler สามารถเปิด Terminal แล้วรันคำสั่งตามลำดับนี้ได้ทันที:

```bash
# 1. เข้าสู่ระบบ Cloudflare
npx wrangler login

# 2. สร้างฐานข้อมูล D1
npx wrangler d1 create kept_photobooth_db

# 3. รัน Schema สร้างตารางใน D1 (ใส่ชื่อฐานข้อมูลตามที่สร้าง)
npx wrangler d1 execute kept_photobooth_db --file=schema.sql --remote

# 4. Deploy หน้าเว็บและ Functions ขึ้น Cloudflare Pages
npx wrangler pages deploy . --project-name kept-photo-booth
```

---

## 🔍 การทดสอบระบบหลังขึ้น Cloudflare

1. **เปิดหน้าตู้ถ่ายรูป**: `https://<your-project>.pages.dev/`
2. **ถ่ายภาพและพิมพ์ใบเสร็จ**: เมื่อกดบันทึก ข้อมูลจะถูกส่งไปที่ `/api/save_order` และบันทึกลง **Cloudflare D1 Database** ทันที
3. **ตรวจสอบสแกนดาวน์โหลด**: ใช้โทรศัพท์สแกน QR Code หน้าตู้ หรือเปิด `https://<your-project>.pages.dev/download.html?order=KP-BKK-xxxx`
4. **ตรวจสอบสถานะ API & Database**: เปิดดูที่ `https://<your-project>.pages.dev/api/sync_stats` จะแสดงจำนวนออเดอร์ในฐานข้อมูลแบบ Realtime

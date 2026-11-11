#!/usr/bin/env python3
"""
Cloudflare Pages & D1 Database Deployment Helper for Kept Photo Booth
"""

import os
import sys
import json
import urllib.request
import urllib.error

CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"

def print_banner():
    print("=" * 65)
    print("☁️  KEPT PHOTO BOOTH • CLOUDFLARE HOSTING & DATABASE SETUP")
    print("=" * 65)
    print("1. Cloudflare Pages : โฮสติ้งความเร็วสูงระดับโลก (CDN ฟรี + SSL อัตโนมัติ)")
    print("2. Cloudflare D1    : ฐานข้อมูล SQL Serverless เก็บออเดอร์และรูปถ่าย")
    print("3. Cloudflare Funcs : Edge API (/api/save_order, /api/get_order)")
    print("=" * 65)

def main():
    print_banner()

    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()

    if not api_token or not account_id:
        print("\n📌 ยังไม่พบตัวแปรสภาพแวดล้อม CLOUDFLARE_API_TOKEN และ CLOUDFLARE_ACCOUNT_ID")
        print("\nมี 2 วิธีหลักในการนำเว็บขึ้น Cloudflare อย่างง่ายดาย:\n")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("วิธีที่ 1: ติดตั้งผ่าน Cloudflare Pages Dashboard (ง่ายที่สุด - ฟรี 100%)")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("1. เข้าสู่ระบบ https://dash.cloudflare.com/")
        print("2. ไปที่เมนู 'Workers & Pages' > 'Create' > แท็บ 'Pages'")
        print("3. เลือก 'Connect to Git' (เชื่อมต่อกับ GitHub หรือ GitLab)")
        print("4. เลือก Repository ของโปรเจกต์นี้")
        print("5. การตั้งค่า Build:")
        print("   - Framework preset: None")
        print("   - Build command: (เว้นว่างไว้)")
        print("   - Build output directory: .")
        print("6. เชื่อมต่อ Cloudflare D1 Database:")
        print("   - ไปที่ Cloudflare Dashboard > Workers & Pages > D1")
        print("   - กด 'Create Database' ตั้งชื่อ: kept_photobooth_db")
        print("   - ในแท็บ 'Console' ให้คัดลอกคำสั่งจากไฟล์ schema.sql ไปรันเพื่อสร้างตาราง")
        print("   - จากนั้นกลับไปที่โปรเจกต์ Pages > Settings > Functions > D1 Database Bindings")
        print("   - เพิ่ม Variable name: DB  (เลือกฐานข้อมูล: kept_photobooth_db)")
        print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("วิธีที่ 2: ใช้คำสั่ง Wrangler CLI บน Terminal")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("1. สร้างฐานข้อมูล D1:")
        print("   npx wrangler d1 create kept_photobooth_db")
        print("2. รันคำสั่งสร้างตารางใน D1:")
        print("   npx wrangler d1 execute kept_photobooth_db --file=schema.sql --remote")
        print("3. อัปโหลดเว็บขึ้น Cloudflare Pages ทันที:")
        print("   npx wrangler pages deploy . --project-name kept-photo-booth")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
        return

    # If credentials are provided via environment variables, verify via API
    print(f"\n🔑 ตรวจสอบสิทธิ์ Cloudflare Account: {account_id[:6]}...{account_id[-4:]}")
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }

    try:
        req = urllib.request.Request(f"{CLOUDFLARE_API}/accounts/{account_id}", headers=headers)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            if data.get("success"):
                acc_name = data.get("result", {}).get("name", "Cloudflare Account")
                print(f"✓ ยืนยันสิทธิ์สำเร็จ: {acc_name}")
    except Exception as e:
        print(f"⚠️ ตรวจสอบสิทธิ์ล้มเหลว: {e}")

if __name__ == "__main__":
    main()

#!/bin/bash
set -e

# ==============================================================================
# Script: Build Universal Native macOS App & DMG Installer for Kept Photo Booth
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

APP_NAME="Kept Photo Booth"
BUNDLE_DIR="$PROJECT_DIR/$APP_NAME.app"
STAGING_DIR="$PROJECT_DIR/dmg_staging"
OUTPUT_DMG="$PROJECT_DIR/KeptPhotoBooth.dmg"

echo "=========================================================="
echo "📸 BUILDING KEPT PHOTO BOOTH NATIVE APPLICATION & .DMG"
echo "=========================================================="

# 1. Compile Universal Binary (x86_64 + Apple Silicon arm64)
echo "⚙️  กำลังคอมไพล์ Native Mach-O Universal Binary (Intel + Apple Silicon)..."
clang -O2 -arch x86_64 -arch arm64 \
  -framework Cocoa -framework WebKit -framework Security \
  main.m -o KeptPhotoBooth

# 2. Build App Bundle Structure
echo "📦 กำลังสร้างโครงสร้าง macOS Application Bundle (.app)..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources/web"

mv KeptPhotoBooth "$BUNDLE_DIR/Contents/MacOS/"
cp Info.plist "$BUNDLE_DIR/Contents/"
echo "APPLKPBT" > "$BUNDLE_DIR/Contents/PkgInfo"

# Copy Icon
if [ -f "AppIcon.icns" ]; then
  cp AppIcon.icns "$BUNDLE_DIR/Contents/Resources/"
fi

# Copy Web Assets and Server into App Bundle
echo "📂 กำลังคัดลอก Web Assets และ Local Server เข้าตัวแอป..."
cp index.html "$BUNDLE_DIR/Contents/Resources/web/"
cp prototype.html "$BUNDLE_DIR/Contents/Resources/web/"
cp download.html "$BUNDLE_DIR/Contents/Resources/web/"
cp qrcode.min.js "$BUNDLE_DIR/Contents/Resources/web/"
cp gif_encoder.js "$BUNDLE_DIR/Contents/Resources/web/"
cp manifest.json "$BUNDLE_DIR/Contents/Resources/web/"
cp sw.js "$BUNDLE_DIR/Contents/Resources/web/"
cp server_https.py "$BUNDLE_DIR/Contents/Resources/web/"
cp cert.pem "$BUNDLE_DIR/Contents/Resources/web/"
cp key.pem "$BUNDLE_DIR/Contents/Resources/web/"

# 3. Strip extended attributes and Ad-hoc Code Sign
echo "🔐 ทำการ Code-sign แอปพลิเคชัน (Ad-hoc Signature)..."
xattr -cr "$BUNDLE_DIR"
codesign --force --deep --sign - --timestamp=none "$BUNDLE_DIR"

# 4. Prepare DMG Staging Folder
echo "💿 จัดเตรียมโฟลเดอร์สำหรับทำไฟล์ติดตั้ง .DMG..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

cp -R "$BUNDLE_DIR" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

# Copy iOS Profiles & Readme to DMG for convenient cross-platform deployment
cp Kept_PhotoBooth.mobileconfig "$STAGING_DIR/"
if [ -f "KeptPhotoBooth.ipa" ]; then
  cp KeptPhotoBooth.ipa "$STAGING_DIR/"
fi

cat << 'EOF' > "$STAGING_DIR/คู่มือติดตั้งสำหรับ_Mac_และ_iPad.txt"
================================================================================
📸 KEPT PHOTO BOOTH • คู่มือการติดตั้งและใช้งาน (macOS & iOS/iPad)
================================================================================

1. การติดตั้งบนเครื่อง Mac (macOS):
   - ลากไอคอน "Kept Photo Booth.app" ไปวางในโฟลเดอร์ "Applications"
   - ดับเบิ้ลคลิกเปิดแอป "Kept Photo Booth" จากโฟลเดอร์ Applications หรือ Launchpad
   - คีย์ลัดในตัวแอป:
     * Cmd + F หรือ F11 : สลับเข้า/ออกโหมดเต็มหน้าจอ Kiosk (Full Screen)
     * Cmd + R : รีเฟรชหน้าจอโฟโต้บูธ
     * Cmd + Q : ออกจากโปรแกรม

2. การติดตั้งบน iPad / iPhone (ระบบ iOS / iPadOS):
   *หมายเหตุ: ไฟล์ .dmg เป็นไฟล์ติดตั้งสำหรับเครื่อง Mac
   ส่วนบน iPad/iOS สามารถติดตั้งเป็นแอปตู้ถ่ายรูปได้ง่ายๆ 2 วิธี:*

   วิธีที่ A (แนะนำ - เร็วที่สุด 5 วินาที):
   - เปิด Safari บน iPad แล้วไปที่: https://kept-photo-booth.brfkorat6442brf.workers.dev/
   - แตะปุ่มแชร์ (สัญลักษณ์ลูกศรชี้ขึ้น)
   - แตะเลือก "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)
   - จะได้ไอคอนแอป Kept Booth บนหน้าจอ iPad ทำงานแบบเต็มจอ Kiosk ไร้แถบเบราว์เซอร์

   วิธีที่ B (ใช้ไฟล์ Configuration Profile):
   - ส่งไฟล์ "Kept_PhotoBooth.mobileconfig" ไปที่ iPad ผ่าน AirDrop
   - แตะ "ติดตั้ง (Install)" ในการตั้งค่า iPad (General > VPN & Device Management)
   - จะได้ไอคอนแอป Kiosk บนหน้าจอ iPad ทันที

3. โฟลเดอร์สำรองข้อมูล Google Drive อัตโนมัติ:
   - https://drive.google.com/drive/folders/1giOkC-Y37veBgt4AshEYiatunVuzEtw2
================================================================================
EOF

# 5. Build .DMG with hdiutil
echo "🚀 กำลังสร้างไฟล์อิมเมจ .DMG (UDZO Compressed)..."
rm -f "$OUTPUT_DMG"
hdiutil create -volname "Kept Photo Booth" \
  -srcfolder "$STAGING_DIR" \
  -ov -format UDZO "$OUTPUT_DMG"

rm -rf "$STAGING_DIR"

echo "=========================================================="
echo "✅ สร้างไฟล์ติดตั้งสำเร็จเรียบร้อย!"
echo "📍 ตำแหน่งไฟล์: $OUTPUT_DMG"
ls -lh "$OUTPUT_DMG"
echo "=========================================================="

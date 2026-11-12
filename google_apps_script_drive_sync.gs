/**
 * KEPT PHOTO BOOTH — Google Drive Auto-Sync Web App (Google Apps Script)
 * ----------------------------------------------------------------------
 * วิธีติดตั้ง (ทำครั้งเดียว ใช้เวลา 1 นาที):
 * 1. เปิด https://script.google.com แล้วกด "New project" (โปรเจกต์ใหม่)
 * 2. ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดไฟล์นี้ลงไปทั้งหมด จากนั้นกด Save
 * 3. กด "Deploy" -> "New deployment" -> เลือก Type: "Web app"
 *    - Execute as: "Me" (บัญชีเจ้าของ Google Drive)
 *    - Who has access: "Anyone"
 * 4. กด Deploy -> Allow access (อนุญาตสิทธิ์เข้าถึง Google Drive)
 * 5. คัดลอก "Web app URL" (ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 *    ไปวางในหน้า Admin Settings -> Google Drive ของแอป KEPT Photo Booth
 */

const DEFAULT_ROOT_FOLDER_ID = '1giOkC-Y37veBgt4AshEYiatunVuzEtw2';

function getOrCreateDailyFolder(parentFolderId, dateFolderName) {
  const root = DriveApp.getFolderById(parentFolderId || DEFAULT_ROOT_FOLDER_ID);
  const existing = root.getFoldersByName(dateFolderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  return root.createFolder(dateFolderName);
}

function saveBase64File(folder, filename, dataUrlOrBase64, defaultMime) {
  if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== 'string') return null;

  let mimeType = defaultMime || 'application/octet-stream';
  let base64Data = dataUrlOrBase64.trim();

  const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    mimeType = match[1];
    base64Data = match[2];
  }

  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, filename);

  // Replace existing file with same filename inside daily folder to avoid duplicates
  const existingFiles = folder.getFilesByName(filename);
  while (existingFiles.hasNext()) {
    existingFiles.next().setTrashed(true);
  }

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    const orderId = String(data.orderId || ('KP-' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '');
    const now = new Date();
    const fallbackDate = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
    const dateFolderName = String(data.dateFolder || fallbackDate).replace(/[^0-9-]/g, '') || fallbackDate;
    const targetRootId = data.folderId || DEFAULT_ROOT_FOLDER_ID;

    const dailyFolder = getOrCreateDailyFolder(targetRootId, dateFolderName);
    const results = {
      success: true,
      orderId: orderId,
      dateFolder: dateFolderName,
      dailyFolderUrl: dailyFolder.getUrl(),
      jpgUrl: null,
      gifUrl: null,
      shotsUrls: []
    };

    if (data.printJpg) {
      results.jpgUrl = saveBase64File(dailyFolder, 'Kept_' + orderId + '_Framed.jpg', data.printJpg, 'image/jpeg');
    }

    if (data.animatedGif) {
      results.gifUrl = saveBase64File(dailyFolder, 'Kept_' + orderId + '_Framed.gif', data.animatedGif, 'image/gif');
    }

    if (Array.isArray(data.shots)) {
      data.shots.forEach(function (shotData, idx) {
        if (shotData) {
          const shotUrl = saveBase64File(
            dailyFolder,
            'Kept_' + orderId + '_Shot_' + (idx + 1) + '.jpg',
            shotData,
            'image/jpeg'
          );
          if (shotUrl) results.shotsUrls.push(shotUrl);
        }
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify(results))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err && err.message ? err.message : String(err)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'online',
      service: 'KEPT Photo Booth Google Drive Sync',
      targetRootFolderId: DEFAULT_ROOT_FOLDER_ID
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

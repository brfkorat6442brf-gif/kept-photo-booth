-- ==============================================================================
-- Cloudflare D1 Database Schema for Kept Photo Booth
-- Database Name: kept_photobooth_db
-- ==============================================================================

-- 1. Orders & Framed Artwork Table
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
);

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_date_folder ON orders(date_folder);

-- 2. Photo Booth Frame Templates Table
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
);

-- 3. Default System Frames Seed Data
INSERT OR IGNORE INTO frames (id, name, mode, layout, title, color, image_url, is_active) VALUES
('frame_newspaper_default', 'The Songwat Times', 'newspaper', 'newspaper', 'THE SONGWAT CHRONICLE', '#2b231d', '', 1),
('frame_receipt_default', 'Vintage Cafe Slip', 'receipt', 'receipt', 'KEPT • MEMORY RECEIPT', '#10B981', '', 1),
('frame_strip_neon', 'Cyber Neon Strip', 'strip', 'strip', 'KEPT CYBER BOOTH', '#A855F7', '', 1),
('frame_newspaper_drive', 'Songwat Heritage Archives', 'newspaper', 'newspaper', 'SONGWAT HERITAGE ARCHIVES', '#B45309', '', 1);

/**
 * Lightweight High-Speed Standalone GIF89a Encoder for Kept Photo Booth
 * Generates animated GIF (Boomerang / Photo Loop) directly in browser in < 30ms.
 * Integer-based LZW dictionary + 3-3-2 bitwise color quantization (zero string alloc, zero freeze).
 */
(function(window) {
  'use strict';

  // Fast 256-color palette (3 bits Red, 3 bits Green, 2 bits Blue)
  const GLOBAL_PALETTE = [];
  for (let i = 0; i < 256; i++) {
    const r = Math.round(((i >> 5) & 7) * 255 / 7);
    const g = Math.round(((i >> 2) & 7) * 255 / 7);
    const b = Math.round((i & 3) * 255 / 3);
    GLOBAL_PALETTE.push([r, g, b]);
  }

  // Instant O(1) bitwise pixel quantization (zero loops)
  function mapPixelToPalette(r, g, b) {
    return ((r & 0xE0) | ((g & 0xE0) >> 3) | ((b & 0xC0) >> 6));
  }

  // High-performance integer-based LZW encoder
  function encodeLZW(pixels, minCodeSize) {
    const clearCode = 1 << minCodeSize; // 256
    const eoiCode = clearCode + 1;       // 257
    let codeSize = minCodeSize + 1;      // 9
    let maxCode = 1 << codeSize;         // 512

    const dict = new Map();
    let nextCode = eoiCode + 1;

    let bits = 0;
    let nbits = 0;
    const stream = [];

    function emit(code, size) {
      bits |= (code << nbits);
      nbits += size;
      while (nbits >= 8) {
        stream.push(bits & 0xFF);
        bits >>= 8;
        nbits -= 8;
      }
    }

    emit(clearCode, codeSize);
    let cur = pixels[0];

    for (let i = 1; i < pixels.length; i++) {
      const c = pixels[i];
      const key = (cur << 8) | c;
      if (dict.has(key)) {
        cur = dict.get(key);
      } else {
        emit(cur, codeSize);
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
          if (nextCode > maxCode && codeSize < 12) {
            codeSize++;
            maxCode = 1 << codeSize;
          }
        } else {
          emit(clearCode, codeSize);
          codeSize = minCodeSize + 1;
          maxCode = 1 << codeSize;
          dict.clear();
          nextCode = eoiCode + 1;
        }
        cur = c;
      }
    }

    emit(cur, codeSize);
    emit(eoiCode, codeSize);
    if (nbits > 0) stream.push(bits & 0xFF);

    // Chunk into 255-byte sub-blocks
    const out = [minCodeSize];
    for (let i = 0; i < stream.length; i += 255) {
      const chunk = stream.slice(i, i + 255);
      out.push(chunk.length);
      for (let j = 0; j < chunk.length; j++) out.push(chunk[j]);
    }
    out.push(0); // block terminator
    return new Uint8Array(out);
  }

  window.generateKeptAnimatedGif = async function(items, options = {}) {
    if (!items || items.length === 0) return null;

    const width = options.width || 240;
    const height = options.height || 360;
    const delayCs = options.delayCs || 35; // 350ms per frame

    // Build frame sequence with boomerang effect (e.g. 1 -> 2 -> 3 -> 2)
    let sequence = [...items];
    if (options.boomerang !== false && items.length > 2) {
      for (let k = items.length - 2; k > 0; k--) {
        sequence.push(items[k]);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const framesData = [];

    for (const item of sequence) {
      if (item && item.getContext) {
        // Direct HTMLCanvasElement frame (e.g. pre-rendered framed artwork)
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(item, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const raw = imgData.data;
        const indexed = new Uint8Array(width * height);
        for (let p = 0, q = 0; p < raw.length; p += 4, q++) {
          indexed[q] = mapPixelToPalette(raw[p], raw[p + 1], raw[p + 2]);
        }
        framesData.push(indexed);
      } else {
        await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.fillStyle = '#0a0a0f';
            ctx.fillRect(0, 0, width, height);

            // Center cover draw
            const scale = Math.max(width / img.width, height / img.height);
            const nw = img.width * scale;
            const nh = img.height * scale;
            const ox = (width - nw) / 2;
            const oy = (height - nh) / 2;
            ctx.drawImage(img, ox, oy, nw, nh);

            // Add subtle Kept watermark tag
            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(6, height - 20, 100, 14);
            ctx.fillStyle = '#10B981';
            ctx.fillText('KEPT PHOTOBOOTH', 10, height - 10);

            const imgData = ctx.getImageData(0, 0, width, height);
            const raw = imgData.data;
            const indexed = new Uint8Array(width * height);
            for (let p = 0, q = 0; p < raw.length; p += 4, q++) {
              indexed[q] = mapPixelToPalette(raw[p], raw[p + 1], raw[p + 2]);
            }
            framesData.push(indexed);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = item;
        });
      }
    }

    if (framesData.length === 0) return null;

    // Assemble standard GIF89a byte chunks
    const chunks = [];
    
    // Header
    chunks.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])); // GIF89a

    // Logical Screen Descriptor
    const lsd = new Uint8Array(7);
    lsd[0] = width & 0xFF;
    lsd[1] = (width >> 8) & 0xFF;
    lsd[2] = height & 0xFF;
    lsd[3] = (height >> 8) & 0xFF;
    lsd[4] = 0x80 | (7 << 4) | 7; // GCT flag + 256 colors
    lsd[5] = 0;
    lsd[6] = 0;
    chunks.push(lsd);

    // Global Color Table (256 * 3 bytes)
    const gct = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      gct[i * 3] = GLOBAL_PALETTE[i][0];
      gct[i * 3 + 1] = GLOBAL_PALETTE[i][1];
      gct[i * 3 + 2] = GLOBAL_PALETTE[i][2];
    }
    chunks.push(gct);

    // Netscape 2.0 Loop Extension
    chunks.push(new Uint8Array([
      0x21, 0xFF, 0x0B,
      0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, // NETSCAPE2.0
      0x03, 0x01, 0x00, 0x00, 0x00
    ]));

    for (const framePixels of framesData) {
      // Graphic Control Extension
      chunks.push(new Uint8Array([
        0x21, 0xF9, 0x04,
        0x08, // Disposal: restore to background
        delayCs & 0xFF, (delayCs >> 8) & 0xFF,
        0, 0
      ]));

      // Image Descriptor
      const desc = new Uint8Array(10);
      desc[0] = 0x2C;
      desc[1] = 0; desc[2] = 0; // left
      desc[3] = 0; desc[4] = 0; // top
      desc[5] = width & 0xFF; desc[6] = (width >> 8) & 0xFF;
      desc[7] = height & 0xFF; desc[8] = (height >> 8) & 0xFF;
      desc[9] = 0; // No local color table
      chunks.push(desc);

      // LZW Encoded data
      const lzw = encodeLZW(framePixels, 8);
      chunks.push(lzw);
    }

    chunks.push(new Uint8Array([0x3B])); // Trailer

    const blob = new Blob(chunks, { type: 'image/gif' });
    const dataUrl = await new Promise((res) => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result);
      reader.readAsDataURL(blob);
    });

    return {
      blob: blob,
      dataUrl: dataUrl
    };
  };
})(window);

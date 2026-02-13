/**
 * Скрипт генерации PNG-иконок из Canvas
 * Запуск: node scripts/generate-icons.js
 * 
 * Создаёт PNG иконки для PWA (192x192 и 512x512)
 * без внешних зависимостей — использует простой BMP/PNG подход
 */

const fs = require('fs');
const path = require('path');

// Минимальный PNG-энкодер (для простых иконок)
function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  
  // IDAT chunk — raw image data with zlib
  // Each row: filter byte (0=none) + RGBA pixels
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const di = rowOffset + 1 + x * 4;
      rawData[di] = pixels[pi];     // R
      rawData[di+1] = pixels[pi+1]; // G
      rawData[di+2] = pixels[pi+2]; // B
      rawData[di+3] = pixels[pi+3]; // A
    }
  }
  
  const { deflateSync } = require('zlib');
  const compressed = deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  
  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  
  // Background gradient
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = (x + y) / (size * 2);
      pixels[i] = Math.round(10 + t * 16);
      pixels[i+1] = Math.round(15 + t * 8);
      pixels[i+2] = Math.round(30 + t * 32);
      pixels[i+3] = 255;
      
      // Round corners
      const r = size * 0.18;
      const dx = Math.abs(x - (x < r ? r : x > size - r ? size - r : x));
      const dy = Math.abs(y - (y < r ? r : y > size - r ? size - r : y));
      if (x < r && y < r && Math.sqrt((x-r)**2 + (y-r)**2) > r) pixels[i+3] = 0;
      if (x > size-r && y < r && Math.sqrt((x-size+r)**2 + (y-r)**2) > r) pixels[i+3] = 0;
      if (x < r && y > size-r && Math.sqrt((x-r)**2 + (y-size+r)**2) > r) pixels[i+3] = 0;
      if (x > size-r && y > size-r && Math.sqrt((x-size+r)**2 + (y-size+r)**2) > r) pixels[i+3] = 0;
    }
  }
  
  // Rainbow arc
  const rainbowColors = [
    [255, 0, 0],
    [255, 136, 0],
    [255, 255, 0],
    [0, 204, 0],
    [0, 136, 255],
    [68, 0, 255],
  ];
  
  const arcCx = cx;
  const arcCy = size * 0.74;
  const arcR = size * 0.33;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (pixels[i+3] === 0) continue;
      
      const dist = Math.sqrt((x - arcCx) ** 2 + (y - arcCy) ** 2);
      
      // Draw rainbow bands
      for (let b = 0; b < rainbowColors.length; b++) {
        const bandR = arcR - b * (size * 0.018);
        const bandWidth = size * 0.016;
        
        if (Math.abs(dist - bandR) < bandWidth && y < arcCy) {
          const alpha = Math.max(0, 1 - Math.abs(dist - bandR) / bandWidth);
          const c = rainbowColors[b];
          pixels[i] = Math.round(pixels[i] * (1-alpha*0.85) + c[0] * alpha * 0.85);
          pixels[i+1] = Math.round(pixels[i+1] * (1-alpha*0.85) + c[1] * alpha * 0.85);
          pixels[i+2] = Math.round(pixels[i+2] * (1-alpha*0.85) + c[2] * alpha * 0.85);
        }
      }
      
      // Compass circle
      const compassCy = size * 0.43;
      const compassR = size * 0.14;
      const compassDist = Math.sqrt((x - cx) ** 2 + (y - compassCy) ** 2);
      
      if (Math.abs(compassDist - compassR) < size * 0.005) {
        const alpha = 0.4;
        pixels[i] = Math.round(pixels[i] * (1-alpha) + 180 * alpha);
        pixels[i+1] = Math.round(pixels[i+1] * (1-alpha) + 200 * alpha);
        pixels[i+2] = Math.round(pixels[i+2] * (1-alpha) + 240 * alpha);
      }
      
      // Compass needle (north - red)
      if (Math.abs(x - cx) < size * 0.015 && y > compassCy - compassR * 0.95 && y < compassCy) {
        const t = (compassCy - y) / (compassR * 0.95);
        pixels[i] = 255;
        pixels[i+1] = Math.round(68 * (1 - t));
        pixels[i+2] = Math.round(68 * (1 - t));
      }
    }
  }
  
  return Buffer.from(pixels);
}

// Generate icons
const iconsDir = path.join(__dirname, '..', 'public', 'icons');

for (const size of [192, 512]) {
  console.log(`Generating ${size}x${size} icon...`);
  const pixels = drawIcon(size);
  const png = createPNG(size, size, pixels);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), png);
  console.log(`  Saved icon-${size}.png (${png.length} bytes)`);
}

console.log('Done!');

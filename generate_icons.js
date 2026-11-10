const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Lightweight pure JS PNG encoder for icon generation
function createPNG(width, height, colorFn) {
  const bytesPerPixel = 4;
  const rowSize = width * bytesPerPixel + 1; // +1 filter byte
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * bytesPerPixel;
      const [r, g, b, a] = colorFn(x / width, y / height);
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // Color type 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND Chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc >>> 0, 8 + len);
  return buf;
}

// CRC32 implementation
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

// Ensure icons dir exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate 16, 48, 128 px icons with indigo gradient & target icon
[16, 48, 128].forEach(size => {
  const pngBuffer = createPNG(size, size, (u, v) => {
    const dist = Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2);
    
    // Outer rounded square background
    if (Math.abs(u - 0.5) > 0.45 || Math.abs(v - 0.5) > 0.45) {
      return [0, 0, 0, 0]; // Transparent padding
    }

    // Gradient background: indigo -> violet
    const r = Math.round(99 + u * 40);
    const g = Math.round(102 - u * 20);
    const b = Math.round(241 - v * 40);

    // Inner target circle / lens accent
    if (dist > 0.18 && dist < 0.25) {
      return [255, 255, 255, 255]; // White ring
    }
    if (dist < 0.12) {
      return [56, 189, 248, 255]; // Cyan center dot
    }

    return [r, g, b, 255];
  });

  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuffer);
  console.log(`Generated icon${size}.png`);
});

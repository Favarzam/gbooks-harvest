const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

function u32(value) {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

function concat(parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream !== "function") return { data: bytes, method: 0 };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  const data = new Uint8Array(buf);
  if (data.length >= bytes.length) return { data: bytes, method: 0 };
  return { data, method: 8 };
}

export async function zipFiles(files, folder) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let count = 0;

  for (const [relPath, content] of files) {
    const name = folder ? `${folder}/${relPath}` : relPath;
    const nameBytes = encoder.encode(name);
    const raw = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(raw);
    const { data, method } = await deflate(raw);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
    count += 1;
  }

  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...localParts, central, end]);
}

export function downloadBlob(bytes, filename, type = "application/zip") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 生成 512x512 应用图标（build/icon.png）—— 纯 Node 实现的最小 PNG 编码器
// 设计：深色圆角底 + 中央蓝色菱形（"管理器/仪表"意象）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const SIZE = 512
const OUT = join(process.cwd(), 'build', 'icon.png')

// 调色板
const BG = [17, 20, 24]      // #111418
const ACCENT = [77, 141, 255] // #4d8dff
const ACCENT_DARK = [38, 84, 170]
const FG = [230, 233, 238]   // #e6e9ee

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// 旋转 45° 的方形（菱形）：把点逆旋转 45° 后做矩形判定
function inDiamond(x, y, cx, cy, half) {
  const rad = -Math.PI / 4
  const rx = (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad)
  const ry = (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad)
  return Math.abs(rx) <= half && Math.abs(ry) <= half
}

function pixelColor(x, y) {
  // 外圆角底（留 8px 透明边距）
  if (!inRoundedRect(x, y, 8, 8, SIZE - 8, SIZE - 8, 96)) return null
  // 中央大菱形（accent），带描边效果：先画暗色大菱形，再画亮色小菱形
  const cx = SIZE / 2
  if (inDiamond(x, y, cx, cx, 132)) {
    if (inDiamond(x, y, cx, cx, 108)) return ACCENT
    return ACCENT_DARK
  }
  // 顶部小菱形（前景色，模拟"指针"）
  if (inDiamond(x, y, cx, cx - 96, 34)) return FG
  return BG
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const c = pixelColor(x, y)
    const o = rowStart + 1 + x * 4
    if (c) {
      raw[o] = c[0]
      raw[o + 1] = c[1]
      raw[o + 2] = c[2]
      raw[o + 3] = 255
    } else {
      raw[o + 3] = 0 // 透明
    }
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  let crc = 0xffffffff
  for (const b of Buffer.concat([typeBuf, data])) {
    crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  }
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// 10-12: compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log('icon written:', OUT, png.length, 'bytes')

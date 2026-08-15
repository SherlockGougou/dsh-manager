// 生成 README 截图占位图（docs/screenshots/*.png）
// 运行：node scripts/generate-placeholders.mjs
// 用户截图后直接替换同名文件即可（推荐 16:10，如 1280x800）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const W = 960
const H = 600
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots')

const SLIDES = [
  ['dashboard', 210],
  ['instances', 140],
  ['health', 90],
  ['plugins', 300],
  ['market', 260],
  ['sessions', 340],
  ['config', 180],
  ['updates', 40],
  ['backup', 360],
  ['settings', 20],
  ['theme', 75],
]

// 同一套 PNG 编码器（与 generate-icon.mjs 一致）
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

function hueColor(hue, sat, light) {
  // HSL → RGB（简单实现）
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  let rgb
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((v) => Math.round((v + m) * 255))
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function inDiamond(x, y, cx, cy, half) {
  const rad = -Math.PI / 4
  const rx = (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad)
  const ry = (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad)
  return Math.abs(rx) <= half && Math.abs(ry) <= half
}

function makeSlide(accentHue) {
  const bg = [17, 20, 24]
  const frame = [44, 53, 64]
  const accent = hueColor(accentHue, 0.75, 0.55)
  const accentDark = hueColor(accentHue, 0.7, 0.35)
  const raw = Buffer.alloc(H * (W * 4 + 1))
  for (let y = 0; y < H; y++) {
    const rowStart = y * (W * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < W; x++) {
      const o = rowStart + 1 + x * 4
      let color = bg
      // 中央"截图框"：圆角矩形边框（模拟应用窗口）
      if (inRoundedRect(x, y, 140, 70, W - 140, H - 70, 24)) {
        color = [26, 31, 38]
        const border = Math.abs(x - 140) < 2 || Math.abs(x - (W - 140)) < 2 || Math.abs(y - 70) < 2 || Math.abs(y - (H - 70)) < 2
        if (border) color = frame
      }
      // 中央菱形（品牌意象，按页面变色）
      if (inDiamond(x, y, W / 2, H / 2, 90)) color = inDiamond(x, y, W / 2, H / 2, 66) ? accent : accentDark
      raw[o] = color[0]
      raw[o + 1] = color[1]
      raw[o + 2] = color[2]
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, hue] of SLIDES) {
  const out = join(OUT_DIR, name + '.png')
  writeFileSync(out, makeSlide(hue))
  console.log('生成:', out, '(' + (Buffer.byteLength(makeSlide(hue)) / 1024).toFixed(0) + 'KB)')
}
console.log('完成：请将真实截图按同名覆盖 docs/screenshots/*.png（推荐 16:10）')

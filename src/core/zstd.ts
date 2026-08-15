import { zstdDecompressSync } from 'node:zlib'

/**
 * Zstandard 帧工具：dsh 会话日志是"多个独立 zstd 帧拼接"的容器
 * （每帧带校验和，追加式写入）。结构扫描算法与
 * @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames 语义一致
 * （MIT；此处按同一规范独立实现）。
 * Node >= 24 的 node:zlib 原生支持 zstd，无需第三方依赖。
 */

export const ZSTD_MAGIC = 0xfd2fb528

export interface ZstdFrameRange {
  start: number
  end: number
}

export interface ZstdFrameScan {
  frames: ZstdFrameRange[]
  /** EOF 截断在某个未完成帧内时的该帧起点（修复截断点） */
  tornStart?: number
}

/**
 * 不解压块数据即可定位完整帧。结构非法的完整帧抛出；EOF 落在帧内则返回 tornStart。
 */
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('corrupt Zstandard session log: invalid frame magic at byte ' + offset)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error('corrupt Zstandard session log: reserved frame-header bit at byte ' + (offset - 1))
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error('corrupt Zstandard session log: reserved block type at byte ' + (offset - 3))
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/**
 * 解码完整帧序列并校验（node:zlib 校验帧内校验和）。
 * @returns 全部帧明文拼接
 */
export function decodeZstdFrames(buffer: Buffer, frames: readonly ZstdFrameRange[]): Buffer {
  const parts: Buffer[] = []
  for (const frame of frames) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(parts)
}

/** 会话日志文件整体解码（帧扫描 + 解码；torn 帧被忽略并在结果中标注） */
export function decodeSessionFile(buffer: Buffer): { plaintext: string; frames: number; torn: boolean } {
  const scan = scanZstdFrames(buffer)
  const torn = scan.tornStart !== undefined
  const plaintext = decodeZstdFrames(buffer, scan.frames).toString('utf8')
  return { plaintext, frames: scan.frames.length, torn }
}

/**
 * 容错帧扫描：结构损坏（非法 magic / 保留位）时停止并返回损坏点，
 * 供"截断修复"定位最后一个完整帧。与 scanZstdFrames 的区别：不抛异常。
 */
export function scanZstdFramesTolerant(buffer: Buffer): { frames: ZstdFrameRange[]; corruptOffset: number | null } {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let frameOk = true
    for (;;) {
      if (buffer.length - offset < 3) {
        frameOk = false
        break
      }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        frameOk = false
        break
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) {
        frameOk = false
        break
      }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!frameOk) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, corruptOffset: offset < buffer.length ? offset : null }
}

/** 截断到最后一个完整帧末尾（返回应保留的字节数） */
export function truncatePoint(buffer: Buffer): { keepBytes: number; frames: number; corruptOffset: number | null } {
  const scan = scanZstdFramesTolerant(buffer)
  const last = scan.frames[scan.frames.length - 1]
  return { keepBytes: last ? last.end : 0, frames: scan.frames.length, corruptOffset: scan.corruptOffset }
}

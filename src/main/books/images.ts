/**
 * 书里的图片：导入时从 EPUB 里取出，存到书目录的 images/ 下，阅读时经 IPC 以 data: 地址交给渲染进程（CSP 只放宽了 img-src data:）。
 * - 只收 PNG / JPEG / GIF / WebP / SVG，单张不超过 20MB；读出宽高，排版时先按比例占位，图片加载前后分页不变；
 * - SVG 是不可信内容：去掉 script、foreignObject、事件属性、外部引用；清不干净的（实体声明、javascript: 等）不显示。
 */

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp' | 'svg'

export const IMAGE_MIME: Record<ImageExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

export const IMAGE_NAME_RE = /^\d{1,6}\.(png|jpg|gif|webp|svg)$/

/** 按文件头判断格式（不信扩展名）；不认识返回 null */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  const riff = String.fromCharCode(...bytes.subarray(0, 4))
  const webp = String.fromCharCode(...bytes.subarray(8, 12))
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp'
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024)).trimStart()
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head))
    return 'svg'
  return null
}

/** 图片的像素宽高；读不出来返回 null */
export function imageSize(bytes: Uint8Array, ext: ImageExt): { w: number; h: number } | null {
  const u16be = (i: number): number => (bytes[i] << 8) | bytes[i + 1]
  const u32be = (i: number): number =>
    ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
  const ok = (w: number, h: number): { w: number; h: number } | null =>
    w > 0 && h > 0 && w < 100_000 && h < 100_000 ? { w, h } : null
  switch (ext) {
    case 'png':
      return bytes.length >= 24 ? ok(u32be(16), u32be(20)) : null
    case 'gif':
      return bytes.length >= 10 ? ok(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8)) : null
    case 'jpg': {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1]
        const len = u16be(i + 2)
        // SOF0–SOF15（除了 DHT / JPG / DAC）
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return ok(u16be(i + 7), u16be(i + 5))
        i += 2 + len
      }
      return null
    }
    case 'webp': {
      const kind = String.fromCharCode(...bytes.subarray(12, 16))
      if (kind === 'VP8X' && bytes.length >= 30)
        return ok(
          1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
          1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
        )
      if (kind === 'VP8 ' && bytes.length >= 30)
        return ok((bytes[26] | (bytes[27] << 8)) & 0x3fff, (bytes[28] | (bytes[29] << 8)) & 0x3fff)
      if (kind === 'VP8L' && bytes.length >= 25) {
        const b = bytes.subarray(21, 25)
        const w = 1 + (b[0] | ((b[1] & 0x3f) << 8))
        const h = 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10))
        return ok(w, h)
      }
      return null
    }
    case 'svg': {
      const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096))
      const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
      const num = (name: string): number => {
        const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag)
        return m ? Number.parseFloat(m[1]) : 0
      }
      const w = num('width')
      const h = num('height')
      if (w > 0 && h > 0) return ok(Math.round(w), Math.round(h))
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag)
      return vb ? ok(Math.round(Number(vb[1])), Math.round(Number(vb[2]))) : null
    }
  }
}

const DANGEROUS_BLOCKS =
  /<(script|foreignObject|iframe|object|embed|audio|video|handler|listener)\b[\s\S]*?(<\/\1\s*>|\/>)/gi
const DANGEROUS_OPEN = /<(script|foreignObject|iframe|object|embed|audio|video|handler|listener)\b/i
const EVENT_ATTR = /\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const HREF_ATTR = /\s((?:xlink:)?href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const SAFE_HREF = /^["']?(#[\w.-]*|data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+)["']?$/i

/** 清理 SVG；清不干净返回 null（不显示这张图） */
export function sanitizeSvg(source: string): string | null {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) return null
  let s = source.replace(DANGEROUS_BLOCKS, '')
  s = s.replace(EVENT_ATTR, '')
  s = s.replace(HREF_ATTR, (m, _name: string, value: string) => (SAFE_HREF.test(value) ? m : ''))
  s = s.replace(/@import[^;]*;?/gi, '')
  // 复查：还有危险内容就不要了
  if (DANGEROUS_OPEN.test(s) || /javascript:|vbscript:|\son[a-z]+\s*=/i.test(s)) return null
  if (/url\(\s*["']?(?!#|data:image\/)/i.test(s)) return null
  return s
}

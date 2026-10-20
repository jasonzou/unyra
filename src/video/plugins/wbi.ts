/**
 * B 站 WBI 签名（wbi/v2 接口的 w_rid/wts）与它依赖的 MD5。
 *
 * 为什么必须做这个：`/x/player/v2`（无签名）在风控降级时会 **HTTP 200 假成功**地返回
 * **随机其他视频的 AI 字幕**——同一视频无签名四次全是错的，带签名四次全对（社区 2026-08
 * 查明的根因，BBDown 同坑同修）。所以字幕一律走 `/x/player/wbi/v2` + 签名，无签名路径
 * 宁可失败也不回退——降级数据比失败更毒（错误文本无声地进面板）。
 *
 * 算法（bilibili-API-collect，多来源交叉印证）：
 * 1. nav 接口（匿名可用）返回 wbi_img.img_url / sub_url，取文件名（去 .png）为 img_key/sub_key，
 *    每日轮换，这里缓存 1 小时；
 * 2. img_key+sub_key 拼成 64 字符，按 MIXIN_KEY_ENC_TAB 重排取前 32 位 = mixin_key；
 * 3. 请求参数加 wts（秒级时间戳）后按键名升序、百分号编码（值先滤掉 !'"()*）、拼上
 *    mixin_key，取 MD5 = w_rid。
 */

import type { VideoPluginCtx } from '../types'

/* ---------- MD5（RFC 1321） ---------- */

/**
 * WebCrypto 不提供 MD5，签名又只能用它——自带一份紧凑实现。
 * 轮常量 K 按 RFC 的定义式 |sin(i)| 现算而不是手抄 64 个数（抄错一位查不出来）。
 */
const K = new Uint32Array(Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)))

/** 四轮各自的循环左移位数（每轮内 4 个一组循环） */
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]

const rol = (x: number, c: number): number => (x << c) | (x >>> (32 - c))

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  // 填充到 ≡56 (mod 64)，末尾 8 字节小端位长
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLen >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)

  let a0 = 0x67452301 | 0
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476 | 0
  const M = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + K[i] + M[g]) | 0
      A = D
      D = C
      C = B
      B = (B + rol(F, S[(i >> 4) * 4 + (i & 3)])) | 0
    }
    a0 = (a0 + A) | 0
    b0 = (b0 + B) | 0
    c0 = (c0 + C) | 0
    d0 = (d0 + D) | 0
  }
  const hex = (n: number): string => {
    let out = ''
    for (let i = 0; i < 4; i++) out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
    return out
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

/* ---------- WBI 签名 ---------- */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

/** nav 返回的伪装图片 URL：文件名（去 .png）就是 key */
function keyFromUrl(url: string): string {
  const name = url.split('/').pop() ?? ''
  return name.replace(/\.png$/, '')
}

/** key 每日轮换；缓存 1 小时足够，重启或过期再取 */
let cachedKeys: { img: string; sub: string; at: number } | null = null

/** 给参数签出 w_rid/wts，返回**已排序编码好**的查询串（保证签名与实际发送逐字节一致） */
export async function wbiSignedQuery(
  ctx: VideoPluginCtx,
  headers: Record<string, string>,
  params: Record<string, string>,
): Promise<string> {
  if (!cachedKeys || Date.now() - cachedKeys.at > 3_600_000) {
    const res = await ctx.fetch('https://api.bilibili.com/x/web-interface/nav', headers)
    if (!res.ok) throw new Error(res.error)
    const wbi = (JSON.parse(res.body) as { data?: { wbi_img?: { img_url?: string; sub_url?: string } } }).data?.wbi_img
    const img = keyFromUrl(wbi?.img_url ?? '')
    const sub = keyFromUrl(wbi?.sub_url ?? '')
    if (img.length !== 32 || sub.length !== 32) throw new Error('nav 接口没给出可用的 wbi key')
    cachedKeys = { img, sub, at: Date.now() }
  }
  const raw = cachedKeys.img + cachedKeys.sub
  let mixin = ''
  for (const i of MIXIN_KEY_ENC_TAB) mixin += raw[i] ?? ''
  mixin = mixin.slice(0, 32)

  const all: Record<string, string> = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k].replace(/[!'()*]/g, ''))}`)
    .join('&')
  return `${query}&w_rid=${md5Hex(query + mixin)}`
}

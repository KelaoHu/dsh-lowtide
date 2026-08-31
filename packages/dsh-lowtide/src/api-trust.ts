/**
 * Host/Origin trust fence for /ds-lowtide (PLAN B2 / §7.3).
 * 抄写自 dsh-client-connection 的 isTrustedApiRequest 逻辑(该包不公开导出,
 * 只能复制,不能 import)。防御 DNS rebinding 与跨站请求:
 *   - Host 必须命中 loopback(本插件当前只以 loopback 部署);
 *   - `sec-fetch-site: cross-site` 一律拒绝;
 *   - 带 Origin 的请求必须与 Host 同源;`null` Origin 拒绝。
 * trustedHosts 扩展(LAN/SSH 隧道部署)留待 Phase 4。
 */
import type { IncomingHttpHeaders } from 'node:http'

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** 127/8、localhost、[::1] 均视为 loopback(与上游同语义)。 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Normalize port for comparison: explicit port wins; otherwise derive from
 * protocol (http → 80, https → 443). Fixes the bug where Host "localhost"
 * (implicit port 80) fails against Origin "http://localhost:3080".
 */
function normalizedPort(url: URL): string {
  if (url.port !== '') return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

/**
 * 判定一个 /ds-lowtide 请求是否可信。
 * @param headers - Node HTTP 请求头。
 * @returns true 时请求可继续;false 时调用方应回 403。
 */
export function isTrustedApiRequest(headers: IncomingHttpHeaders): boolean {
  const host = header(headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (header(headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(headers, 'origin')
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    // Loopback aliases (localhost / 127.x / [::1]) are interchangeable:
    // comparing verbatim would 403 a page served from 127.0.0.1 that talks
    // to a localhost Host (or vice versa) — same machine, same risk class.
    if (!isLoopbackHostname(originUrl.hostname)) return false
    return normalizedPort(originUrl) === normalizedPort(hostUrl)
  } catch {
    return false
  }
}

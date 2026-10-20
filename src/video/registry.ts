/**
 * 来源插件的注册与解析收口：应用的「视频接入」只从这里进门。
 *
 * 现状（实验期）：插件是**编译进包**的本地模块，物理上隔离在 src/video/plugins/ 下、
 * 接口上完全按 VideoSourcePlugin 契约走——为的是先把链路跑通、把契约钉牢，
 * 插件外置成用户目录里的第三方生态时，这里换一个「从磁盘加载」的实现即可，
 * 契约与消费端一行不用动。
 *
 * 校验纪律在 resolveSource 的最后一步：插件交出的 transcript 一律过
 * normalizeTranscript（宽进严出——毛刺归一，硬伤整体拒绝），错误原话上抛，
 * 界面不做任何预判文案。
 */

import { t } from '../i18n'
import { native } from '../lib/native'
import { formatClock, normalizeTranscript } from './transcript'
import { bilibiliPlugin } from './plugins/bilibili'
import type { VideoPluginCtx, VideoResolveOptions, VideoSource, VideoSourcePlugin } from './types'

/** 注册表：按声明顺序匹配，先到先得 */
const VIDEO_PLUGINS: VideoSourcePlugin[] = [bilibiliPlugin]

/** 插件的宿主能力：API 请求走主进程通道（渲染层发不出防盗链头，这是通道存在的全部理由） */
function pluginCtx(): VideoPluginCtx {
  return {
    async fetch(url, headers) {
      const res = await native().video.fetch(url, headers)
      return res.ok ? { ok: true, status: res.status, finalUrl: res.finalUrl, body: res.body } : res
    },
  }
}

/** 找出认领这个输入的插件；没有就抛（输入由界面直接透传，错误原话直达面板） */
export function matchPlugin(input: string): VideoSourcePlugin {
  const plugin = VIDEO_PLUGINS.find((p) => p.match(input) !== null)
  if (!plugin) throw new Error(t('没有插件支持这个输入：{0}', input.slice(0, 80)))
  return plugin
}

/**
 * 字幕与视频的**时长对账**：字幕末段超出视频时长明显（余量 5 秒之外还超 10%）时
 * 判为平台侧错配，拒之门外。实测确实存在——B 站 AI 字幕给过一条 13:20 的转写，
 * 配的却是 7:39 的视频（字幕与 mp4 各自按 cid 取，错在平台侧的生成/缓存）。
 * 脏字幕不进面板，transcriptError 带上两边的时长当证据。
 */
function vetTranscript(source: VideoSource): VideoSource {
  if (!source.transcript || !source.durationMs) return source
  const last = source.transcript.segments[source.transcript.segments.length - 1]
  if (!last) return source
  if (last.endMs > source.durationMs + 5_000 && last.endMs > source.durationMs * 1.1) {
    return {
      ...source,
      transcript: undefined,
      transcriptError: t(
        '字幕时间轴到 {0}，视频只有 {1}——平台侧字幕错配，已拦截不显示',
        formatClock(last.endMs),
        formatClock(source.durationMs),
      ),
    }
  }
  return source
}

/** 解析一次：匹配 → 插件 resolve → 转录统一归一校验 + 时长对账。抛出的错误原样传给界面显示 */
export async function resolveSource(input: string, opts: VideoResolveOptions): Promise<VideoSource> {
  const plugin = matchPlugin(input)
  const matched = plugin.match(input)
  if (!matched) throw new Error(t('没有插件支持这个输入：{0}', input.slice(0, 80)))
  const source = await plugin.resolve(matched, pluginCtx(), opts)
  const normalized = source.transcript
    ? { ...source, transcript: normalizeTranscript(source.transcript) }
    : source
  return vetTranscript(normalized)
}

/** 把插件的流地址登记成 media-relay 中转地址（每次播放前调用；见 shared/ipc 的说明） */
export async function openRelayStream(source: VideoSource): Promise<string> {
  const stream = source.stream
  if (!stream) throw new Error(t('这个来源没有可播放的流'))
  if (stream.kind === 'file') throw new Error(t('本地文件流还没有接进播放通道'))
  const res = await native().video.openStream(stream.url, stream.headers)
  if (!res.ok) throw new Error(res.error)
  return res.relayUrl
}

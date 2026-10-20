/**
 * 视频学习（实验）的**插件契约**：来源插件与应用之间唯一的接口面。
 *
 * 合规边界落在这份契约上：应用本体只提供「播放 + 转录段显示 + 跳转」三件通用的事，
 * 怎么从某个平台拿到流与字幕是插件自己的事——应用不分发任何平台解析器。
 * 契约的核心是 `StreamHandle` 与 `Transcript`：插件无论走「字幕直取」还是
 * 「音频交 STT」（后者还没建），最终产出的都是**统一转录段**，下游（面板、
 * 将来的分组与 agent 工具）只认这一种格式。
 *
 * 契约的三条硬约束（校验见 transcript.ts，不合格整体拒绝）：
 * 1. 时间一律**整数毫秒**——浮点秒经序列化与取整会有精度毛刺，跳转 seek 也要整数；
 * 2. text 是**纯文本**：无标签、无换行、无实体；
 * 3. segments 按 startMs **升序、互不重叠**——双语文幕两条 cue 重叠的，插件自己合并或选主语言。
 */

/** 一段带时间戳的转录文本（一句话一个单元；半句 cue 由插件负责合并成句） */
export interface TranscriptSegment {
  /** 开始时间（整数毫秒，含） */
  startMs: number
  /** 结束时间（整数毫秒，不含） */
  endMs: number
  /** 纯文本：无标签、无换行、无实体 */
  text: string
  /** 说话人（预留字段，MVP 不做分离；插件拿得到就填） */
  speaker?: string
}

/** 一份完整转录稿 */
export interface Transcript {
  /** schema 版本：缓存要长期活着，将来演进靠它迁移 */
  version: 1
  /** 这份转录怎么来的：语音识别，还是直接取的现成字幕 */
  origin: 'stt' | 'subtitle'
  /** 主语言（BCP-47；双语字幕由插件选定主语言后填） */
  language?: string
  /** 转录段：按 startMs 升序、互不重叠 */
  segments: TranscriptSegment[]
}

/**
 * 一条可播放的媒体流。
 *
 * url 型的地址**有时效**（平台签名几小时过期）：组件每次播放前都经 video:openStream
 * 重新登记换中转地址，所以这里保存的只是插件当场解析出来的那份。
 * file 型是本地文件路径（`<video>` 直接吃 file://，走 readMedia 的老路），MVP 预留。
 */
export type StreamHandle =
  | { kind: 'url'; url: string; headers?: Record<string, string> }
  | { kind: 'file'; path: string }

/** 插件解析一次输入（链接 / 编号 / 文件路径）之后交出的全部东西 */
export interface VideoSource {
  /** 稳定身份（如 `bili:BV1xx411c7mD:p1`）：将来转录缓存以它为键 */
  mediaId: string
  /** 展示标题 */
  title: string
  /** 总时长（毫秒；拿得到就填） */
  durationMs?: number
  /** 可播放的流；插件只做转录（用户本地已有视频）时省略 */
  stream?: StreamHandle
  /** 转录稿；来源没有可用字幕时省略（不算失败——播放照常） */
  transcript?: Transcript
  /**
   * 转录的**失败原话**：插件试过拿字幕但中途炸了（下载 403、解析失败……）。
   * 与「列表为空 = 真没有字幕」是两回事，面板据此说不同的话——
   * 失败原因吞掉的话，配了登录态的用户只会看到一句误导的「需要登录」。
   */
  transcriptError?: string
}

/** 插件解析时能用的宿主能力：API 请求走主进程通道（渲染层发不出防盗链头） */
export interface VideoPluginCtx {
  /** 只读 GET。返回主进程的回执：ok 时 body 是响应原文（插件自己 parse JSON） */
  fetch(url: string, headers?: Record<string, string>): Promise<
    { ok: true; status: number; finalUrl: string; body: string } | { ok: false; error: string }
  >
}

/** 来源插件：一个平台 / 一种来源一份 */
export interface VideoSourcePlugin {
  /** 插件 id（mediaId 前缀用，小写字母数字） */
  id: string
  /** 显示名（设置与日志里用） */
  name: string
  /** 能力声明：MVP 的插件要么「字幕直取」要么「交音频给 STT」——当前只有前者 */
  provides: Array<'transcript' | 'audio' | 'stream'>
  /**
   * 这个输入归不归我管（不抛错，不认识就返回 null）。
   * match 与 resolve 分开：同一个输入可能命中多个插件的规则，先到先得按注册顺序。
   */
  match(input: string): { input: string } | null
  /** 解析：拿到流与转录。失败就抛 Error（错误原话直达界面，不做预判文案） */
  resolve(matched: { input: string }, ctx: VideoPluginCtx, opts: VideoResolveOptions): Promise<VideoSource>
}

/** 解析入参里与插件有关的部分（MVP 只有 B 站登录态一项） */
export interface VideoResolveOptions {
  /** B 站 SESSDATA（可选）：AI 字幕与高清流通常要登录后才给 */
  sessdata?: string
}

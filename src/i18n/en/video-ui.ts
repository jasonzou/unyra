/**
 * 视频学习（实验）的英文分片：键 = 界面里的中文原文（见 src/i18n 的中文键方案）。
 * 覆盖三处：页签组件（components/video）、页签名（learn/tabs）、
 * 转录校验与插件错误（src/video）。
 */
const dict: Record<string, string> = {
  /* ---------- 页签与入口 ---------- */
  '视频学习': 'Video study',
  '视频学习（实验）': 'Video study (experimental)',
  '实验': 'Exp',
  '实验功能：视频接入由来源插件提供，应用本身不做任何平台解析。':
    'Experimental: video access is provided by source plugins; the app itself never parses any platform.',
  '视频学习仅桌面端可用': 'Video study is desktop-only',
  '视频流由主进程的本地媒体通道转发（防盗链头 `<video>` 发不出来），浏览器模式里没有这条通道。':
    'The media stream is relayed by a local channel in the main process (the hotlink headers cannot be set by <video>); that channel does not exist in browser mode.',
  '还没有可解析的内容': 'Nothing to resolve yet',

  /* ---------- 解析工具条 ---------- */
  '粘贴 B 站视频链接或 BV 号，回车解析': 'Paste a Bilibili link or BV id, press Enter to resolve',
  '解析': 'Resolve',
  '正在解析…': 'Resolving…',
  '解析视频与字幕': 'Resolve video and subtitles',
  '在上面粘贴一个 B 站视频链接或 BV 号，解析后即可播放并按字幕时间戳跳转。':
    'Paste a Bilibili link or BV id above; after resolving you can play the video and jump by subtitle timestamps.',
  '这条来源没有可用的转录。': 'No transcript available for this source.',

  /* ---------- 登录设置（SESSDATA） ---------- */
  '登录设置（SESSDATA，可选）': 'Login (SESSDATA, optional)',
  'B 站登录态（SESSDATA，可选）': 'Bilibili login (SESSDATA, optional)',
  'AI 字幕通常要登录后才拿得到。值只存本机（浏览器存储），随请求发给 B 站。':
    'AI subtitles usually require login. The value stays on this machine (browser storage) and is sent to Bilibili with requests.',
  '这条来源没有字幕：AI 字幕通常需要登录——点右上角齿轮填入 SESSDATA 后重试。':
    'No subtitles for this source: AI subtitles usually require login — open the gear in the top right, fill in SESSDATA and retry.',
  '字幕获取失败：{0}': 'Failed to fetch subtitles: {0}',
  '字幕时间轴到 {0}，视频只有 {1}——平台侧字幕错配，已拦截不显示':
    'Subtitles run to {0} but the video is only {1} — a platform-side subtitle mismatch; blocked from display',
  '获取：浏览器登录 B 站 → F12 → 应用（Application）→ Cookies → www.bilibili.com → 复制「SESSDATA」的值粘贴到这里。':
    'How to get it: log in to bilibili.com in your browser → F12 → Application → Cookies → www.bilibili.com → copy the value of "SESSDATA" and paste it here.',
  '只粘贴 Value 本身（带 SESSDATA= 前缀也能存，会自动剥掉）':
    'Paste the value only (a "SESSDATA=" prefix is stripped automatically)',
  '已保存': 'Saved',

  /* ---------- 转录段面板 ---------- */
  '字幕': 'Subtitles',
  '语音识别': 'Speech-to-text',
  'AI 中文字幕': 'AI Chinese',
  '中文字幕': 'Chinese CC',

  /* ---------- 转录校验（src/video/transcript） ---------- */
  '转录稿不是合法对象': 'Transcript is not a valid object',
  '转录稿版本不支持：{0}': 'Unsupported transcript version: {0}',
  '转录稿来源未知：{0}': 'Unknown transcript origin: {0}',
  '转录稿缺少段列表': 'Transcript has no segment list',
  '第 {0} 条转录段不是合法对象': 'Segment {0} is not a valid object',
  '第 {0} 条转录段时间倒挂：{1} → {2}': 'Segment {0} has inverted times: {1} → {2}',
  '第 {0} 条转录段带着标签或换行：插件必须交纯文本': 'Segment {0} contains tags or line breaks: plugins must submit plain text',
  '转录段互相重叠（{0} 与 {1}）：插件必须自己合并或选主语言':
    'Segments overlap ({0} and {1}): the plugin must merge them or pick a primary language',
  '转录段时间不是合法毫秒数：{0}': 'Segment time is not a valid millisecond value: {0}',

  /* ---------- B 站插件与注册表（src/video） ---------- */
  '没有插件支持这个输入：{0}': 'No plugin handles this input: {0}',
  '这个来源没有可播放的流': 'This source has no playable stream',
  '这个页签没有可保存的内容': 'This tab has nothing to save',
  '本地文件流还没有接进播放通道': 'Local file streams are not wired into the player yet',
  '{0} 回的不是 JSON（status {1}）': '{0} did not return JSON (status {1})',
  '{0}：{1}': '{0}: {1}',
  '接口未说明原因': 'the API gave no reason',
  'B 站插件认不出这个输入': 'The Bilibili plugin cannot parse this input',
  '视频信息里没有分 P（cid）': 'No page (cid) in the video info',
  '播放接口没有给出可用流': 'The play API returned no usable stream',
  '这个视频返回了 {0} 段流，实验通道暂不支持': 'This video returned {0} stream parts; the experimental channel does not support that yet',
}

export default dict

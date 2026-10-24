/**
 * 这个文件负责什么：**动态提示词注入**的模块注册表——低频能力的完整规范住在这里，
 * 系统提示词里只留一行索引；模型第一次真正用到某组 api（或写出某种内容）时，
 * 宿主把对应模块作为一条隐藏 user 消息注入上下文，**同一上下文只注一次**。
 *
 * 为什么这样拆：EXECUTE_GUIDE 曾把十几个低频域的完整手册整段压在系统提示词里
 * （sdoc 3k、browser 1.8k、exam 1.5k……），每一轮请求都全价付一遍，而多数对话
 * 根本用不到。搬进模块后：不用不花钱；用到时全文在场（不是压缩版）；压缩上下文后
 * 模块随旧消息失活，下次使用自动重新注入——判据见 missingPromptModules。
 *
 * 纪律：
 * - **模块文本与实现对账**：这里的每一段都源自 EXECUTE_GUIDE 的对应小节（无损搬移），
 *   api 行为改了这里也要改——apiCatalog 的目录页与 agent-ops 探针只对账「有没有」，
 *   对不了「写得对不对」。
 * - **key 一经使用不可改**：去重靠消息上的 promptModule 字段（落盘在 chat.json），
 *   改 key 等于让所有老对话的「已注入」记录作废。
 * - 模块文本必须**自包含**：模型读到它时上下文里没有别处的铺垫，开头一句要说清这是什么。
 */
import type { ConversationMessage } from '../../agent/types'
import { t } from '../../i18n'

export interface PromptModule {
  /** 稳定标识：去重、消息标记、触发映射全靠它（见文件头纪律） */
  key: string
  /** 界面分界条上显示的名字（mark = 提示词模块 · {title}） */
  title: string
  /** 注入上下文的完整文本（自包含） */
  text: string
}

export const PROMPT_MODULES: PromptModule[] = [
  {
    key: 'browser',
    title: '内置浏览器',
    text: `内置浏览器（browser.open / browser.tabs / browser.activate / browser.close / browser.snapshot / browser.point / browser.dom / browser.read / browser.capture / browser.logs / browser.logDetail / browser.fetch / browser.record / browser.text / browser.scroll）——这份规范在你第一次操作内置浏览器时注入：
- 这一组操作的是**界面上开着的网页页签**（文档区里那种地球图标页签）。没有页签就先
  api.browser.open('https://…') 开一个：纯关键词会当搜索词处理；返回 tabId，那时首屏已基本加载完。
- api.browser.tabs()：列出存活的页签。**browser.open 之前先查它**：目标网址已经开着就 activate
  过去，别重复开同一个网址。之后一切操作按 tabId 指名；省略 tabId 指「焦点格正看着的那个网页」。
- **看页面三招（按便宜程度排）**：
  - api.browser.snapshot(tabId?, { role?, contains?, limit? }?)：把可交互元素列成**带 ref 的清单**——
    认结构、找要点的元素全靠它。**大页面一定给过滤**：{role:"link"}、{contains:"关键词"}、{limit:30}，
    整份捞大页面就是 5k token 换 2 条信息。DOM 变了 ref 会过期，重新 snapshot 就好。
  - api.browser.text(tabId, { ref } | 选择器, { maxChars? }?)：取**渲染后**的区域文本（≤4000 字）——
    SPA 上唯一的文本通道，纯 HTML 抓取提取不出正文的页面（报「没提取出正文」）靠它，不是截图。
  - api.browser.read(tabId?, { maxChars?, offset? }?)：整页转 markdown
    （短的回全文，长的落盘回大纲）。**登录态页面也能读**——这是外部抓取做不到的。只要前段就给 {maxChars}（续读带 {offset: nextOffset}）。
  - api.browser.capture(tabId?)：截图（存进资源库并附在下一步里）。**最后手段**：只有布局与视觉
    必须亲眼看时才用；页面还在加载时先 api.wait(800)。
- **动手 = browser.dom**：对 snapshot 清单里的 ref 做受控操作（固定函数 + 值参数，没有任意 JS 的口子）：
  - dom(tabId?, ref, "click")：程序化点击（绝大多数站点的处理函数都会触发）。
  - dom(tabId?, ref, "fill", "文字")：填输入框——触发 input/change 事件，React 受控输入也认；中文照常。
  - dom(tabId?, ref, "focus") / dom(tabId?, ref, "submit")：聚焦；提交元素所在的表单。
  - dom(tabId?, ref, "text")：取这个元素的文字（≤4000 字）；dom(tabId?, ref, "attr", "href")：取属性值。
  - 个别检测程序化点击的站点点不动：api.browser.point 把元素高亮给用户、请用户手点。
- **指给用户看**：api.browser.point(tabId?, 目标)——页面像锚点跳转一样滚到目标元素，并注入一圈
  短暂的脉冲高亮。目标可以是 { ref } 或 CSS 选择器。汇报「我说的是这个元素」时用它。
- **日志与直发（logs / logDetail / fetch / record，tabId 一律必给，不吃焦点默认）**：
  - api.browser.logs(tabId, { kind?, level?, only?, limit?, afterSeq? }?)：页签的 console 报错 + 页面
    自己发的网络请求**清单**——重复折叠 ×N、静态资源（含 .js/.css 等扩展名）压一行、失败永不折叠，
    每行带 [c#]/[n#] 条目号。动作没生效/页面静默失败先看它（level 默认 error；{only:"api"} 只看
    XHR/Fetch；翻页拿上一份的 latestSeq 当 afterSeq）。
  - api.browser.logDetail(tabId, seq)：单条详情（条目号 96、"n96" 都认）——网络的给短网址 urlPath +
    全量 url、请求头（截断）、postData、截断响应体。
  - api.browser.fetch(tabId, 网址 | { reqId }, { method?, headers?, body?, offset?, maxBody? }?)：在页面
    上下文直发 HTTP，**继承该页签登录态**；{ reqId } = 重放网络清单里那条请求（头全带上，覆盖项
    落其上）。**请求级失败不抛异常**：没拿到响应回 { status:0, failed:true, reason }，按值分支不用
    try/catch；HTTP 4xx/5xx 是正常回执。长响应 { offset } 分段续读。
    **动态页面的快路**：先 UI 摸清一次请求形态，同类动作在 execute 循环里直发——循环里直发
    零推理成本，比一次次的 snapshot+dom 便宜一个量级。**写操作（POST/PUT/DELETE）与批量
    直发是不可逆动作，必须先 api.ask**；循环要节流（宁慢勿封）；触发本地逻辑（上传/支付/
    复杂前端状态）的动作仍走 UI。**重放的时间窗（实测）**：捕获后几秒内 {reqId} 重放通常能成
    （且站点只认首批若干条）；隔了轮次再重放大概率 403/404——捕获的头里有一次性签名，
    过期就要回 UI 重新触发一次拿新 reqId，别在旧条目上耗轮次。长响应别整段 return：
    { toTmp: 'key' } 全文（≤256k）落临时变量，代码里 tmp.get 出来解析，只把提炼结果交回来。
  - api.browser.record(tabId, "start" | "stop")：录制区间——start 钉水位，请用户做你做不了的操作
    （登录/验证码），stop 回**这段区间**的折叠清单。配 api.ask 用。
  - api.browser.scroll(tabId, { by: 像素 } | { to: "top"|"bottom"|选择器 } | { ref })：滚**页面**（无限
    滚动信息流的引擎）——滚完看返回的 atBottom，true 就 wait 一拍再滚，新内容才加载。
    注意 ui.scroll 滚的是文档区，别混用。
- **编排纪律（少一轮是一轮）**：
  - 一段 execute 把整条链写完：snapshot → 按清单判断 → dom 的 fill/submit 连招 → read 收尾，
    不要每个动作单独一轮。
  - 拿不准某一步行不行，就用 **if/else + try/catch 把备选一次写全**：ref 过期就在 catch 里重新
    snapshot 再试、选择器失败换 { ref }、dom 点不动就 point 请用户手点——失败被接住继续走，
    既不中断程序，也省掉「试一次、看报错、再试」的额外轮次。
  - **截图是最后手段**：snapshot / read / dom 的 text 与 attr 拿得到的信息，不要用截图拿。
- 网页是用户的真实登录会话：提交、支付、删除、发消息这类不可逆动作必须先 api.ask 确认；
  用户没让关的页签不要 close。跨源 iframe 里的元素 ref 定位不到（此时 point/capture 兜底）。
- 卡住了就问，别内耗：某一步无法独立完成（验证码、登录、系统权限弹窗）就 **api.ask 说清情况
  等用户操作**；表单一分钟没人理会会自动超时（回执 timedOut: true）——那时自行判断：换路子继续，
  或把手头的成果交付掉、说清卡在哪。**同一个目标连续两次尝试失败就停下交付**，反复重试耗的是
  用户的 token。
- 临近交付：这一轮开了很多页签的话，用 api.browser.close 把中间搜索页、试错页签挑没用的关掉，
  留下用户可能还要看的。`,
  },
  {
    key: 'web',
    title: '网络搜索与网页抓取',
    text: `网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）——这份规范在你第一次调用搜索或抓取时注入：
- **api.fetch({ url }) 或 api.fetch(url)**（亦可调 api.web.fetch，支持 url / link / href 别名）：
  * DeepSeek 官方抓取服务。输入目标网页 URL，返回统一结构 { ok: boolean, title: string, content: string, error?: string }。
  * 容错契约：失败时不抛异常，返回 { ok: false, title: '', content: '', error: '...' }。读取 content 绝不会报 undefined，但**必须先检查 if (!r.ok) 分支处理**。
  * 抓取受第三方站点反爬与超时限制（例如维基百科、部分高校课程网）：若抓取失败或超时，**严禁死循环重复抓取同一 URL**，请直接降级使用搜索结果中已有的 snippet / summary 摘要，或换用其他检索结果链接。
- **api.web.search({ query, count?: 5, need_content?: boolean, ... }) 或 api.web.search(query, { count: 5 })**：
  * DeepSeek 官方搜索服务。返回统一结构 { ok: boolean, results: Array<{ title, url, snippet, summary, rerank_score, authority?, content? }>, error?: string }。
  * 参数容错与别名：count 支持别名 maxResults / limit，默认值为 5（单条结果约 1.5k~2k 字符，5 条约 10k 字符，有效防止撑爆上下文）；query 支持 q / keyword；need_content 支持 needContent。
  * 搜索质量调优：宽泛词容易搜出专利书或商业碎片；建议补充领域限定词（如「教材」「规范」「原理解析」「教程」「官方文档」）。检索结果自带 rerank_score（相关度）与 authority（权威度），可自行筛选排序。
- **上下文体积防爆铁律（严防触碰 3.2 万字符上限）**：
  * 沙箱 execute 结果有 32,000 字符硬上限。严禁在一次 execute 里并发/连续塞入多个 query 并直接返回全量 raw 结果（否则极易触发截断丢失后续结果）！
  * 多关键词搜索时，请在 JS 脚本中按需筛选提炼字段：const items = r.results.map(x => ({ title: x.title, url: x.url, summary: x.summary || x.snippet }))；或分轮次按需检索。
  * need_content: true 会返回单条几千到上万字符的长正文，仅在极其关键且确需全文时对 1~2 个条目开启，绝不可全量开启。
- **该不该搜：按任务类型定**（本节最要紧的一条）：
  * **创作类交付默认要查证**：新建学习目标、规划路线大纲、撰写教学讲义、设计试卷题库——先用 api.web.search 检索权威讲义、官方文档、课程大纲、标准规范与真题，**再挑最权威的原文 api.fetch 读正文**，多源比对后再写，**严禁只凭记忆空想捏造**。
  * **检索不是调研**：search 只负责找到入口，snippet / summary 是索引、不是依据。挑 1~3 篇最权威的（官方文档、标准原文、教材或大纲原文）用 api.fetch 读正文，看清它到底怎么讲，再做比对、提炼与取舍。交付物里引用的每条结论，都必须来自你**读过的正文**——只看着标题和摘要就下笔，等于走个形式。
  * **抓取有 5 秒硬超时**：超时就换一个来源（或改用搜索结果里的另一条），**绝不重试同一 URL**；只拿到摘要时如实说明「这是摘要层面的信息」，不要装作读过全文。
  * **确定性工作默认不搜**：纯算法、本地逻辑、调试自己的代码、重构、格式转换、计算与数据整理、解释已有内容、闲聊——直接用你自己的知识做，不要联网。
  * **编码涉网是例外，必须搜**：写的代码要调第三方接口、依赖协议 / 规范原文、SDK 用法、鉴权流程、数据格式契约（请求头、错误码、限流、分页这类边界）时，**先 api.web.search 找官方文档与规范原文，再用 api.fetch 读正文**，确认参数与边界后落笔——接口行为靠猜，只会把轮次烧在盲试上；自己代码里的 bug 与纯本地逻辑仍属上一条，不要拿「涉网」当借口什么都搜。
  * 另外两种情况也要搜：用户明确要求查资料 / 给了网址 / 要最新信息；事实在你知识截止之后，或你拿不准且答错的代价很高。
  * **一次够用就停**：一个 query 的 5 条结果通常已够多源比对，不要为了「更全」反复换词补搜，也不要为了凑来源列表而搜。
  * 检索不到权威来源时如实说明这是通识讲解，不要用「据说」「有资料显示」含糊带过——那比不搜更糟。
  * 引用或参考网络资料时，区分客观行业事实与材料观点，确保严谨性。
- **网络引用与参考资料声明规范（强制性交付纪律）**：
  * **必须声明来源**：凡在生成教学文档、大纲规划、知识点推导或试卷设计中使用了网络搜索（api.web.search）或网页抓取（api.fetch），**必须在最终交付物中明确声明参考的权威站点与网址**，严禁隐去来源或格式混乱。
  * **文档末尾必须使用网页类 Chip（严禁使用普通超链接）**：文档末尾的参考与引证来源**必须使用网页类 chip（#[{"type":"web","url":"...","title":"..."}] 或通过 await api.chip.build({ type: 'web', url, title }) 生成），严禁写成普通 Markdown 超链接 [文字](url)**。用户点击网页 chip 将在应用内置浏览器页签中直接查阅。
  * **Chip 标题字数限制提醒**：界面对 Chip 设置了最大宽度限制（视觉上超出自动以省略号截断），因此 chip 的 title 字段必须简明扼要（建议控制在 15~25 个汉字或 30~50 个英文字符以内，例如《MDN: Flex 布局指南》），严禁把整句话、长段摘要或整串网址塞进 title！详细的参考说明、依据与观点写在 chip 后面的 Markdown 文本中。
  * **文档内声明格式示例（教学文档末尾必须包含）**：
    \`\`\`markdown
    ## 📚 参考资料与权威来源
    - #[{"type":"web","url":"https://example.com/spec","title":"官方规范核心定义"}] - 简要说明参考依据（如：核心定义与官方最佳实践）
    - #[{"type":"web","url":"https://example.com/course","title":"权威高校公开课讲义"}] - 简要说明参考依据（如：数学理论推导与典型案例参考）
    \`\`\`
  * **对话里不再复述来源清单**：本轮改了哪些文件、真正引用了哪些来源，用一次 \`api.delivery.submit({ files, sources })\` 登记——界面会在消息底部按「一行一条」展示（文件变动 + 参考引证）。\`sources\` 只收真正读过并引用的 http/https 链接，\`files\` 写数据树路径或工作区相对路径。**没有交付物就不要调**；同一轮分几次登记会合并去重。
    示例：\`await api.delivery.submit({ files: [{ path: '微积分/极限', action: 'updated', note: '补了夹逼定理' }], sources: [{ title: '同济高等数学第七版', url: 'https://example.com/book' }] })\`
    文档内部（文末「## 📚 参考资料与权威来源」）仍按上面那条芯片规范写，那是文档的一部分，不属于交付账。`,
  },
  {
    key: 'mcp',
    title: 'MCP 外部服务',
    text: `外部 MCP 服务（Model Context Protocol——用户配置的真实外部工具）——这份规范在你第一次调用 mcp.* 时注入：
- api.mcp.list()：已启用的服务与各自缓存的工具清单（id、名称、传输、状态）。要调外部工具**先看它**；
  服务按 id 或名称指名都认（名称撞重时用 id）。
- api.mcp.discover(server?)：现场探测最新工具清单（SSE 服务实时请求，可能要等几秒；省略 = 探全部已启用服务）。
  清单为空、或某个工具报「不存在」时用它刷新；单独探一个失败即失败，全量探查在 servers 里逐服务回报。
- api.mcp.call(server, tool, args?)：调用一个工具。**参数按该工具公布在 list / discover 里的说明给**——
  拿不准就先看工具的 description，不要猜。返回服务端的文本结果；失败不抛异常（回 { ok:false }），
  按值判断，不要用 try/catch。
- 这些是真实外部系统（数据库、文件、网页服务……）：**写操作与不可逆动作先 api.ask 确认**；
  一次编排里把 list → call 的链路写完，中间结果不要写进对话。`,
  },
  {
    key: 'res',
    title: '资源库',
    text: `目标资源库（api.res.*）——这份规范在你第一次读写静态资源时注入：
- 清单/详情/读/建/改/删/引用扫描全部走 api.res.*（先 await api.res.__help() 查用法）；
- 图片与静态资源物理存放于 docs/目标/static/，但**不要用 api.files.* 直接读写**——那是应用数据；
- 在文档和讲义中引用静态资源使用标准 Markdown 格式：![说明](moji:static/{uuid})。`,
  },
  {
    key: 'exam',
    title: '试卷与考试',
    text: `试卷与考试——两层结构与严密读写边界：

一、试卷是节点，出题走节点宇宙
- 出题：api.node.create({ kind: "exam", under: 文档uuid }) 建卷（画布上的空壳会被原位复用）→ await api.node.get(卷uuid).help() 看**题目 JSON 契约**（题型、options、answer、rubric、image 的完整格式都在它身上）→ editContent({ title, kind, level, minutes, questions }) 落卷。历次作答（attempts）不在 content 里，也绝不会被动到。
- 两阶段流程：出题（如上）→ 交卷后 api.exam.read() 看作答、api.exam.grade(...) 判分、api.exam.explain(...) 写讲解。读任何时候都能调；判分与讲解受阶段约束。

二、读写权限与严格边界（哪些能写、哪些绝对禁止篡改）
- 🔒 用户事实层（只读！Agent 绝对禁止篡改）：
  - attempt.id（attemptId）、startedAt、endedAt、forceSubmit、overtimeMs：真实的开考与交卷时戳；
  - attempt.dwell（各题驻留毫秒数）、attempt.blurs（切屏记录）：衡量作答犹豫度与防作弊的事实数据；
  - attempt.answers（用户填写的最终答案）、attempt.inputs（用户作答敲击流记录）：用户的原始作答铁证。
- ✏️ Agent 评价层（Agent 唯一允许填写的字段）：
  - attempt.status：设为 "graded"；
  - attempt.results：逐题判分数组 [{ questionId, correct: boolean, score, maxScore, comment: "错题点拨", by: "agent" }]；
  - attempt.passed：是否通过（boolean）；
  - attempt.summary：综合成绩与掌握分析（字符串）；
  - attempt.explanation：针对错题的详尽步骤推导与 Markdown 解析。
- ❌ 严禁行为：绝不用 api.files.* 直接读写节点文件；绝不改写用户作答事实（answers / inputs / dwell / blurs）；绝不改动或覆盖之前的历史 attempts 作答轮次。

三、「出卷」流程（「出卷」工作流的执行规程）
- 摸清可考范围：const n = await api.node.get(目标节点uuid) 读教学文档（c.teaching.slice 分段看），笔记与上级、同层内容看 api.node.list()。**可考范围 = 这些已有内容 + 学科常识**——出卷只消费内容，不生产内容：补讲、写文档、调整树都与出卷轮无关。文档还空着时两选一：出**导学卷**（围绕节点标题与上级文档），或 api.ask 问「先出导学卷还是等文档生成后再出？」。唯独「先建节点补内容再出卷」不是。
- 问一次：api.ask 出一张表单——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项写清题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）；最多再加一道「有没有特别想考的章节」。**不要多问**（响铃已由系统做好，不必再调 tiktok）。
- 定时限：随堂小测不限时（minutes: 0）；其余按题量与难度估 minutes，下限 = 题目数 × 2，宁可宽一点。
- 检索查证与落卷：**积极 api.web.search** 检索权威真题、标准题型、规范公式，并 **api.web.fetch 读 1~2 份真题原文**确认题型结构再命题，严禁凭主观意志编造。然后 api.node.create({ kind: "exam", under: 目标节点uuid })（空壳原位复用）→ await api.node.get(卷uuid).help() 对一眼格式 → editContent({ title, kind, level, minutes, questions }) 一次落卷。数学公式 LaTeX；需要图形的题给 image（完整 SVG）。
- 收尾：对话里告诉用户试卷已生成并列出名称与题量，请用户开始作答。

四、「阅卷」流程（「阅卷」工作流的执行规程；一次 execute 连着做完，不分两轮）
- 第零步：await api.exam.__help() 把 grade / explain 的参数查清楚再动手。
- 读卷：api.exam.read() 读当前节点的试卷与 attempts（给了「作答记录」attemptId 就读那一次，否则取最新）。**用户的 answers / inputs / dwell / blurs 是客观事实，严禁修改篡改任何字符**。
- 判分：客观题对照参考答案、填空与简答依据 rubric，**一条 api.exam.grade({ attemptId, passed, summary, results }) 落账**（results = [{ questionId, correct, score, maxScore, comment, by: "agent" }]）。不要手写数据文件。
- 讲解：api.exam.explain({ content, attemptId }) 写详尽的步骤推导解析（Markdown），它自动打开试卷副本。
- 收尾：const n = await api.node.get(目标节点uuid)；const c = await n.content; c.status = passed ? "mastered" : "learning"; await n.editContent(c) 修正掌握状态；高频薄弱错法用 api.state.mistake(目标节点uuid, { pattern, cause }) 记进错误记忆。
- 指令给了「目标节点」就只动它；**没给**就 api.node.list() 凭上下文判断（判断不了 api.ask）。`,
  },
  {
    key: 'superlab',
    title: '超级实验室',
    text: `「超级实验室」工作流——在目标节点做一份**超级文档**：可交互的实验或小工具，用户在页签里点、文档干活并显示结果。本轮的交付物就这一份实验；知识树、教学文档都不动。
- 问需求：api.ask 问用户想做什么实验 / 需要什么功能（一道简答题，给两三个贴合当前节点主题的示例选项帮他起意）。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。
- 先想后写：确定实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。
- 落盘：指令给了「超级文档」（一份空壳的 uuid）就**写它**——const lab = await api.node.get(壳uuid)；没给就 const r = await api.node.create({ kind: "superdoc", title: 实验名, under: 目标节点uuid })。然后 await lab.help() 看格式规范（主题变量、moji-markdown、大小上限都在里面），await lab.editContent({ html }) 写入一份完整可运行的自包含 HTML（名字不含 .html 后缀）。复杂计算函数用 api.method.create 保存、页面里 window.api.method.call 调用。
- 收尾：api.ui.superdoc('#'+目标节点uuid, '实验名') 打开该页签，再用一两句话告诉用户这个实验能玩什么。目标节点没给就 api.node.list() 凭上下文判断，判断不了 api.ask。`,
  },
  {
    key: 'explain',
    title: '了解（词条注解）',
    text: `「了解」工作流——用户在文档里选中了一个词、点了「了解」，想要一句能挂在这段文字旁边的解释。严格按顺序做：
- 先看它在讲什么：const n = await api.node.get(目标节点uuid)；const c = await n.content；取 c.teaching.slice(0, 2000) 读**这一段所在的上下文**。解释要贴着这篇文档讲——它在这里是什么意思、为什么这么说，而不是给一段百科式的通解。
- 写注解：给 c.annotations 追加一条 { term: 词条, occurrence: 出现序号, body: '注解内容' }（其余条目原样保留），await n.editContent(c) 写回——注解就划在正文对应位置；同时可用 api.node.create({ kind: 'note', title: '词条解释', under: 目标节点uuid }) 把解释记进一份笔记。
- 回话：一句话就够（例如「已把该词条的注解标在正文上」）。不要把那段解释再在对话中抄一遍。`,
  },
  {
    key: 'teach-method',
    title: '教学文档生成',
    text: `「教学文档生成」方法——为知识节点产出一份针对性教学文档的完整流程。触发它的指令只给任务与参数，步骤一律照这里执行：

一、先查再用
- 本轮会用到 api.node.*、api.state.* 与 api.ask。动手前先 await api.<组>.__help() 把签名与示例查清楚，不要凭记忆猜参数。
- 目标与节点现状用 api.node.list() 现查（回执带全图 uuid 与挂件清单）；要动当前这份文档，就 const n = await api.node.get(它的uuid)、await n.help() 看它自己的写法。

二、前置知识与多源检索
- 结合节点标题、上游节点的文档与学科判断，列出学会这个主题**绕不开的前置知识点**（一般 3~6 条：太少说明没拆开，太多说明没抓住主干）。
- **必须积极使用 api.web.search 与 api.web.fetch** 检索当前主题的权威讲义、官方文档或前沿实践，并**挑 1~3 篇最权威的原文用 api.web.fetch 读正文**比对提炼（只看 snippet / summary 不算调研），严禁凭模型自身主观意志捏造教学内容。
- 前置知识只进摸底表单与讲义正文，**不落成节点**——树由学习者在画布上生长（点大纲目标项挂文档、再逐个生成）。

三、摸底提问
- 用 api.ask 出一张表单，每条前置知识一道单选题「这个我已经掌握 / 会一点 / 完全不会」。表单会压在输入框上方，用户答完才继续——不要自问自答，也不要跳过。（触发响铃已由系统做好，不必再调 tiktok。）

四、想清楚再动笔
- 按摸底结果定详略：「完全不会」的前置在文档开头的**「预备知识」一节先补讲**（每条几段讲够用即止），「会一点」的点到为止，「已掌握」的直接用。
- 想好文档结构：先讲什么、后讲什么、在哪衔接补讲的内容。前置之外的延伸方向留给文末「下一步」，不进正文。

五、生成
- 标题已就位，一般不动；明显词不达意才连标题一起改。const n = await api.node.get(uuid)；const c = await n.content——描述空着就把 c.description 写成 150~300 字，然后 c.teaching = 讲义，一次 await n.editContent(c) 写回（整份替换，先读后写）。循序渐进、先直觉与例子再定义与推导，对摸底暴露的盲点**正面讲解**。排版以当前「文档格式」策略为准，结构配方见「文档排版与图表」模块：至少两三处结构性元素，不要交一篇纯文本。
- 使用了网络检索时，文档末尾必须带「## 📚 参考资料与权威来源」区块声明真实网址与名称，并在收口前 api.delivery.submit({ files, sources }) 登记本轮的文件变动与来源（对话正文不用再复述清单）。
- **本轮不拆下一层大纲**（"o:"+uuid 的大纲节点不要动）：拆层是「生成大纲」流程的事，由用户在画布上触发；就算教学路线明显分阶段，也只把延伸方向写进文末「下一步」一节。

六、状态记账与收尾
- 用 api.state.read(uuid) 看学习状态：有错误记忆的这次讲解要正面处理那个错法；把摸底结果用 api.state.update / api.state.mistake 按用户的答案记准。用户留空的题当「会一点」处理，不要追问。
- 写完用 api.ui.point() 把这份教学文档在文档区打开（已开着就切到它），请用户看刚生成的文档；若用了网络检索，对话回复里必须声明参考资料链接。

七、任务边界（硬性）
- 「开讲」是一次内容生成，不是建树：api.node.create 一个都不要调，也不要拆下一层大纲（"o:"+uuid 的大纲节点不要动）——拆层是「生成大纲」流程的事，由用户在画布上触发。
- 指令给了「目标节点」就只写它；**没给**就先 api.node.list() 看现状，凭上下文判断这份讲义该落在哪个节点（判断不了就 api.ask 问一次）。
- 若随指令附带了选段定位等上下文（这份文档落地哪条大纲目标项），以它为准。`,
  },
  {
    key: 'goal-outline',
    title: '学习大纲',
    text: `「学习大纲」工作流——用户刚新建的目标的**第一轮**。用户的原话与参考资料在会话首条消息中，当前根节点的标题还是用户原话的临时形态；随指令附带的具体材料（文件、项目路径、大纲图片）必须优先研读。

【第零步｜先判断这是哪一类目标（最重要，别跳过）】
两类目标的差别只有一条——**要不要一棵知识树**：
- **学习型**：用户想系统掌握一个领域（「从零学微积分」「系统学 Rust」「备考」）。交付物是**大纲树 + 逐节点讲义**，节点由浅入深、彼此有依赖。
- **任务型**：用户只想让导师陪着把**一件具体的事**做完——读一个代码项目、精读一篇论文、弄懂一份报错或文档、临时答疑。这类目标没有长期路线，硬造大纲树只会塞满用户永远不会点开的空节点；交付物是**根节点文档**，要深入时用户会自己点名某个方向，那时再建**那一个**子节点。

按下面的顺序判，命中即定，**不要凭感觉**：
1. **先看有没有具体制品**：一个项目目录、一篇论文、一份报错日志、一段代码、一份外部文档。有 → **任务型**（用户要的是把这份东西读懂，不是学一门课）。
2. **再看有没有长期意图**：「系统学 / 掌握 / 从零学 / 学习路线 / 分阶段 / 备考 / 课程」。有 → **学习型**。
3. **都没有**（例如只有一句「帮我看看这个」「我想搞懂 X」）→ 按**任务型**处理：先把这件事在一份根节点文档里讲清楚。用户真要长期学，下一句会说，到时再补大纲完全来得及。
4. **只有一种情况值得问**：同一句话里同时要「长期系统地学」和「只读我给的这一份材料」，两种走法的交付物差别很大。这时才用 api.ask 问一次（题目「这次想怎么用这个目标？」，选项：A 长期学习，拆成知识树 / B 一次性任务，只读这份材料）。**除此之外不要问**——反复确认比偶尔走错更烦人，而且走错了也好补救。

【任务型｜只建根节点与根节点文档，绝不建大纲树】
动手前先 api.node.list() 拿根节点 uuid，const root = await api.node.get(根uuid)、await root.help()。
1. **先把文档打开**：api.ui.point() 打开根节点文档——用户要看着它长出来。
2. 改标题：const c = await root.content; c.title = 主题名（读项目用项目名，读论文用论文标题短名）; await root.editContent(c)。
3. description 写 100~200 字，说清这次要解决什么、材料是什么、边界在哪。
4. 把根节点文档写成**这次任务的交付物**（editContent 的 teaching）：读项目先给定位与目录导读再讲核心模块、关键数据结构与上手路径（引用**真实**文件路径）；读论文按「问题 → 方法 → 实验 → 结论 → 局限」精读；答疑先给结论与依据。一律基于**真实读到的内容**（节点 content / api.web.search / api.web.fetch），禁止凭印象编造；用到网络资料按既有规范在末尾写「## 📚 参考资料与权威来源」并用网页 chip 声明。
5. **不要**用 api.node.create 建任何子节点，**不要**写根节点的大纲（"o:"+根uuid 的 editContent 不要调）——大纲保持空白是正常状态。
6. 收尾用一两句话告诉用户「读了什么、从哪开始看、接下来可以让我深入哪一块」。之后用户点名要深入时，再 api.node.create({ kind: "doc", title, under: 根uuid }) 建**那一个**子节点，不要提前铺开。

【学习型｜先 api.ask 确认创建模式（强制）】
表单题目：选择目标创建模式（单选）
- 选项 A: 探索式（默认：生成根节点文档和初步大纲，后续节点由用户逐步确认生成）
- 选项 B: 规划式（先规划再执行：生成根节点文档，并通过多源深度网络调研生成完整大纲树）
- 选项 C: 完整式（一次性全套交付：完整大纲树 + 所有节点的完整教学文档）

【多轮确认纪律（规划式二次、完整式三次）】
- 探索式：选完立即执行。
- 规划式第二次确认：api.ask（标题「确认规划完整大纲树」，说明将网络调研行业规范与课程大纲、耗时稍长），选项「确认开始规划完整大纲树」/「返回修改为探索式」。
- 完整式第二次：api.ask（标题「耗时与生成规模评估」，说明一次性生成全部讲义消耗较多轮次与时间），选项「了解耗时，继续确认」/「返回修改为探索式」。第三次：api.ask（标题「最终确认启动全量生成」，提示保持网络通畅），选项「确认立即启动全量生成」/「取消并改为探索式」。

【学习型第二步｜命名与描述】
const root = await api.node.get(根uuid)；const c = await root.content。c.title = 准确的主题名（长成数据目录名，去掉问句成分）；c.description = 150~300 字目标描述；一次 editContent 写回。再取一次 content 把 c.teaching 写成总述（概述知识体系与起步建议）。参考了网络资料时**末尾必须带「## 📚 参考资料与权威来源」并使用网页类 chip**（#[{"type":"web","url":"...","title":"..."}]），严禁普通 Markdown 超链接；chip 的 title 精炼（15~25 汉字以内）。

【学习型第三步｜按所选模式执行】
- **探索式**：const o = await api.node.get("o:"+根uuid)；o.editContent({ intro, children }) 写根大纲（intro 一两段阶段划分，children 只写一层，每项 { title, summary }）。后续节点由用户逐步确认生成。
- **规划式**：积极 api.web.search 检索行业规范与权威学术大纲，**逐个 api.node.create({ kind: "doc", title, description, under: 父uuid }) 生成完整大纲树**（各层大纲用 "o:"+uuid 的 editContent 填）。
- **完整式**：在规划式的基础上**并为所有节点的 teaching 写入详尽讲义**（每篇末尾以网页类 chip 声明权威来源），一次性交付全套。
全部完成后 api.ui.point() 打开根节点教学文档并在大纲页呈现完整学习路线；任务型按第 6 条收尾。`,
  },
  {
    key: 'outline-method',
    title: '大纲编写',
    text: `「大纲编写」方法——为知识节点规划一份「这一层往下怎么学」的计划文件。触发它的指令只给任务与参数，规矩一律照这里执行：

一、先查再用与看现状
- const o = await api.node.get("o:" + 文档uuid)；await o.help() 看大纲节点自己的说法。
- await o.content 看已有大纲（**有就整份重写，不要追加**；null = 还没写过），api.node.list() 看标题、描述与现有下级节点，await 节点.content 后取 teaching.slice(0, 2000) 扫教学文档的开头与标题结构（不要整篇读）。

二、多源检索与规划
- 多使用 api.web.search 与 api.web.fetch 获取该知识分支的权威分类目录与行业标准脉络——搜到之后要**用 api.web.fetch 打开其中最权威的 1~2 份大纲 / 目录读原文**再拆分层，只看摘要就动手等于凭印象臆造。
- 这一层往下拆成哪几个**阶段目标**（一般 3~8 个，每个都能独立成篇、有明确的「学完会什么」）。已经有下级节点的，计划要与它们对齐——同一个人同一层不该有两套说法。

三、落盘
- await o.editContent({ intro, children })：intro 一两段（这一层按什么路线走、为什么这么分）；children 每项 { title, summary }，summary 两三句——学什么、为什么排在这个位置。key 由标题自动生成，不要自己编。
- 收尾：写完用 api.ui.point() 打开大纲页，让用户看着路线更新。

四、任务边界（硬性）
- 只写直接子层级一层为止；本轮**不建节点**（目标项长成文档是「生成文档」流程在画布上做的事）。
- 已有下级节点的，计划要与它们对齐——同一个人同一层不该有两套说法。
- 指令给了「目标节点」就只写它那一层；**没给**就先 api.node.list() 看现状，凭上下文判断该规划哪一层（判断不了就 api.ask 问一次）。

四、深度与树的生长规矩（硬性）
- 只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」。孙辈的大纲由那些子目标自己的大纲负责；children 里不要出现「1.1.1」这类两层以下的东西，summary 里也不要替孙辈规划。
- 大纲只是当前节点的一份**计划文件**：目标项落地成文档由学习者在画布上驱动（点目标项挂文档、逐个开讲）——计划与落地是两段流程，写大纲的一轮不建节点。

五、收尾
- 写完用 api.ui.point() 把这份文档在文档区打开，让用户在大纲页里看这一层的路线。`,
  },
  {
    key: 'prereq-outline',
    title: '前置知识大纲',
    text: `「前置知识大纲」工作流——给**还没拆过的文档**定「学它之前要先会什么」。流程照「大纲编写」那份声明的走（先看现状、多源检索读原文再拆层、落盘、写完打开大纲页），差异只有两处：
- 提炼的是**前置知识**而不是往后学的阶段：不会它们就学不动这个节点，一般 3~6 条；已有的下级节点不算前置——它们是往后学的。
- children 每项的 summary 写清「这条前置要会到什么程度」，**够用就行**，不要展开成完整课程。

边界：只负责计划——目标项长成文档是「生成文档」流程在画布上做的事，本轮产出里没有新节点；写完在对话里用两三句说清定了哪几条前置、为什么。指令给了「目标节点」就只写它；没给就 api.node.list() 凭上下文判断，判断不了 api.ask。`,
  },
  {
    key: 'learning-process',
    title: '学习过程',
    text: `学习过程记录（api.reading.* / api.attention.* / api.focus.*）：
- 有效阅读事实走 api.reading.get / api.reading.list / api.reading.day；
- 注意力评级走 api.attention.get，专注模式状态走 api.focus.status（只读）；
- 日程走 api.schedule.*（list / create / update / complete / remove）：给用户排提醒，
  到点由宿主响铃、用户自己确认或稍后提醒——不要替用户确认，也不要 sleep 等它到点；
- 学习状态的写（掌握度/错题/检验）走 api.state.*，不要用 api.files.* 碰 reading.json 或 meta.json。`,
  },
  {
    key: 'workspace',
    title: '工作区',
    text: `工作区目录（api.workspace.*）——用户交付物的落点：
- 每个节点的工作区物理目录为 docs/.../workspace/，在磁盘上真实存在；
- 列/读/写优先走 api.workspace.*（list / read / write，先 await api.workspace.__help() 查用法）；
- api.files.* 也可以操作 workspace/（它是少数对 files 开放的应用目录），但结构化读写请用 api.workspace.*。`,
  },
  {
    key: 'method',
    title: '持久化函数',
    text: `持久化函数（method，按目标归档、跨对话有效）——这份规范在你第一次读写持久化函数时注入：
- api.method.create({ name, code })：把一段**可执行的函数源码**存进这个目标的函数库。
  code 写成匿名 async 函数，**第一个参数是 api**（整套沙箱 api 都在），其余参数是调用方传的实参：

      api.method.create({ name: '统计句号', code: "((api, uuid) => { const n = await api.node.get(uuid); const c = await n.content; return { count: (c.teaching.match(/。/g) ?? []).length, size: c.teaching.length } })" })

- 同名 create 就是**覆盖**（那是更新一个函数，不是重复建）。创建时会编译校验，
  编不过的当场被拒并给出原因。list() 只回名字与体量；delete(name) 删一个。
- api.method.call(name, ...args)：执行一个函数（注入当前编排的 api），返回它的返回值。
  在你的编排里它是「把一段逻辑打包重用」的办法；更重要的是——**超级文档里的脚本只能靠它干活**：
  超级文档的按钮写 api.method.call('统计句号', '极限')，宿主执行的就是你存的这份源码。
  所以「要在超级文档里复用的逻辑」都该落成 method，而不是只写在某次编排里。`,
  },
  {
    key: 'code',
    title: '代码块伪编译',
    text: `代码块伪编译（code）——这份规范在你第一次交付伪编译产物时注入：
- api.code.save({ key, js, note })：交付一份伪编译产物。用户点了文档里代码块上的「编译」时，
  会有一条「伪编译」工作流消息进来（带着 key、语言标记与那段代码）。你转译完调它交货，
  那一块代码下面的「运行」就会亮起来——产物存在数据目录里，重启还在。
- js 必须是**完整、自包含**、能在 Web Worker 里跑的代码（没有 DOM、没有 require/import，
  顶层可以用 await，要出结果就 console.log）；key 原样抄，代码原文不用回抄（宿主按 key 认得）。
- note 是你补的那些假设，一两句话，它会显示给用户。
- **先判有没有输出**：如果这段代码只有定义（类型、接口、函数、类、常量），没有任何会被执行的
  语句、也不会打印任何东西，那就**立刻停止、不要写 js**，改调 api.code.silent({ key, reason })
  把那一块标成无输出（之后它不再显示编译与运行）。这不是失败，是这类代码块的正常归宿。
  分寸：只要有哪怕一句会被执行的语句（一次调用、一个 print、一段循环、一次赋值后使用），就往下走，
  别把能跑的代码判成无输出。
- **残缺片段是常态**：那段代码多半从文档里摘出来时缺了上下文（少函数定义、少变量、少 import）。
  api.node.get(所属文档uuid) 后读 content.teaching，从文档里把缺的东西补齐；文档里也找不到的，
  按代码里的用法**模拟一份合理的假上下文**（假数据、假函数都行），让整段代码跑出可见结果——
  **绝不要**因为片段不完整就回一句「无法编译」。
- 运行环境就是一个 Web Worker：没有 window / document / DOM，没有 require / import / export，
  装不了 npm 包；可以用 console.log、await、Promise、setTimeout、Math / JSON / Date / 正则、
  TextEncoder / TextDecoder、crypto、URL；顶层可以直接 await；fetch 能用但要用户点一次同意。
  要让用户看见结果就必须 console.log（对象会被结构化显示）。
- 交货纪律：key 原样抄（别改也别自己编）；js 是完整自包含的可执行语句（不要包一层函数）；
  note 一两句中文说明补了哪些假设。**save 必须调**——不调那块代码的「运行」永远不会亮。
  代码原文不用回抄，也不要在对话里整段复述产物。`,
  },
  {
    key: 'essay-commit',
    title: '随笔整理',
    text: `「随笔整理」工作流——用户提交了**当前的全部随笔**，把与上次相比的增量整理进知识树的笔记。快照是完整的，但之前的提交已经整理过其中大部分：只处理**新增、修改、删除**的部分，别把未变化的内容重做一遍。
1. 先看知识树（api.node.list() 拿全部节点、大纲与挂件清单——每份笔记的 uuid 都在回执里），并读一读【已有整理记录】提到的那几份笔记，弄清上次整理到哪儿了。
2. **只处理【本次新增的随笔】【本次修改的随笔】【本次删除的随笔（只剩标题）】**；【本次未变化的随笔】只用来理解上下文，**不要再写一遍**；【已有整理记录】里的内容已经进过笔记。
3. 修改类随笔只给了改动处（>>> 新增 / 改动 <<< 之间）：把这段改动**合并进上次对应的笔记**，保留其余段落；确实要整篇写回时，先 await api.node.get(该笔记uuid) 取 content 读全文，改完 editContent 写回，不要整篇重写。
4. 新增内容与某份已有笔记主题相同就合并进去；该节点还没有合适笔记时才新建「随笔整理」：api.node.create({ kind: "note", title: "随笔整理", under: 该文档uuid }) 后 editContent({ text })。
5. 归不进任何已有节点的：并进最合适上级节点的「随笔整理」笔记；只有内容足够独立、值得单独成节时才 api.node.create({ kind: "doc", title, under: 父文档uuid }) 建子节点再给它建笔记。
6. 删除类随笔：只在对应笔记里**清理只来自它的段落**，或改写进更合适的位置；不要因为一条随笔被删就删掉整份笔记。
7. 只保留有长期价值的知识、结论、疑问与例子；合并重复内容，不要逐句照抄，不要编造材料里没有的东西。整理后的笔记要能独立读懂。
8. 每改完一处，在回复里用一行列出「节点路径 → 笔记名（新建/更新）」。
9. 最后为这次提交写一条**提交评论**，放在下面这对标记之间（两行标记必须原样保留，一个字都不能改；标记之间是 Markdown，**第一行是标题**——一句话概括这次整理，之后两三句正文说明把哪些内容归到了哪些节点、留下了什么疑问）。
<!-- essay-commit-comment
## （标题）
（正文）
-->`,
  },
  {
    key: 'plot-fix',
    title: '修复函数图像',
    text: `「修复函数图像」工作流——文档里一个 \`\`\`plot 渲染失败，按报错与区间一次改完。**一轮完成，不要验证渲染结果**（没有渲染通道），验收标准就是下面的硬要求。
- 修复（读 → 拼回 → 整份写）：const n = await api.node.get(目标节点uuid)；const c = await n.content；c.teaching = c.teaching.slice(0, 起始偏移) + 修好的完整围栏 + c.teaching.slice(结束偏移)；await n.editContent(c)。
- 修好的围栏必须满足（这就是验收标准）：是完整的 \`\`\`plot 围栏（含首尾两行标记）；JSON 能通过 JSON.parse；data 非空且每项有 fn；xAxis / yAxis 只能是对象（区间用 domain 写），不能写成字符串；函数变量固定用 x（参数方程用 t，极坐标用 theta）。
- 字符区间是 [0, 0)（未能自动定位，文档可能刚被改过）时：先在 c.teaching 里按围栏原文 indexOf 找到这段围栏，换算出区间再拼回。
- 改完立即 api.delivery.submit 登记修复。不要读整篇文档，不要尝试渲染验证，不要复述修复过程。`,
  },
  {
    key: 'compact',
    title: '上下文压缩',
    text: `上下文压缩（compact）——这份规范在你第一次提交交接摘要时注入：
- api.compact({ summary, tasks })：把这段对话折成一份交接摘要。**你不是自己想压就压**——
  用户点了「压缩上下文」，或者上下文快到阈值时，会有一个工作流把整套要求给你（见工作流那一份指令）。
- 两个参数：tasks 是**还没做完的事**（逐条，写到能照着继续干：哪个节点、哪份文档、卡在哪一步），
  summary 是正文摘要（目标与背景 / 已讲清的内容 / 学习者的状态 / 约定与术语）。
- 它**不立刻生效**：摘要先记下，等本轮 loop 结束后旧消息才失活、摘要成为第一条消息。
  所以别重复调用，也别把摘要复述给用户。摘要太短会被拒（原始消息没了，摘要就是唯一的上下文）。
- 摘要的写法（按顺序）：
  1. 先列 tasks（**最容易丢、也最要命**）：这几轮里用户要的但还没交付的、正做到一半的、答应过
     还没做的，逐条写清——哪个节点、哪份文档、哪个文件名、卡在哪、下一步做什么。要能让
     「换一个人接手」照着继续干，不要写「继续完善文档」这种空话。做完了的不列。
  2. 再写 summary（Markdown）：## 学习目标与背景 / ## 已经讲清的内容 / ## 学习者的状态
     （自评、错在哪、还卡在哪）/ ## 约定与术语。用户表达「我想要什么」的话保留原意。
  3. api.compact({ summary, tasks }) **只调这一次**；不要顺手改文档、建节点、出题。
  4. 回一句话告诉用户已经压好，**不要复述摘要内容**。
- 硬性要求：只写对话里真实出现过的东西——不推测、不补常识、不编造；概念名、公式、文件名写全；
  summary 控制在 1200 字以内。`,
  },
  {
    key: 'subagent',
    title: '子代理',
    text: `子代理（subagent.*；把独立的活**并发地**派出去）——这份规范在你第一次派子代理时注入：
- 范式：**脚本创建 → 脚本执行 → 脚本等待**（都在一次 execute 里写完）：
  api.subagent.create({ key, name?, system, tools? }) 登记定义（system 写清角色、工作方式与
  **交付纪律**；tools 是它 execute 开放的 api 组，不给就是 web + tmp）→
  api.subagent.run({ agent, task }) 启动（**立即返回**，任务在后台跑；一次 run 多个 agent 就并发）→
  api.subagent.wait({ seconds }) 收交付。
- **task 要自包含**：子代理看不到你们的对话，要做什么、什么口径、交付什么格式全写在 task 里。
- agent 认 key（name 是显示名，碰巧同名也能对上）；**一个 key 同一时刻只跑一个任务**——要并发
  就建多个 key 再一起 run。别和 web.search 的 engines 并行混谈：那是同一次调用里并行搜多家，
  两种「并发」不是一回事。
- **wait 必带最大时长 seconds**（按任务难度主观定）：有挂起交付立即全部返回；否则监听所有在跑的，
  **任何一个先完成就立即返回它**（回执含 deliveries 与仍在跑的 running 清单）；到点没人交付返回
  timedOut。没有在跑也没有挂起时立即返回空。
- **监督回路（防钻牛角尖）**：wait 超时 → api.subagent.view(agent) 看 recent 里它最近在干什么 →
  确实在打转就 api.subagent.intervene(agent, 指令) 纠偏（指令在它当前这条消息输出完整后插入，
  绝不打断半截输出）；走得正常就再发起一轮 wait。
- 交付时没人在等就**挂起**，不会丢：下一次 wait 把积压的一起返回。execute 结束时仍有 agent 在
  后台跑是正常的——之后任何一次 execute 里都可以继续 wait 收。
- 中断与收拾：interrupt（中断，上下文保留）/ resume（从断点接着跑）/ delete（删定义与会话）。
  用户点「停止」会中断当前所有在跑的子代理。
- 什么时候派：费上下文的体力活（大量检索、通读长文档、批量核实）派出去，把你的上下文留给教学本身。
- 检索类任务的模板：create 一个 tools:["web","tmp"] 的检索代理，system 里写死止损纪律——摘要先筛、
  有明确网址直接读；同一页面/引擎/措辞绝不重试第二次；连续两步没有新信息就收手交付；结论先行、
  关键事实带来源 URL、体量跟任务匹配。web.search 引擎全挂会**自动用 baidu/bing 降级补搜**
  （不用在 task 里重申降级规矩）；回执带 searchedAt，结果里的「2 天前」这类相对时间按它折算。`,
  },
  {
    key: 'ui',
    title: '界面操作',
    text: `界面操作（ui；文档区没有打开的文档时，point / scroll / screenshot / dom 会明确失败）——这份规范在你第一次操作界面时注入：
- api.ui.toast('一句话')：弹一条吐司提示（轻量的告知；需要用户做动作的用 ask）。
- api.ui.point(path?, { line?, regex?, flags? })：在页签里打开/切到某个节点的文档
  （path 规则与 doc.* 一致，省略 = 当前节点的教学文档）。line 定位到某一行，
  regex 选中第一处匹配的文字——「我说的就是这一段」时用它指给用户看。
- api.ui.superdoc(path?, name)：打开/切到某节点的一份超级文档页签
  （sdoc.write 写完用它展示给用户；那份文档已被删时回执会说明，别再指给用户看）。
- api.ui.scroll({ to: 'top' | 'bottom' } 或 { by: 像素 })：滚动**文档区**（by 负数往上）——
  滚的不是内置浏览器的网页页签，滚页面用 api.browser.scroll。
- api.ui.screenshot()：截取文档区，图片会附在你的下一步里（与 res.read 读图同一条通道；
  截图同时存进了资源库，res.list 看得到）。讲解里想引用它：![说明](moji:static/uuid)。
- api.ui.dom(async (root) => { … })：回调拿到**文档区**根节点的**门面**（作用域只有文档区——
  浏览器页签里的网页不在内，查网页元素回 false/空是正常的，那要用 browser.text/snapshot），
  可以查看渲染结果、点文档里的按钮：root.query(sel) / root.exists(sel) / root.count(sel) /
  root.text(sel, i?) / root.attr(sel, name, i?) / root.html(sel, i?) / root.rect(sel, i?) /
  root.click(sel, i?)。全是异步的（每个操作回到宿主执行）；适合「确认渲染成了什么样」
  「帮用户展开某个面板」，不要拿来批量轮询。`,
  },
  {
    key: 'plot-forms',
    title: '函数图像的数据形态',
    text: `函数图像的 data 各形态（\`\`\`plot 的完整数据写法）——这份规范在你第一次写函数图像时注入。data 数组每项取下列形态之一（points / parametric / polar / implicit 必须写 graphType，否则会当成区间采样而报错）：
1) 显式函数：{ "fn": "x^2" }
   可加切线：{ "fn": "x^2", "derivative": { "fn": "2*x", "x0": 1 } }
   可加割线：{ "fn": "x^2", "secants": [{ "x0": 0, "x1": 1 }] }
   可指定颜色：{ "fn": "sin(x)", "color": "#a8432f" }
2) 参数曲线（变量用 t）：{ "graphType": "polyline", "fnType": "parametric", "x": "cos(t)", "y": "sin(t)" }
3) 极坐标（变量用 theta）：{ "graphType": "polyline", "fnType": "polar", "r": "1 + cos(theta)" }
4) 散点：{ "graphType": "scatter", "fnType": "points", "points": [[1, 1], [2, 4]] }
5) 向量：{ "graphType": "polyline", "fnType": "vector", "vector": [2, 1], "offset": [0, 0] }
6) 隐函数（用 interval 采样，需同时给 graphType 与 fnType）：
   { "graphType": "interval", "fnType": "implicit", "fn": "x^2 + y^2 - 1" }

其余写法要求：
- 表达式里只能用数学函数与四则运算，不要出现浏览器对象或函数定义。
- 图像默认不可缩放（避免在文档里滚动时误触），需要交互缩放时加 "disableZoom": false。`,
  },
  {
    key: 'rich-animation',
    title: '富媒体动画写法',
    text: `富媒体动画（现成的文档动画、SVG SMIL 与内嵌 CSS 动画）——这份规范在你第一次写动画内容时注入。
动画要克制：同一屏最多一两个，服务于讲解本身，不做装饰性干扰。
- **先用现成的四个**（正文里当工具类写，见「文档排版与图表」那份规范）：animate-doc-fade、
  animate-doc-rise、animate-doc-grow（配 origin-bottom 做柱子）、animate-doc-draw
  （配 pathLength="1" 与 stroke-dasharray="1" 描线）。九成的「动起来才看得懂」用这四个就够。
- SVG 内嵌动画（用 SMIL，适合「动起来才看得懂」的过程：波的传播、向量旋转、
  极限逼近、函数变换）。可用 <animate>、<animateTransform>、<animateMotion>、<set>，
  并为动画加上 repeatCount="indefinite" 让它循环：
  <svg viewBox="0 0 200 60"><circle r="6" fill="#a8432f">
    <animateMotion dur="3s" repeatCount="indefinite" path="M10,30 L190,30"/></circle></svg>
- 内嵌 CSS 动画（用 <style> 定义 @keyframes 做持续运动；适合脉冲、高亮、旋转）：
  <style>.moji-demo-pulse{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}</style>
  <span class="moji-demo-pulse">正在闪烁的要点</span>
- 内嵌 <style> 里的每条选择器都必须带一个本项目独有的前缀（如 .moji-demo-xxx），
  避免样式泄漏到页面其它位置；建议每个动画用不同的前缀。
- SVG 里给 fill / stroke 用具体颜色或 currentColor，深色与浅色模式下都要能看清
  （不要只用纯黑或纯白）。
- 内嵌 HTML 必须闭合良好；不确定能否渲染的写法就退回纯 Markdown。`,
  },
  {
    key: 'doc-html',
    title: '文档排版与图表',
    text: `文档排版与图表（教学文档的 HTML + Tailwind 配方）——「开讲」「学习大纲」这两条工作流会在动笔之前
把它交给你；其它场合则在你第一次写教学文档之后注入。

**先看这一条**：通篇只有标题和段落的文档不算讲义（渲染器给裸标签的只是兜底样式）。
每一份教学文档至少要落下 2~3 处结构性元素——Markdown 原生的引用块、表格与图表围栏，
或下面这六个 HTML 配方；用哪种、以谁为主，以你当前收到的「文档格式」策略为准。

同一段内容的两种写法，差别就是「草稿」与「讲义」：
  草稿：<h3>三种变化率</h3><p>平均变化率是一段区间上的快慢，瞬时变化率是把区间压到零。</p>
  讲义：<h3 class="mt-7 mb-2 text-[1em] font-semibold text-ink-strong">三种变化率</h3>
        <div class="my-4 rounded-lg border-l-4 border-seal bg-sunken px-4 py-3">
        <p class="m-0 text-[0.88em] leading-relaxed text-ink">平均变化率是一段区间上的快慢，
        瞬时变化率是把区间压到零。</p>
        </div>
（同一个标题、同一句话，只是把「兜底样式」换成了显式的字号、墨色与层次——这一步不做，
用户看到的永远是左边那种。）
前提与系统提示词里「正文排版规范」一节同一套：正文列宽上限 800px、**可用内容宽度约 745px**；
颜色优先用应用的主题令牌（bg-paper / bg-card / bg-sunken / bg-inset、text-ink / text-ink-strong /
text-ink-soft / text-ink-faint、border-line / border-line-strong、text-seal / bg-seal、
text-ok / text-warn、bg-mark），它们跟着浅色/深色主题自动变。

能用的是**标准 Tailwind 工具类**（v4），常打交道的几组：
- 布局：flex / grid / grid-cols-2 / grid-cols-3 / items-center / items-end / justify-between / shrink-0
- 间距：gap-3 / gap-5 / p-4 / px-5 / py-3 / mt-6 / my-5 / space-y-2
- 文字：**字号一律用 em**（text-[0.9em] / text-[0.85em] / text-[0.75em] / text-[1.45em]）——
  正文有一个整篇的字号系数，它只缩放 em；写 px 的那部分不会跟着放大，一篇里就会一半大一半小。
  行距与字重：leading-relaxed / leading-[1.85] / font-semibold；数字对齐：tabular-nums
- 数字：tabular-nums（表格与图表里的数字务必加上，位数才会对齐）
- 形状：rounded-sm / rounded-lg（纸墨风，别用大圆角）/ border / border-l-4 / shadow-sm（少用）
- 任意值也认：w-[360px] / grid-cols-[1fr_auto] / [animation-delay:120ms] / bg-[#f3f4f6]

下面六个配方照抄改字即可（省略号处填你自己的内容）。注意每个配方的标签之间**不留空行**——
空行会把一个 HTML 块切成两半。

一、提示框（结论 / 易错点 / 记忆点）：
<div class="my-4 rounded-lg border-l-4 border-seal bg-sunken px-4 py-3">
<p class="m-0 text-[0.88em] leading-relaxed text-ink">结论写在这里。</p>
</div>
（结论用 border-ok、易错用 border-warn；整篇不要到处套盒子，一屏一个就够）

二、两栏对照（每栏约 350px）：
<div class="my-5 grid grid-cols-2 gap-5">
<div class="rounded-lg bg-sunken p-4"><h3 class="m-0 text-[0.95em] font-semibold text-ink-strong">甲说法</h3>
<p class="mt-2 text-[0.88em] leading-relaxed text-ink-soft">……</p></div>
<div class="rounded-lg bg-card p-4">……</div>
</div>

三、步骤 / 时间轴：
<div class="my-5 space-y-3">
<div class="flex gap-3">
<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal text-[0.78em] text-white">1</span>
<p class="m-0 text-[0.9em] leading-relaxed text-ink">第一步做什么。</p>
</div>
（第二步、第三步照写，序号改成 2、3）
</div>

四、横向条形图（比大小最直观）：
<div class="my-5 space-y-2 text-[0.85em]">
<div class="flex items-center gap-3">
<span class="w-[92px] shrink-0 text-ink-soft">甲</span>
<div class="h-3 flex-1 rounded-sm bg-inset"><div class="h-3 rounded-sm bg-seal/80" style="width:72%"></div></div>
<span class="w-[36px] shrink-0 text-right tabular-nums text-ink-faint">72</span>
</div>
（每组一行；宽度按「这一项 ÷ 最大值」算百分比，最大的那一项给 100%）
</div>

五、柱状图（柱子自己长出来）：
<div class="my-5">
<div class="flex h-40 items-end gap-4 border-b border-line px-2">
<div class="flex h-full flex-1 flex-col items-center justify-end"><div class="w-[58%] origin-bottom animate-doc-grow rounded-t-sm bg-seal/85" style="height:64%"></div></div>
<div class="flex h-full flex-1 flex-col items-center justify-end"><div class="w-[58%] origin-bottom animate-doc-grow rounded-t-sm bg-seal/85" style="height:100%"></div></div>
</div>
<div class="mt-2 flex gap-4 px-2 text-[0.75em] text-ink-faint">
<span class="flex-1 text-center">一季度</span>
<span class="flex-1 text-center">二季度</span>
</div>
</div>
（每组一列，结构照抄：**列必须是 h-full**，柱子写百分比高度才量得出来；把柱子直接放进
items-end 的容器里写百分比高度会算成 0——高度全没了，这是这条配方最容易踩空的一处。
要错峰入场就给柱子加 [animation-delay:120ms]，一列往后推一档）

六、折线与曲线（手画 SVG，线自己描出来）：
<figure class="md-fig my-5">
<svg viewBox="0 0 720 220" class="w-full">
<line x1="40" y1="190" x2="700" y2="190" stroke="currentColor" class="text-line" />
<path d="M40 170 L200 120 L360 132 L520 62 L700 44" fill="none" stroke="currentColor" stroke-width="2.5" class="text-seal animate-doc-draw" pathLength="1" stroke-dasharray="1" />
</svg>
<figcaption>图 1：一句话说清这张图要看哪一处。</figcaption>
</figure>
（viewBox 宽度按 720 给，正好铺满正文那一列；坐标自己算：x 均匀分布，y 按数值映射）

另外两个常用的：**数字并排**（grid grid-cols-3 gap-4 text-center，大数字用 text-[1.45em]
font-semibold tabular-nums）；**进度条**（外层 h-2 rounded-full bg-inset，内层同高 rounded-full
bg-ok，宽度用 style="width:38%"）。

三条纪律：
- **动画只用在过程上**：生长（animate-doc-grow）、描线（animate-doc-draw）、浮现
  （animate-doc-fade / animate-doc-rise）。同一屏最多一两个，静态讲得清就别动。
- 每张图配一句 <figcaption>，正文里也点一句「这张图看哪里」——图是讲解的一部分，不是装饰。
- **不要把整篇切成一张张卡片**：留白、字号层级和一条细分隔线（border-line）比边框与底色耐读。
  标题、表格、公式、代码块沿用渲染器自带的样子即可，不必自己重做。`,
  },
]

import { getLoadedSkills } from '../../agent/skill/registry'

const MODULE_BY_KEY = new Map(PROMPT_MODULES.map((m) => [m.key, m]))

export function promptModuleByKey(key: string): PromptModule | null {
  const mod = MODULE_BY_KEY.get(key)
  if (mod) return mod

  if (key.startsWith('skill:')) {
    const skillId = key.slice('skill:'.length)
    const skills = getLoadedSkills()
    const target = skills.find((s) => s.id === skillId)
    if (target) {
      return {
        key,
        title: `技能 · ${target.name}`,
        text: `### 专业技能规范与执行纪律：${target.name} (${target.id})\n\n${target.instructions.trim()}`,
      }
    }
  }

  return null
}

/**
 * api 名 → 模块 key 的触发映射：按组前缀（content.write → content），顶层名（wait / ask）用名字本身。
 * 只有「规范搬进了模块」的组才在这里；content / graph / state / ask 这些每轮必用的组不触发注入。
 */
const GROUP_MODULE: Record<string, string> = {
  browser: 'browser',
  web: 'web',
  fetch: 'web',
  mcp: 'mcp',
  res: 'res',
  exam: 'exam',
  reading: 'learning-process',
  attention: 'learning-process',
  focus: 'learning-process',
  schedule: 'learning-process',
  workspace: 'workspace',
  method: 'method',
  code: 'code',
  compact: 'compact',
  subagent: 'subagent',
  ui: 'ui',
}

export function promptModuleForApiName(name: string): string | null {
  const dot = name.indexOf('.')
  const group = dot < 0 ? name : name.slice(0, dot)
  return GROUP_MODULE[group] ?? null
}

/**
 * 写入内容里的标记 → 模块 key（内容触发）：模型写出 ```plot 图像或 SMIL / @keyframes
 * 动画时，对应的数据形态 / 动画写法模块就该在场。宿主在 execute 的写入调用参数上
 * 嗅探（见 sandbox/execute 的 callApi 与下面的 writableContentOf）。
 *
 * target 是这次写入的第一个参数（content.* 的定位对象）：part 写 superdoc:* 的写入
 * 本来就是完整 HTML，不注入 doc-html 排版配方（那与超级文档的写法相冲），但 plot /
 * 动画标记照常嗅探。
 */
export function promptModuleForContent(content: string, superdoc: boolean, apiName?: string): string[] {
  const out: string[] = []
  // 写教学文档（files.write / files.edit / 节点对象的 editContent 写 teaching）就注入排版配方；
  // 超级文档（payload 是完整 HTML）不注入 doc-html——排版配方与它的写法相冲
  const writeish = apiName === 'files.write' || apiName === 'files.edit' || apiName === 'node.invoke'
  if (!superdoc && writeish) {
    out.push('doc-html')
  }
  if (content.includes('```plot')) out.push('plot-forms')
  if (content.includes('<animate') || content.includes('@keyframes')) out.push('rich-animation')
  return out
}

/**
 * 从一次写入调用里取出可嗅探的正文与「是不是完整 HTML（超级文档）」。
 * 大纲等对象 payload 没有可嗅探的正文，回 null；其余调用不携带正文，也回 null。
 */
export interface WritableContent {
  text: string
  /** 超级文档：payload 本来就是完整 HTML，不注入排版配方 */
  superdoc: boolean
}

export function writableContentOf(name: string, args: unknown[]): WritableContent | null {
  if (name === 'files.write') {
    return typeof args[1] === 'string' ? { text: args[1], superdoc: false } : null
  }
  if (name === 'files.edit') {
    const payload = args[1]
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>
      if (typeof p.content === 'string') return { text: p.content, superdoc: false }
      if (p.replace && typeof p.replace === 'object') {
        const rep = p.replace as Record<string, unknown>
        if (typeof rep.replacement === 'string') return { text: rep.replacement, superdoc: false }
        if (typeof rep.new === 'string') return { text: rep.new, superdoc: false }
      }
    }
    return null
  }
  if (name === 'node.invoke') {
    // 新协议：invoke(uuid, 成员名, 参数数组)——只有 editContent 带可嗅探的正文
    const member = typeof args[1] === 'string' ? args[1] : ''
    if (member !== 'editContent') return null
    const rest = Array.isArray(args[2]) ? args[2] : []
    const payload = rest[0]
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const p = payload as Record<string, unknown>
    if (typeof p.teaching === 'string') return { text: p.teaching, superdoc: false }
    if (typeof p.text === 'string') return { text: p.text, superdoc: false }
    if (typeof p.html === 'string') return { text: p.html, superdoc: true }
    return null
  }
  return null
}

/**
 * 去重判据：keys 里哪些模块**还没有**出现在活着的上下文里。
 *
 * 两种形态都算「已注入」：
 * - 回复里的 prompt-module 片段（mid-loop 边界注入，见 agent/types）；
 * - 轮开始时注入的独立隐藏消息（工作流触发，字段在消息上）。
 * 只统计 !retired——被压缩折掉的不再进上下文，必须允许重新注入
 * （与 needsPersonaAnnounce 的判据同一口径）。
 * 调用方传的消息列表必须与「这次请求真正会发的历史」同源（同一份 Conversation.messages）。
 */
export function missingPromptModules(messages: ConversationMessage[], keys: string[]): string[] {
  const alive = new Set<string>()
  for (const m of messages) {
    if (m.retired) continue
    if (m.promptModule) alive.add(m.promptModule)
    for (const p of m.parts) {
      if (p.type === 'prompt-module') alive.add(p.key)
    }
  }
  return [...new Set(keys)].filter((k) => !alive.has(k))
}

/**
 * 一条模块消息：隐藏 **assistant** 消息，promptModule 供去重。
 *
 * 模块是「怎么做」的**声明**（排版配方、api 规程、方法流程）——固定内容、声明一次、
 * 同上下文不重复，归 assistant 边；「做什么」的指令（工作流、用户消息）才是 user。
 * 与 personaMessage 同一个形状家族，也是一条**提示词注入**（inject: 'prompt'）：
 * 它不分割轮次，界面上并进那一轮的「思考、工具与提示词」过程组——与思考、工具调用
 * 同一层（见 agent/messageKind 与 panel/partGroups）。正文只在上下文里，展开看全文。
 */
export function promptModuleMessage(mod: PromptModule, uuid: string, at: number): ConversationMessage {
  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: mod.text }],
    ts: at,
    hidden: true,
    mark: t('提示词模块 · {0}', mod.title),
    promptModule: mod.key,
    inject: 'prompt',
  }
}

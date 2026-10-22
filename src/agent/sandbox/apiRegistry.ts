/**
 * 这个文件负责什么：**execute 沙箱 api 的唯一注册表**。
 *
 * 一条 api 在这里登记三样东西：签名、一句话作用、完整用法（含示例）。
 * `wrapApi` 只接受登记过的名字；Worker 的可用名单、`__help()` 的正文、
 * 系统提示词里的 api 集索引、设置页的 api 目录，全部从这张表派生——
 * 实现与文档不再各写一份。
 *
 * 纪律：
 * - **名字是主键**：`node.read` 这种全名只出现一次；改名等于换一条 api。
 * - **用法必须能照着写**：示例用 `api.` 前缀，且是完整的可执行表达式。
 * - **不登记就不存在**：`wrapApi` 遇到未登记的名字会当场抛错（测试与运行都拦）。
 * - **应用数据不写文件路径**：doc / state / outline / exam / sdoc / wf / method
 *   的用法里只出现对应 api，不教模型拼 `*.json`。
 */

export type ApiAvailability =
  | 'always'
  | 'exam'
  | 'ui'
  | 'browser'
  | 'subagent'
  | 'mcp'
  | 'conditional'

export interface ApiDoc {
  /** 组内方法名，如 `read` */
  name: string
  /** 全名，如 `node.read`；顶层函数就是名字本身 */
  full: string
  /** 给人看也给模型抄的签名 */
  signature: string
  /** 一句话作用（组列表里用） */
  summary: string
  /** 完整用法：何时用、边界、常见坑 */
  usage: string
  /** 参数说明（可选） */
  params?: string
  /** 返回形状（可选） */
  returns?: string
  /** 主示例（必填） */
  example: string
  /** 附加示例 */
  examples?: string[]
  /** 只读 api 标 false；写操作省略或 true */
  mutates?: boolean
  /** 可用性：条件组在宿主没注入时调用会得到「沙箱里没有这个 api」 */
  availability?: ApiAvailability
  /** false = 不进 Worker 名单（保留实现做兼容/内部用） */
  exposed?: boolean
  /** 退役说明：有它就不进名单，帮助里也会标出来 */
  deprecated?: string
}

export interface ApiGroupDoc {
  key: string
  label: string
  /** 系统提示词里的一行索引 */
  intro: string
  /** `__help()` 里的组说明 */
  usage: string
  /** 组级示例（可选） */
  example?: string
  apis: ApiDoc[]
}

type ApiSeed = Omit<ApiDoc, 'full'> & { full?: string }

const a = (
  name: string,
  signature: string,
  summary: string,
  usage: string,
  example: string,
  extra: Partial<ApiSeed> = {},
): ApiSeed => ({ name, signature, summary, usage, example, ...extra })

const g = (
  key: string,
  label: string,
  intro: string,
  usage: string,
  apis: ApiSeed[],
  example?: string,
): ApiGroupDoc => ({
  key,
  label,
  intro,
  usage,
  ...(example ? { example } : {}),
  apis: apis.map((x) => ({
    ...x,
    full: x.full ?? (key === 'core' ? x.name : `${key}.${x.name}`),
  })),
})

/**
 * 全部 api 集。顺序就是系统提示词与设置页里的展示顺序：
 * 先学习数据（最常用），再工具，再运行时设施。
 */
export const API_GROUPS: ApiGroupDoc[] = [
  /* ---------- 执行控制（顶层函数） ---------- */
  g(
    'core',
    '执行控制',
    'wait / ask / tiktok / help / compact / fetch / see：顶层函数，不挂在某个组下。',
    `这一组不是对象，直接写在 api 上：
- api.wait(ms)：睡一会儿（0~120000ms），只在等页面/等用户时用。
- api.ask({ title?, questions })：弹表单并阻塞到用户提交；每题 { type: 'single'|'multiple'|'short', prompt, options?, when?, userInfo? }。
- api.tiktok()：响一声提示音。
- api.help()：api 集总览（与 api.__help() 同义）。
- api.compact({ summary, tasks? })：提交交接摘要；本轮结束后生效。
- api.fetch(url | { url })：抓网页转 Markdown（等同 api.web.fetch）。
- api.see(图片地址 | base64 | { url?, base64?, mime?, name? } | { pdf?, page? })：看一张图或一份 PDF 的指定页，它们附在你的下一步里。`,
    [
      a('help', 'help()', 'api 集总览', '任何时候都能调。返回的是组名与一句说明，不含具体签名；具体用法用 api.<组>.__help()。', 'const overview = await api.help()'),
      a('wait', 'wait(ms | { seconds })', '等一段时间再继续', '等异步结果、等页面加载、等用户操作时用；上限 120 秒。纯计算不要用它拖时间。', 'await api.wait(800)'),
      a(
        'ask',
        'ask({ title?, questions })',
        '弹结构化表单并阻塞到用户作答',
        '题目类型 single / multiple / short；options 2~8 项；when 做联动；userInfo 让答案直接写进画像。用户取消回 cancelled:true，超时回 timedOut:true。',
        `const r = await api.ask({
  title: '确认难度',
  questions: [{ type: 'single', prompt: '这次想练哪一档？', options: ['基础', '进阶', '挑战'] }],
})`,
      ),
      a('tiktok', 'tiktok()', '响一声系统提示音', '需要把用户视线叫回来时用；不要连续响。', 'await api.tiktok()'),
      a('compact', 'compact({ summary, tasks? })', '提交上下文交接摘要', '只在本轮是压缩轮时调用；summary 是正文摘要，tasks 是未完成事项。本轮结束后旧消息才失活。', `await api.compact({ summary: '## 已讲清\\n- 极限的定义', tasks: ['继续讲夹逼定理'] })`),
      a('fetch', 'fetch(url | { url })', '抓网页并转 Markdown', '返回 { ok, title, content, error? }。失败不抛异常，先判 ok；不要对同一 URL 死循环重试。', `const page = await api.fetch({ url: 'https://example.com/spec' })`),
      a(
        'see',
        'see(url | base64 | { url?, base64?, mime?, name? } | { pdf?, page?, name? })',
        '看一张图或一份 PDF 的指定页（附在你的下一步里）',
        '需要亲眼看一样东西时用：网页或接口里发现的图片链接、代码/文件里的 base64 图片、工作区文件里的 data URL、' +
          '论文/讲义/扫描件 PDF 里的图表与排版。图片走图像通道（与 res.read 读图同一机制），回执本身不含图片内容，' +
          '不要把 base64 写进返回值。字符串收三种写法：http(s) 图片地址、data:image/...;base64,...、裸 base64（按 mime 参数或魔数认格式）。' +
          '**看 PDF 用 { pdf, page }**：pdf 收 http(s) 地址、资源库引用 moji:static/<uuid>（先 res.list() 找）' +
          '或相对用户的文件路径；page 从 1 起，单个或数组（一次最多 4 页），省略看第 1 页——只渲染页面为图，不提供文字层；' +
          '个别字体未内嵌的 CJK PDF 可能缺字。图片上限 12MB、PDF 上限 32MB，过大的图先压缩到长边 1568 再入库；' +
          '同内容的图自动复用资源库已有那条。多页内容逐页调，先看你最需要的那几页。',
        `const r = await api.see('https://example.com/chart.png')
if (r.ok) { /* 图片已在你的下一步里，直接描述它即可 */ }
const p = await api.see({ pdf: 'moji:static/<uuid>', page: [1, 3] })`,
      ),
    ],
  ),

  /* ---------- 学习数据 ---------- */
  g(
    'graph',
    '节点与拓扑',
    '知识点树：列表、详情、路径、创建、改名、更新、移动、删除、注解。',
    `节点是学习数据的骨架。所有 path 都按「本目标内标题唯一」寻址：
- '' 或 '当前' = 当前节点；
- '极限' = 本目标里标题为「极限」的节点；
- '微积分/极限' = 从根逐段走；
- '#<id>' = 直接给节点 id（api.graph.list() 里有）。
path 找不到时回执会列候选子节点，照着改一次就对。

**类型与关系（先看这段再建节点）**

一个**学习节点**（KnowledgeNode）是内容的容器，它同时拥有：
- 一份**教学文档**（doc.write，正文 .md）
- 一份**大纲**（outline.write，children 是「目标项」）
- 若干**笔记**（doc.write 的 note）、若干**试卷**（exam）、若干**超级文档**（sdoc）

画布上看到的卡片是这些内容各自成为的**节点**，五种类型：
\`doc\` 文档 / \`outline\` 大纲 / \`note\` 笔记 / \`exam\` 试卷 / \`superdoc\` 超级文档。
每个卡片用 ref 指回上面那份内容——**内容只存一份，图里只存引用**。

它们之间的连接规矩（2026-10 起的拓扑，别按老习惯连）：
- **文档 → 大纲**：先文档再大纲，大纲是这份文档自己的展开；
- **大纲 → 文档**：大纲列出的目标项，由一份**子文档**去落地；一个目标项只挂一份子文档；
- **文档 → 笔记 / 试卷 / 超级文档**：叶子只挂在文档下面；
- **大纲之间不连**：大纲的父子节点只能是文档（没有「大纲 → 大纲」这条路）。

所以建一个子目标的顺序是：父节点上先有一条目标项（outline.write 写进 children），
再 node.create({ parent: 父标题, title: 目标项标题 }) 让它落地成子节点——
子节点自己会带一份文档与一份空大纲。**不要**为了挂上父子关系去建一条大纲→大纲的线。`,
    [
      a('list', 'graph.list()', '本目标全部节点', '回 path / id / title / status / 描述摘要 / 字数 / 掌握度。规划路线、找父节点、核对是否存在时先调它。', 'const all = await api.graph.list()'),
      a('read', 'graph.read(path?)', '单个节点详情', '含描述、状态、各文档字数、上级/下级、学习状态。想知道「这个节点写过什么」先看它，不要整篇读文档。', `const n = await api.graph.read('极限')`),
      a('title', 'graph.title(path?)', '读节点标题', '只回标题，用于轻量确认；要看描述/状态/字数用 graph.read。', `const t = await api.graph.title('极限')`),
      a('paths', 'graph.paths(path?)', '节点路径索引', '回 { id, title, path, dir, doc, notesDir, outline, meta, superdocsDir, examsDir, workspaceDir }。需要引用真实文件时用它取，不要自己拼目录名。', `const p = await api.graph.paths()`),
      a('create', 'graph.create({ parent, title, description?, status? })', '新建子节点', 'parent 必填（标题 / 路径 / #id），不接受「当前」这种隐式起点；同名节点会被拒绝。建完教学文档与大纲同时就位。', `await api.graph.create({ parent: '微积分', title: '夹逼定理', description: '用两个边界函数夹住目标函数求极限' })`),
      a('createTree', 'graph.createTree({ parent?, tree })', '批量/递归建大纲树', 'tree 每项 { title, description?, status?, content?, outline?, children? }。规划式/完整式目标一次建整棵树时用；不要拿它建重复节点。', `await api.graph.createTree({ parent: '微积分', tree: [{ title: '极限', children: [{ title: '夹逼定理' }] }] })`),
      a('rename', 'graph.rename(path, 新标题)', '改节点标题', '标题就是路径，改名等于换目录；同目标重名会被拒绝。', `await api.graph.rename('极限', '极限与连续')`),
      a('update', 'graph.update(path?, { title?, description?, status? })', '改节点属性', 'status 只认 learning / mastered。描述写 150~300 字；改标题优先用 rename。', `await api.graph.update('极限', { description: '从数列极限到函数极限的完整入门。', status: 'learning' })`),
      a('annotate', 'graph.annotate(path?, { term, occurrence?, body })', '写正文划词注解', 'term 是正文里那一小段文字；occurrence 从 0 起，同一个词多次出现时指定第几处。注解挂在节点上。', `await api.graph.annotate('极限', { term: '夹逼定理', body: '用两个边界函数夹住目标函数。' })`),
      a('move', 'graph.move(path, 新父节点)', '迁移节点', '改父线；根节点、跨目标、成环都会被拒。', `await api.graph.move('夹逼定理', '极限')`),
      a(
        'relations',
        'graph.relations(path?)',
        '读一个节点的拓扑关系',
        '回 { id, title, parent, parents, children, prereqs }：parent 是树上的父，children 是下级，' +
          'prereqs 是「先学谁」。想知道「这个节点挂在哪、下面有什么」就用它，不要靠遍历 graph.list() 自己推。',
        `const rel = await api.graph.relations('极限')`,
      ),
      a(
        'link',
        'graph.link(parent, child)',
        '把 child 挂到 parent 之下（绑定拓扑）',
        '等价于 graph.move(child, parent)：树的父子是**唯一**的拓扑，绑一个新父就等于换父。' +
          '根节点不能挂到别人下面，跨目标与成环会被拒。解绑不单独提供——树上的节点必须有父，' +
          '要「摘下来」就挂到别的节点下。',
        `await api.graph.link('微积分', '夹逼定理')`,
      ),
      a('delete', 'graph.delete(path, { cascade?, dryRun? })', '删除节点', '学习目标本身不能删；cascade 连子节点一起删，dryRun 只回影响面。删用户内容前先确认。', `await api.graph.delete('草稿节点')`),
    ],
  ),
  g(
    'doc',
    '教学文档与笔记',
    '教学文档与笔记的读、分段读、查找、整篇写、区间改、追加、注解。',
    `**读写内容请优先用 content.***（这一组是旧写法，等价、保留兼容）：
正文与笔记的读、分段读、查找、整篇写、区间改、追加、注解。
- 省略 path = 当前节点的教学文档；
- '极限/笔记' = 该节点的笔记（第一份）；'极限/笔记/错题本' = 指定名字的笔记；
- 笔记不存在时 write 会自动新建。
不要用 files.* 读写教学文档或笔记——那条路会被拒绝。`,
    [
      a('read', 'doc.read(path?)', '读一份文档全文', '回 { path, doc, chars, content }。整篇很长时改用 readRange / find。', `const d = await api.doc.read('极限')`),
      a('readRange', 'doc.readRange(path?, start?, end?)', '分段读文档', 'start/end 是字符下标；省略 end 默认 1500 字。长文档先读开头与标题结构。', `const head = await api.doc.readRange('极限', 0, 2000)`),
      a('find', 'doc.find(path?, 要找的文字, { from?, limit? }?)', '在文档里找文字', '回命中位置与前后 40 字上下文；limit 最多 50。改一处措辞前先用它定位。', `const hits = await api.doc.find('极限', '夹逼')`),
      a('write', 'doc.write(path?, content)', '整篇写入文档', '不存在就新建（笔记同理）；空内容会被拒绝。整篇覆盖前先读，不要覆盖用户已有内容。', `await api.doc.write('极限', '# 极限\\n\\n从数列极限开始……')`),
      a('replace', 'doc.replace(path?, { start?, end?, content, expected? })', '按区间改文档', '给 start/end 或 expected（原文字符串，必须先匹配）再替换。改一处用 replace，不要整篇重写。', `await api.doc.replace('极限', { expected: '旧的一句话', content: '新的一句话' })`),
      a('append', 'doc.append(path?, content)', '追加到文档末尾', '不覆盖已有正文；适合补一段。', `await api.doc.append('极限', '\\n\\n## 补充：夹逼定理的几何直觉')`),
      a('annotate', 'doc.annotate(path?, { term, occurrence?, body })', '写正文划线注解', '与 node.annotate 同义，保留给按文档寻址的旧写法。', `await api.doc.annotate('极限', { term: '夹逼定理', body: '用两个边界函数夹住目标函数。' })`),
    ],
  ),
  g(
    'content',
    '内容读写',
    '一份内容的读 / 写 / 追加 / 查找：正文、大纲、笔记、超级文档共用这一套，按 part 区分。',
    `**这是读写内容的唯一入口**（doc.* / outline.* / sdoc.* 是旧写法，保留兼容、等价）。

位置由 \`part\` 表达：
- 省略 part = 正文（教学文档）；
- 'note:错题本' = 某个节点的一份笔记；
- 'outline' = 大纲（对象，不是 Markdown）；
- 'superdoc:讲义' = 一份超级文档（完整 HTML）。

两种写法都收：
  content.read('极限/笔记/错题本')                 // 字符串沿用 path 语法
  content.read({ node: '极限', part: 'outline' })  // 显式 part

**试卷不在这里**：出卷 / 作答 / 判分是业务动作，用 exam.*。`,
    [
      a(
        'read',
        'content.read(target)',
        '读一份内容',
        '回 { path, part, chars, content }。大纲以 JSON 文本返回；超级文档回 HTML。整篇很长时用 content.find 定位，别整篇读进上下文。',
        `const body = await api.content.read('极限')`,
      ),
      a(
        'find',
        'content.find(target, 要找的文字, { from?, limit? }?)',
        '在一份内容里找文字',
        '回命中位置与前后 40 字上下文；limit 最多 50。改一处措辞前先用它定位。',
        `const hits = await api.content.find({ node: '极限', part: 'note:错题本' }, '夹逼')`,
      ),
      a(
        'write',
        'content.write(target, body)',
        '整份写入一份内容',
        '正文/笔记是字符串；大纲是对象 { intro, children }（也可以传 JSON 字符串）；超级文档是完整 HTML。整篇覆盖前先读，别覆盖用户写过的东西。',
        `await api.content.write({ node: '极限', part: 'outline' }, { intro: '先补前置', children: [{ title: '夹逼定理', summary: '两个边界函数' }] })`,
      ),
      a(
        'append',
        'content.append(target, body)',
        '追加到末尾',
        '只有正文与笔记能追加；大纲 / 超级文档请整份 write。',
        `await api.content.append('极限', '\\n\\n## 补充：夹逼定理的几何直觉')`,
      ),
    ],
  ),
  g(
    'outline',
    '结构化大纲',
    '每个节点一份大纲：intro + 直接子目标一层 children。',
    `大纲是结构化的计划，不是 Markdown。write 整份覆盖，只收直接子层级一层：
「爷爷知道儿子的存在，但不知道孙子的存在」。孙辈由子目标自己的 outline 负责。`,
    [
      a('read', 'outline.read(path?)', '读节点大纲', '还没写过时回 null——那不是错误，说明要先写一份。', `const o = await api.outline.read('微积分')`),
      a('write', 'outline.write(path?, { intro, children })', '整份写大纲', 'children 每项 { title, summary }，key 由标题自动生成，不要自己编；最多 24 条。', `await api.outline.write('微积分', {
  intro: '先补前置，再进极限与导数。',
  children: [{ title: '极限', summary: '从数列到函数极限' }, { title: '导数', summary: '从切线到求导法则' }],
})`),
    ],
  ),
  g(
    'state',
    '学习状态',
    '自评、掌握度、错误记忆、检验记录：系统对这个学习者的判断。',
    `state.* 写的是「他会不会」而不是「他写了什么」：
- 值域先挡：自评四档、掌握度 0~100；
- 没评估过就是 null，不要用 0 分冒充「测过」；
- 掌握度每次改动都要带 note 说明依据。`,
    [
      a('read', 'state.read(path?)', '读学习状态', '回 status / self / mastery / mistakes / checks / 最近学习时间。新增节点后先看它。', `const st = await api.state.read('极限')`),
      a('update', 'state.update(path?, { self?, by?, mastery?, note? })', '改自评/掌握度', 'self 只认 mastered / familiar / unknown / unsure；by 为 user 表示学习者确认，ai 表示导师推断；mastery 0~100。', `await api.state.update('极限', { mastery: 70, note: '夹逼定理的探针答对了，但放缩方向还会错。' })`),
      a('mistake', 'state.mistake(path?, { pattern, cause?, count? } | pattern)', '记一类错误记忆', 'pattern 写「错成了什么样」，不是「第 3 题错了」；同一说法再犯会累加次数。', `await api.state.mistake('极限', { pattern: '放缩时把不等号方向写反', cause: '对边界函数的大小关系不熟' })`),
      a('forget', 'state.forget(path?, pattern?)', '清除错误记忆', '给 pattern 只清这一条；不给就清空这个节点的全部错误记忆。', `await api.state.forget('极限', '放缩时把不等号方向写反')`),
      a('check', 'state.check(path?, { kind, score?, question?, answer?, mentioned?, missed?, misconceptions?, note? })', '记一次检验', 'kind 如 probe / recall / exam；探针记 score，回忆记 mentioned / missed / misconceptions。', `await api.state.check('极限', { kind: 'probe', score: 80, question: '夹逼定理需要几个边界函数？', answer: '两个' })`),
    ],
  ),
  g(
    'memory',
    '记忆',
    '跨对话的记忆：工作记忆（本目标）/ 长期记忆（跨目标）的增删改查。',
    `记忆**不会自动进上下文**：需要时自己 list / get。两种类型分工明确，别混着用：
- type:'work'（工作记忆，默认）：这个目标里「发生了什么 / 要做什么 / 怎么做 / 过程怎么样 / 结果怎么样」。
  只有本目标的会话读得到；你觉得某条已经是负担了，直接 delete（不需要确认）。
- type:'long'（长期记忆）：聊天里对用户的印象、作息、重要约定。任何目标都读得到，
  删除要显式确认：api.memory.delete(uuid, { confirm: true })。
一条记忆一个主题：title 一行说清是什么，content 写细节，keys 给检索用的关键词。
同一条要补充就用 update 改，不要另开一条重复的。`,
    [
      a('list', 'memory.list({ type? }?)', '列记忆条目', '回 count / long / work 与每条摘要（不含全文）；type 可只列一类。', `const mem = await api.memory.list({ type: 'long' })`),
      a('get', 'memory.get(uuid)', '读一条记忆全文', '按 uuid 取 title / keys / content / 时间；看不见的条目按「没有」处理。', `const one = await api.memory.get(mem.items[0].uuid)`),
      a('create', 'memory.create({ type, title, keys?, content })', '新建一条记忆', 'type: work（本目标）| long（跨目标）；title 省略时取正文首行。', `await api.memory.create({ type: 'work', title: '本轮进度', keys: ['极限', '进度'], content: '讲完夹逼定理，下一轮做两道放缩题。' })`),
      a('update', 'memory.update(uuid, { title?, keys?, content?, type? })', '更新一条记忆', '只改给了的字段；改 type 等于搬家（work ↔ long）。', `await api.memory.update(one.uuid, { content: '补充：放缩方向还会错。' })`),
      a('delete', 'memory.delete(uuid, { confirm? }?)', '删除一条记忆', '工作记忆直接删；长期记忆必须 { confirm: true }，否则回一句说明。', `await api.memory.delete(one.uuid)`),
    ],
    `// 先看有哪些，再决定记什么
const mem = await api.memory.list()
if (!mem.items.some((x) => x.title === '用户的作息')) {
  await api.memory.create({ type: 'long', title: '用户的作息', keys: ['作息'], content: '习惯凌晨 1 点后学习，上午回消息慢。' })
}`,
  ),
  g(
    'schedule',
    '日程安排',
    '给用户排日程：列、新建、修改、完成、删除；到点由宿主响铃提醒。',
    `日程是**给用户的提醒**，不是你自己要执行的计划：写进去之后到点由宿主响铃、在顶栏弹出事项，
用户自己确认或让它隔一阵再提醒——你既不要替用户确认，也不要 sleep 等着它到点。
时间用 "HH:mm"，date 用 "YYYY-MM-DD"；date 省略就是今天（那个时间今天已过就顺延到明天，回执会说明）。
remindBefore 是提前多少分钟提醒，默认 0（准点）。
排之前先 api.schedule.list() 看今天已经有什么，同一件事别排两遍；一次别排一大堆。`,
    [
      a('list', 'schedule.list({ from?, to?, days? }?)', '列出一段日期里的日程', '默认今天起 7 天；回每条的 id / 日期 / 时间 / 标题 / 是否完成 / 提醒方式。', `const s = await api.schedule.list({ days: 3 })`),
      a('create', 'schedule.create({ title, date?, time, minutes?, remindBefore?, note? })', '安排一条日程', 'title 与 time 必填；date 省略=今天。minutes 是时长（只用于展示），remindBefore 默认 0。回 id 与提醒时刻。', `await api.schedule.create({ title: '复习夹逼定理', date: '2026-10-20', time: '19:30', minutes: 45, remindBefore: 10 })`),
      a('update', 'schedule.update(id, { title?, date?, time?, minutes?, remindBefore?, note?, done? })', '改一条日程', '只改给了的字段；done:true 等于标记完成（不再提醒）。', `await api.schedule.update(id, { time: '20:00' })`),
      a('complete', 'schedule.complete(id)', '标记完成', '完成之后不再提醒；这是「这件事办完了」的落账。', `await api.schedule.complete(id)`),
      a('remove', 'schedule.remove(id)', '删除一条日程', '不可逆；用户明确不要了才删。', `await api.schedule.remove(id)`),
    ],
    `// 排一条之前先看看今天已经有什么
const today = await api.schedule.list({ days: 1 })
if (!today.items.some((x) => x.title.includes('复习'))) {
  await api.schedule.create({ title: '复习夹逼定理', time: '19:30', minutes: 45, remindBefore: 10 })
}`,
  ),
  g(
    'tmp',
    '临时变量',
    '当前节点作用域的临时数据：大块中间结果、跨调用传递。',
    `tmp.* 按当前节点存放，不进上下文。适合把浏览器/搜索拿到的大 JSON 暂存起来，
只在编排里取用。不要拿它当长期存储——长期数据用 doc / state / res。`,
    [
      a('set', 'tmp.set({ key, value, ttlMs? })', '存一个临时值', 'value 可以是任意可结构化克隆的值；ttlMs 到期自动清。', `await api.tmp.set({ key: 'searchRaw', value: results })`),
      a('get', 'tmp.get(key)', '取一个临时值', '回 { key, found, value }；没有时 found:false，不抛异常。', `const raw = await api.tmp.get('searchRaw')`),
      a('has', 'tmp.has(key)', '是否存过', '回 { key, found }。', `const hit = await api.tmp.has('searchRaw')`),
      a('del', 'tmp.del(key)', '删一个临时值', '回 { key, deleted }。', `await api.tmp.del('searchRaw')`),
      a('list', 'tmp.list()', '列当前节点的临时值', '回 { items: [{ key, chars, remainingMs, ... }] }。', `const list = await api.tmp.list()`),
      a('clear', 'tmp.clear()', '清空当前节点的临时值', '回 { removed }。', `await api.tmp.clear()`),
    ],
  ),
  g(
    'exam',
    '试卷与考试',
    '出卷、读卷、判分、写错题讲解、删卷。',
    `exam.* 是两阶段流程：
1. 出题：exam.create({ title?, kind?, level?, minutes?, questions })；
2. 交卷后：exam.read() 看作答，exam.grade(...) 判分，exam.explain(...) 写讲解。
读任何时候都能调；写受阶段约束（有卷待收尾时不能再出卷）。用户作答事实（answers/inputs/dwell/blurs）严禁改写。`,
    [
      a('create', 'exam.create({ title?, kind?, level?, minutes?, questions })', '出一份试卷', 'kind: quiz / test / exam；level: easy / medium / hard / extreme；minutes 小测为 0，其余不低于题数×2。每道题 { type, stem, options?, answer?, rubric, points, image? }。', `await api.exam.create({
  title: '极限 · 随堂小测',
  kind: 'quiz',
  level: 'easy',
  minutes: 0,
  questions: [{ type: 'single', stem: '夹逼定理需要几个边界函数？', options: [{ id: 'A', text: '1 个' }, { id: 'B', text: '2 个' }], answer: ['B'], rubric: '两侧各一个', points: 1 }],
})`),
      a('read', 'exam.read(attemptId?)', '读试卷与作答', '不给 attemptId 读最新一份；回题目、历次 attempts、判分与讲解状态。没有卷子也是一种答案（不是失败）。', `const paper = await api.exam.read()`),
      a('grade', 'exam.grade({ attemptId?, passed?, summary?, results })', '判分并落账', 'results 每项 { questionId, correct, score, maxScore, comment, by }；passed 决定节点是否标记已掌握。只改评价层，不改用户作答事实。', `await api.exam.grade({ passed: true, summary: '基础题全对，放缩方向还需巩固。', results: [{ questionId: 'q1', correct: true, score: 1, maxScore: 1, comment: '正确', by: 'agent' }] })`),
      a('explain', 'exam.explain({ content, attemptId? })', '写错题讲解', '判分之后的第二步，落在同一次考试上；content 是 Markdown 讲解，写完自动打开试卷副本。', `await api.exam.explain({ content: '## 错题解析\\n\\n第 2 题错在……' })`),
      a('delete', 'exam.delete({ id? })', '删一份没考过的卷子', '考过的卷子是学习记录，agent 删不掉；只清理空卷/废稿。', `await api.exam.delete({ id: 'ex_xxx' })`),
    ],
  ),
  g(
    'sdoc',
    '超级文档',
    '绑定在节点上的可交互 HTML 文档：列表、读、写、删。',
    `超级文档是自包含单页 HTML（HTML/CSS/JS/SVG），可以嵌 <moji-markdown> 与主题变量。
写完用 api.ui.superdoc(path, name) 打开。不要用 files.* 直接写 superdocs/。`,
    [
      a('list', 'sdoc.list(path?)', '列这个节点的超级文档清单', '回名称、体量、更新时间；写入之前先看名字在不在，避免覆盖别人的实验。', `const list = await api.sdoc.list('极限')`),
      a('read', 'sdoc.read(path?, name)', '读超级文档源码', '回 HTML 全文；没有那份就回 error。改局部时先 read 再整份 write。', `const html = await api.sdoc.read('极限', '夹逼实验')`),
      a('write', 'sdoc.write(path?, name?, html)', '写入超级文档', '同名覆盖；name 不含 .html；html 必须自包含。', `await api.sdoc.write('极限', '夹逼实验', '<!doctype html><html>…</html>')`),
      a('delete', 'sdoc.delete(path?, name)', '删一份超级文档', '不可逆；删除前先 api.sdoc.list 确认名字，并告知用户删了什么。', `await api.sdoc.delete('极限', '夹逼实验')`),
    ],
  ),
  g(
    'res',
    '资源库',
    '目标 static/ 下的图片、PDF、附件：清单、详情、读、建、改、删、引用扫描。',
    `资源文件按 uuid 命名，文档里用 ![说明](moji:static/<uuid>) 引用。
读图片不会回 base64——图片会挂到下一跳；文本可以分段读。`,
    [
      a('list', 'res.list()', '列本目标全部资源', '回 uuid、名称、类型、大小、引用数。', `const assets = await api.res.list()`),
      a('info', 'res.info(uuid)', '单条资源详情', '回名称、类型、大小、描述、引用。', `const info = await api.res.info('a1b2c3')`),
      a('read', 'res.read(uuid, { start?, end? }?)', '读一份资源', '文本回内容（可给区间分段）；图片走图像通道挂到下一跳；其它二进制只回元数据。', `const text = await api.res.read('a1b2c3')`),
      a('create', 'res.create({ name, ext, content })', '新建文本资源', '只收文本；二进制资源用界面或文件工作区。', `await api.res.create({ name: '参考提纲', ext: 'md', content: '# 提纲' })`),
      a('update', 'res.update(uuid, { name?, description?, content? })', '改资源元数据或文本', '改名只动清单不动文件；改 content 会覆盖原文本，先 res.read 确认再动手。', `await api.res.update('a1b2c3', { description: '课程讲义截图' })`),
      a('delete', 'res.delete(uuid, { force? }? )', '删除一份资源', '还被引用时必须 force:true；不可逆，删除前先 res.refs 看引用面。', `await api.res.delete('a1b2c3')`),
      a('refs', 'res.refs(uuid?)', '引用扫描', '给 uuid 查这一条被谁引用；不给就列全部资源。', `const refs = await api.res.refs('a1b2c3')`),
    ],
  ),
  g(
    'workspace',
    '工作区',
    '当前节点 workspace/ 目录：列、读文本、写文本。',
    `工作区是用户交付物的落点（代码、报告、数据）。只收文本；路径写法与 doc 同构：
'极限/实验/数据.csv' 指该节点工作区下的文件，省略 path 是当前节点。`,
    [
      a('list', 'workspace.list(path?)', '列工作区目录', '目录不存在时回空清单，不是错误。', `const files = await api.workspace.list('极限')`),
      a('read', 'workspace.read(path?)', '读工作区文本文件', '太长会截断并带 totalChars。', `const code = await api.workspace.read('极限/实验/main.py')`),
      a('write', 'workspace.write({ path, content })', '写工作区文本文件', '整份覆盖，父目录自动建。交付物一律写这里。', `await api.workspace.write({ path: '极限/实验/main.py', content: 'print(1)' })`),
    ],
  ),
  g(
    'userInfo',
    '学习者画像',
    '昵称、年龄、教育程度、专业背景、当前身份、技能等。',
    `画像不进系统提示词；要贴合这个人时自己 get 一次。update 是增量语义，
只写传进来的字段。头像是展示字段，不从这里读写。`,
    [
      a('get', 'userInfo.get()', '读学习者画像', '回给模型看的那份（不含头像）；没有当前用户时回 error。贴合个人讲解前先取一次。', `const me = await api.userInfo.get()`),
      a('update', 'userInfo.update({ 字段: 值 })', '增量更新画像', '认不出的字段会逐条说明；不要一次传一堆没把握的值。', `await api.userInfo.update({ major: '计算机科学', level: '本科' })`),
    ],
  ),
  g(
    'reading',
    '阅读事实',
    '有效阅读时长、各节覆盖、最近会话、学习日汇总。',
    `reading.* 是只读事实账（阅读时长、到达率、会话），不是学习状态。
要看「他读到哪」用它；要判断「他会不会」用 state.*。`,
    [
      a('get', 'reading.get(path?)', '某节点的阅读事实', '回有效时长、各节覆盖、最近会话。', `const r = await api.reading.get('极限')`),
      a('list', 'reading.list()', '本目标各节点阅读概览', '一行一个读过或有记录的节点。', `const rows = await api.reading.list()`),
      a('day', 'reading.day(day?)', '某个学习日读了什么', 'day 省略=今天，格式 YYYY-MM-DD。', `const today = await api.reading.day('2026-10-19')`),
    ],
  ),
  g(
    'attention',
    '注意力评级',
    '把阅读事实折成档位 + 事实句 + 建议（纯派生，不落盘）。',
    `注意力是从阅读事实算出来的，不是用户自评。只在需要判断「这一段读得专不专心」时用。`,
    [
      a('get', 'attention.get(path?)', '读注意力评级', '把阅读事实折成档位 + 事实句 + 建议；省略 path 看整体，给 path 只看该节点。', `const a = await api.attention.get()`),
    ],
  ),
  g(
    'focus',
    '专注模式',
    '当前专注状态与最近记录（只读）。',
    `专注模式只有守卫、没有倒计时；agent 只能看，不能开始或结束。`,
    [
      a('status', 'focus.status()', '读专注状态', '回在跑的那一场、今天几场、最近几天与最近几条。', `const f = await api.focus.status()`),
    ],
  ),
  g(
    'method',
    '持久化函数',
    '目标级可执行函数源码：列表、创建/覆盖、删除、调用。',
    `method 存的是可执行代码，name 就是身份，同名 create 即覆盖。
超级文档里的按钮也只能通过 api.method.call 干活。`,
    [
      a('list', 'method.list()', '列已有函数清单', '回名字、体量与更新时间，不回源码；调用前先看有没有同名函数。', `const fns = await api.method.list()`),
      a('create', 'method.create({ name, code })', '新建/覆盖函数', 'code 是匿名函数源码，第一个参数是 api；创建时编译校验。', `await api.method.create({ name: '统计句号', code: '((api, path) => { const d = api.files.read; return 0 })' })`),
      a('delete', 'method.delete(name)', '删除一个持久化函数', '不可逆；正在被超级文档按钮调用的函数删掉会失效，删前告知用户。', `await api.method.delete('统计句号')`),
      a('call', 'method.call(name, ...args)', '执行函数', '注入当前编排的 api；返回函数返回值。', `const n = await api.method.call('统计句号', '极限')`),
    ],
  ),
  g(
    'wf',
    '工作流',
    '内置/全局/目标级工作流：列表、详情、登记、删除、触发。',
    `工作流存的是指令文本，不是可执行代码。wf.invoke 只排队：本轮收口后
宿主另起一轮，instruction 才作为 user 消息进入上下文。不要在 invoke 之后自己照着流程先做一遍。`,
    [
      a('list', 'wf.list({ full?, brief? }?)', '列可用工作流', '默认简略（只给 id/name/tier/description/chars）；full:true 带完整指令。', `const flows = await api.wf.list()`),
      a('get', 'wf.get(idOrName)', '看一条工作流的完整定义', '回 instruction、params 与说明；不含 prompt 规程正文（它在触发时注入）。', `const flow = await api.wf.get('开讲')`),
      a('create', 'wf.create({ name, instruction, description?, prompt?, tier? })', '登记/覆盖工作流', 'instruction 必填；prompt 是可选规程（同上下文只注一次）；tier 省略=目标级，global=跨目标。同名同级覆盖。', `await api.wf.create({ name: '课前摸底', instruction: '第一步：用 api.ask 摸底；第二步：按盲点写 api.doc.write。' })`),
      a('remove', 'wf.remove(idOrName)', '删除一条登记工作流', '内置工作流删不掉；删除后设置里的工作流列表同步消失，efforts 配置一并清掉。', `await api.wf.remove('课前摸底')`),
      a('invoke', 'wf.invoke(idOrName, { params? })', '触发一条工作流', '不对：它只排队。回执说「已排队」就不要再调、也不要自己做。一次编排最多排一条，链上最多连三条。', `await api.wf.invoke('出卷', { params: { node: '极限' } })`),
    ],
  ),
  g(
    'code',
    '代码块伪编译',
    '把文档里那段代码转译成可运行 JS 的交付口。',
    `用户点代码块上的「编译」时，工作流会带着 key / 语言 / 代码进来。
转译完用 code.save 交货；只有定义、没有输出的代码用 code.silent 标停。`,
    [
      a('save', 'code.save({ key, js, note })', '交付伪编译产物', 'key 原样抄；js 必须完整、自包含、能在 Web Worker 跑；note 写补了哪些假设。', `await api.code.save({ key: 'abc123', js: 'console.log(1)', note: '补了一个假数据数组' })`),
      a('silent', 'code.silent({ key, reason })', '标记这段代码没有输出', '只有定义/接口/常量的代码块走这里；reason 一句话说清。', `await api.code.silent({ key: 'abc123', reason: '只有类型与函数定义，没有被调用的语句' })`),
    ],
  ),
  g(
    'chip',
    '引用 chip',
    '生成与校验回复里的可点击引用卡片。',
    `不要手拼 chip 的 path；build 会当场对 store 解析并带上 nodeId。
交付前用 check 把草稿里的 chip 逐颗验一遍。`,
    [
      a('build', 'chip.build({ type, path?, url?, note?, name?, examId?, attemptId?, dir?, title? })', '生成一颗引用 chip', 'type: doc / note / outline / super / exam / attempt / ws / web / local。定位不到回 ok:false 与原因。', `const c = await api.chip.build({ type: 'doc', path: '极限' })`),
      a('check', 'chip.check(text)', '校验文本里的全部 chip', '回 { total, valid, invalid, problems? }；坏的用 build 重新生成。', `const r = await api.chip.check(draft)`),
    ],
  ),
  g(
    'delivery',
    '交付登记',
    '把这一轮的文件变动与参考引证登记到消息底部（一行一条，溢出省略）。',
    `只在**确实交付了东西**时调：写完或改完文档、讲义、大纲、试卷、工作区文件之后登记一次。
没有交付物就不要调——空记录不显示，乱登记只会给用户添噪音。
同一轮分几次登记会合并去重（路径 / URL 各自唯一）。
这是给**界面**看的账，不是给正文复述用的：正文里不必再抄一遍文件清单与参考来源。`,
    [
      a('submit', 'delivery.submit({ files?, sources? })', '登记本轮交付',
        'files: [{ path, action?: created|updated|deleted, note? }]；sources: [{ title, url }]（只收 http/https）。**path 要写数据树里的节点路径原样**（如「微积分/极限」，不要自己拼 /教学、/讲义 之类后缀），或工作区文件的相对路径（带扩展名）——界面点它时按这两种形态分别打开文档与文件。回 { ok, files, sources, error? }。',
        `await api.delivery.submit({ files: [{ path: '微积分/极限', action: 'updated', note: '补了夹逼定理一节' }], sources: [{ title: '同济高等数学第七版', url: 'https://example.com/book' }] })`),
    ],
  ),
  g(
    'web',
    '网页抓取与搜索',
    '抓网页转 Markdown、联网搜索并提炼摘要（创作类交付与涉网编码要查证，纯本地调试不用）。',
    `先想清楚该不该搜：创建目标 / 规划大纲 / 写讲义 / 出试卷这类创作**要查证**权威资料；
纯算法、本地逻辑、调试自己的代码、格式转换、计算与整理这类确定性工作**不要搜**。
**例外：写的代码要调第三方接口或依赖协议 / 规范 / SDK 行为时必须搜**——查官方文档读原文再落笔，
接口行为猜不得。一次够用就停。
查证要真读原文：search 之后挑 1~3 篇最权威的用 fetch 读正文，只看着摘要下笔等于走个形式。
抓取失败不抛异常（{ ok:false, error }）；搜索默认 5 条，每条约 1.5k~2k 字符。
严禁把多个 query 的原始结果整段塞回上下文——先筛选字段再返回。`,
    [
      a('fetch', 'web.fetch(url | { url })', '抓网页转 Markdown', '与 api.fetch 同义；**5 秒硬超时**，超时或失败就换来源，不要对同一 URL 重试。创作类调研与涉网编码都用它读权威原文（摘要不算依据）。', `const page = await api.web.fetch('https://example.com/spec')`),
      a('search', 'web.search({ query, count?, need_content? } | query, opts?)', '联网搜索', '回 { ok, results: [{ title, url, snippet, summary, rerank_score, authority?, content? }] }。宽泛词加领域限定词。**创作类交付（目标 / 大纲 / 讲义 / 试卷）与涉网编码（接口 / 协议 / 规范 / SDK）要调**；纯算法、本地调试、计算、格式转换不要调。', `const r = await api.web.search({ query: '夹逼定理 教材 讲解', count: 5 })`),
    ],
  ),
  g(
    'browser',
    '内置浏览器',
    '操作界面上开着的网页页签：打开、快照、受控 DOM、读取、截图、日志、直发请求。',
    `看页面按便宜程度排：snapshot（带 ref 的元素清单）→ read（整页 Markdown）→ capture（截图，最后手段）。
动手只走 dom(tabId, ref, op)；没有执行任意页面 JS 的通道。
这是用户的真实登录会话：提交/支付/删除/发消息先 api.ask 确认。`,
    [
      a('open', 'browser.open(url)', '开一个网页页签', '纯关键词会当搜索词；返回 tabId，首屏已基本加载完。先 tabs 查重，别重复开同一网址。', `const tab = await api.browser.open('https://example.com')`),
      a('tabs', 'browser.tabs()', '列存活页签', '开工第一步；之后操作按 tabId 指名。', `const tabs = await api.browser.tabs()`),
      a('activate', 'browser.activate(tabId)', '切到某个页签', '目标网址已经开着就 activate，不要 open。', `await api.browser.activate(tabId)`),
      a('close', 'browser.close(tabId | tabId[])', '关闭网页页签', '用户自己开的别动；收尾时关掉中间搜索页/试错页，留下用户可能还要看的。', `await api.browser.close(tabId)`),
      a('snapshot', 'browser.snapshot(tabId?, { role?, contains?, limit? }?)', '可交互元素清单', '带 ref，认结构、找元素全靠它；大页面一定给过滤。DOM 变了 ref 会过期，重新 snapshot。', `const snap = await api.browser.snapshot(tabId, { contains: '登录', limit: 30 })`),
      a('point', 'browser.point(tabId?, { ref } | 选择器)', '把元素指给用户看', '页面滚到目标并短暂高亮；程序化点击不生效时请用户手点。', `await api.browser.point(tabId, { ref: 12 })`),
      a('dom', 'browser.dom(tabId?, ref, op, arg?)', '受控 DOM 操作', 'op: click / fill / focus / submit / text / attr。fill 触发 input/change，React 受控输入也认。', `await api.browser.dom(tabId, 12, 'fill', '张三')`),
      a('read', 'browser.read(tabId?, { maxChars?, offset? }?)', '整页转 Markdown', '登录态页面也能读；短的回全文，长的落盘回大纲。续读带 offset。', `const page = await api.browser.read(tabId)`),
      a('capture', 'browser.capture(tabId?)', '给网页截图', '最后手段：只有布局/视觉必须亲眼看时用；页面还在加载先 wait 800。截图存进资源库并附到下一跳。', `await api.browser.capture(tabId)`),
      a('logs', 'browser.logs(tabId, { kind?, level?, only?, limit?, afterSeq? }?)', '控制台与网络清单', '动作没生效/页面静默失败先看它；失败永不折叠，每行带条目号。', `const logs = await api.browser.logs(tabId, { level: 'error' })`),
      a('logDetail', 'browser.logDetail(tabId, seq)', '单条日志/请求详情', '条目号 96、"n96" 都认；网络条目给 url、请求头、postData、响应体。', `const detail = await api.browser.logDetail(tabId, 96)`),
      a('fetch', 'browser.fetch(tabId, 网址 | { reqId }, { method?, headers?, body?, offset?, maxBody?, toTmp? }?)', '在页面上下文直发 HTTP', '继承该页签登录态；请求级失败回 { status:0, failed:true }，不抛异常。写操作先 ask。', `const r = await api.browser.fetch(tabId, 'https://example.com/api/list')`),
      a('waitFor', 'browser.waitFor(tabId, { selector?, text?, urlIncludes?, networkIdle?, timeoutMs? }?)', '等条件成立', '比「wait 再取还是空」的循环可靠；返回命中的条件。', `await api.browser.waitFor(tabId, { selector: '.result-list' })`),
      a('record', 'browser.record(tabId, "start" | "stop")', '录制一段操作区间', 'start 钉水位，stop 回这段区间的折叠清单；配 api.ask 让用户手做登录/验证码。', `await api.browser.record(tabId, 'start')`),
      a('text', 'browser.text(tabId, { ref } | 选择器, { maxChars? }?)', '取区域渲染文本', 'SPA 上纯 HTML 抓不到正文时用它；≤4000 字，不是截图。', `const text = await api.browser.text(tabId, '.article')`),
      a('scroll', 'browser.scroll(tabId, { by } | { to } | { ref })', '滚动网页页面', '无限滚动信息流的引擎；看返回的 atBottom，true 就 wait 再滚。ui.scroll 滚的是文档区，别混用。', `await api.browser.scroll(tabId, { by: 800 })`),
    ],
  ),
  g(
    'mcp',
    'MCP 外部服务',
    '用户配置的真实外部工具：列表、现场探测、调用。',
    `先 list 看服务与工具；工具不存在就 discover 刷新。参数按工具公布的说明给，
不要猜。失败回 { ok:false }，按值判断。写操作/不可逆动作先 api.ask。`,
    [
      a('list', 'mcp.list()', '列服务与工具', '回 id、名称、传输、状态与缓存的工具清单。', `const servers = await api.mcp.list()`),
      a('discover', 'mcp.discover(server?)', '现场探测工具清单', 'SSE 服务实时请求，可能要等几秒；省略=探全部已启用服务。', `const tools = await api.mcp.discover('github')`),
      a('call', 'mcp.call(server, tool, args?)', '调一个外部工具', '参数按工具 description 给；结果回服务端文本，失败回 { ok:false }。', `await api.mcp.call('github', 'search_repos', { q: 'moji-notes' })`),
    ],
  ),
  g(
    'ui',
    '界面操作',
    '吐司、定位文档、滚动、截图、打开超级文档、受控 DOM。',
    `界面操作是「给用户看」的，不是数据读写。定位优先用 ui.point，
截图只在视觉必须亲眼看时用。`,
    [
      a('toast', 'ui.toast(message)', '弹一条吐司', '一句话，≤200 字；不要用它替代正式回复。', `await api.ui.toast('讲义已生成')`),
      a('point', 'ui.point(path?, tab?)', '打开并定位文档', '把教学文档/笔记在文档区打开并定位；交付后指引用户看这里。', `await api.ui.point('极限')`),
      a('scroll', 'ui.scroll({ to?, by? })', '滚文档区', 'to: top/bottom；by: 像素。滚的是文档区，不是网页。', `await api.ui.scroll({ to: 'top' })`),
      a('screenshot', 'ui.screenshot()', '截文档区', '截图进资源库并挂到下一跳；只在视觉必须亲眼看时用。', `await api.ui.screenshot()`),
      a('superdoc', 'ui.superdoc(path?, name)', '打开超级文档页签', '写完 api.sdoc.write 后用它让用户看到。', `await api.ui.superdoc('极限', '夹逼实验')`),
      a('dom', 'ui.dom(async (root) => { ... })', '受控 DOM 读写', 'root 提供 exists/count/query/text/attr/html/rect/click 等；只用于文档区。', `await api.ui.dom(async (root) => { return await root.text('h1') })`),
    ],
  ),
  g(
    'subagent',
    '子代理',
    '并发派活：创建、运行、恢复、干预、中断、查看、删除、等待。',
    `子代理适合长文档通读、繁重检索、独立并行任务。它们的 api 面按 apiGroups 白名单裁剪；
不要指望子代理有 wf/state/exam 这些导师专用组。`,
    [
      a('create', 'subagent.create({ name?, task, apiGroups?, ... })', '创建一个子代理任务', '任务写清楚交付物与边界；apiGroups 只从允许名单里选。', `const sa = await api.subagent.create({ name: '读论文', task: '通读这篇论文并给出方法-实验-结论摘要', apiGroups: ['web', 'res'] })`),
      a('run', 'subagent.run({ id? })', '启动子代理任务', '启动后用 subagent.wait 收交付；不要对同一个重复 run。', `await api.subagent.run({ id: sa.id })`),
      a('resume', 'subagent.resume(id)', '继续一个已完成的子代理', '在同一份会话上追加指令接着跑，上下文不丢。', `await api.subagent.resume(sa.id)`),
      a('intervene', 'subagent.intervene(id, message)', '给运行中的子代理插一条指令', '用于纠偏；消息排队等子代理下一跳消费，不要频繁打断。', `await api.subagent.intervene(sa.id, '先只看第 3 节')`),
      a('interrupt', 'subagent.interrupt(id)', '中断一个子代理任务', '立刻停跑但保留已产出的内容；之后可用 resume 继续。', `await api.subagent.interrupt(sa.id)`),
      a('view', 'subagent.view(id)', '查看子代理会话详情', '回状态、消息流与交付；判断它卡没卡、跑偏没跑偏时用。', `const detail = await api.subagent.view(sa.id)`),
      a('delete', 'subagent.delete(id)', '删除一个子代理会话', '不可逆；交付没拿走前不要删。', `await api.subagent.delete(sa.id)`),
      a('wait', 'subagent.wait({ seconds? })', '等子代理交付', '回已完成/仍在跑/出错三类；不要用 sleep 轮询。', `const done = await api.subagent.wait({ seconds: 60 })`),
    ],
  ),
  g(
    'permission',
    '路径放行',
    '外部目录的查看、撤销与审批。',
    `数据根恒可访问；外部路径要用户放行。被拒后不要反复重试同一个路径，
把原因讲给用户，或改用数据根内的 workspace/。`,
    [
      a('list', 'permission.list()', '看当前作用域', '回 root 与 allowedDirs。', `const scope = await api.permission.list()`),
      a('revoke', 'permission.revoke(path)', '撤销一个放行目录', '归一化后精确匹配；数据根不可撤销。', `await api.permission.revoke('D:/shared')`),
      a('request', 'permission.request({ path, reason? })', '请求放行外部目录', '弹审批卡片并阻塞；批准后立刻生效。', `const r = await api.permission.request({ path: 'D:/datasets', reason: '读取课程数据集' })`),
    ],
  ),

  /* ---------- 通用文件与运行时 ---------- */
  g(
    'files',
    '通用文件（受限）',
    '只用于工作区、静态资源、技能与外部文件；不能读写应用数据。',
    `files.* 是通用文件系统，不是应用数据的入口。允许的范围：
- docs/.../workspace/**（用户交付物，优先用 api.workspace.*）；
- docs/.../static/**（静态资源，优先用 api.res.*）；
- skills/**（技能文件，优先用 api.skill.*）；
- 数据根之外、用户已放行的目录。
教学文档、笔记、大纲、meta、试卷、superdocs、chat.json、state.json、user.yaml、
workflow.json、method.json、reading.json 等应用数据一律走对应 api 组；
files.* 碰到它们会被拒绝，并提示该用哪一组。`,
    [
      a('read', 'files.read(path, { encoding?, offset?, maxBytes? }?)', '读真实文件', '只读非应用数据；文本支持 offset/maxBytes，二进制用 base64。', `const src = await api.files.read('docs/目标/节点/workspace/main.py')`),
      a('write', 'files.write(path, content, { encoding?, overwrite? }?)', '写真实文件', '父目录自动建；只写非应用数据。交付物优先 api.workspace.write。', `await api.files.write('docs/目标/节点/workspace/notes.txt', 'hello')`),
      a('edit', 'files.edit(path, { replace?, edits?, content?, start?, end? }?)', '改真实文件', '支持字符串替换、多项编辑、区间替换；只改非应用数据。', `await api.files.edit('docs/目标/节点/workspace/main.py', { replace: { target: 'print(1)', replacement: 'print(2)' } })`),
      a('list', 'files.list(path?)', '列一个目录的清单', '只列非应用数据目录；应用数据（docs/ 下的数据文件）会被拒绝，用 api.graph.list / api.doc.*。', `const items = await api.files.list('docs/目标/节点/workspace')`),
      a('stat', 'files.stat(path)', '查文件或目录的属性', '回大小、类型与时间戳；只查非应用数据。', `const st = await api.files.stat('docs/目标/节点/workspace/main.py')`),
      a('mkdir', 'files.mkdir(path)', '创建一个目录', '父级自动递归；只建非应用数据目录（workspace/、static/、skills/、外部）。', `await api.files.mkdir('docs/目标/节点/workspace/output')`),
      a('copy', 'files.copy(from, to, { overwrite? }?)', '复制文件或目录', '两端都必须是非应用数据；目标存在时按 overwrite 决定是否覆盖。', `await api.files.copy('docs/目标/节点/workspace/a.txt', 'docs/目标/节点/workspace/b.txt')`),
      a('move', 'files.move(from, to)', '移动/重命名', '两端都必须是非应用数据；应用数据改名用 node.rename / doc.write。', `await api.files.move('docs/目标/节点/workspace/a.txt', 'docs/目标/节点/workspace/b.txt')`),
      a('delete', 'files.delete(path)', '删除文件/目录', '只删非应用数据；不可逆，先确认。', `await api.files.delete('docs/目标/节点/workspace/tmp.txt')`),
    ],
  ),
  g(
    'process',
    '受控进程',
    '创建、启动、查询、停止、清理原生子进程。',
    `进程任务默认创建后不执行，start 才启动；生命周期与应用强绑定。
不要用 process 去读写应用数据——应用数据有专门 api；也不要用它绕过 files.* 的路径限制。
不可逆命令先 api.ask。`,
    [
      a('create', 'process.create({ command, args?, cwd?, env? })', '创建进程任务', 'cwd 必须在可访问目录内；创建后默认不跑。', `const p = await api.process.create({ command: 'python', args: ['main.py'], cwd: 'D:/work' })`),
      a('start', 'process.start(process_id)', '启动进程', '回 pid 与 running。', `await api.process.start(p.process_id)`),
      a('status', 'process.status(process_id)', '查进程状态', '回 running / exitCode。', `const st = await api.process.status(p.process_id)`),
      a('output', 'process.output(process_id, { offset?, reset? }?)', '读取进程的标准输出与错误', '支持增量读（带 offset 续读）；长输出分段拿，不要一次全量。', `const out = await api.process.output(p.process_id)`),
      a('stop', 'process.stop(process_id, { timeoutMs?, force? }?)', '停止进程', '先温和后强杀；force 会丢未落盘内容。', `await api.process.stop(p.process_id, { force: true })`),
      a('list', 'process.list()', '列进程任务', '回当前 agent 有权访问的全部任务。', `const all = await api.process.list()`),
      a('get', 'process.get(process_id)', '进程详情', '回命令、参数、cwd、状态、退出码。', `const one = await api.process.get(p.process_id)`),
      a('delete', 'process.delete(process_id)', '销毁一个进程任务', '运行中的会先强杀再删；只是清理记录，不影响已落盘的产物。', `await api.process.delete(p.process_id)`),
    ],
  ),
  g(
    'skill',
    '专业技能',
    '技能库：路径、列表、读规范、跑脚本、写、删。',
    `技能是渐进式开示的能力包：先 list 看索引，要用了再 read 拿完整规范。
脚本只能从 skills/<id>/scripts/ 里跑，不能拿它执行任意命令。`,
    [
      a('paths', 'skill.paths(id?)', '技能目录路径', '回 root / dir / scriptsDir / referencesDir / skillMd。', `const paths = await api.skill.paths('pdf')`),
      a('list', 'skill.list()', '列出全部已启用技能', '回名称、绝对目录与专属脚本清单；挑技能时先看它。', `const skills = await api.skill.list()`),
      a('read', 'skill.read(id)', '读技能完整规范', '调用即激活到短期上下文；回 instructions / scripts / references。', `const skill = await api.skill.read('pdf')`),
      a('run', 'skill.run(id, scriptName, args?)', '跑技能脚本', '只跑 skills/<id>/scripts/ 下的脚本；回 output / exitCode。', `const r = await api.skill.run('pdf', 'extract.py', ['input.pdf'])`),
      a('write', 'skill.write(skillDef)', '写/覆盖技能', '结构化维护技能定义；也可用 files.* 直接读写 skills/。', `await api.skill.write({ id: 'my-skill', name: '我的技能', instructions: '...' })`),
      a('delete', 'skill.delete(id)', '删除一个专业技能', '不可逆；整个技能目录（规范/脚本/参考）一并删除。', `await api.skill.delete('my-skill')`),
    ],
  ),

  /* ---------- 兼容/内部：不进 Worker 名单 ---------- */
  g(
    'description',
    '节点描述（兼容）',
    '旧的 description.* 兼容层；新写法用 node.update。',
    `保留实现是为了老对话与老探针；新编排不要用。请直接 api.graph.update(path, { description })。`,
    [
      a('read', 'description.read(path?)', '读节点描述', '等价于 node.read(path).description。', `const d = await api.description.read('极限')`, { exposed: false, deprecated: '用 api.graph.update(path, { description })' }),
      a('update', 'description.update(path?, content)', '改节点描述', '等价于 node.update(path, { description })。', `await api.description.update('极限', '新描述')`, { exposed: false, deprecated: '用 api.graph.update(path, { description })' }),
    ],
  ),
]

/** full → doc 的索引：wrapApi、__help、目录共用 */
const FULL_INDEX = new Map<string, ApiDoc>()
/** full → group 的索引 */
const GROUP_OF_FULL = new Map<string, ApiGroupDoc>()
for (const group of API_GROUPS) {
  for (const api of group.apis) {
    if (FULL_INDEX.has(api.full)) {
      throw new Error('[apiRegistry] 重复登记 api：' + api.full)
    }
    FULL_INDEX.set(api.full, api)
    GROUP_OF_FULL.set(api.full, group)
  }
}

/** 一条 api 的登记；没有就是没登记，wrapApi 会拦 */
export function apiDocOf(full: string): ApiDoc | null {
  return FULL_INDEX.get(full) ?? null
}

/** 一条 api 属于哪一组 */
export function apiGroupOf(full: string): ApiGroupDoc | null {
  return GROUP_OF_FULL.get(full) ?? null
}

/** 是否真的进 Worker 名单 */
export function isExposed(api: ApiDoc): boolean {
  return api.exposed !== false && !api.deprecated
}

/** 对外可见的组（至少有一条 exposed api） */
export function exposedGroups(): ApiGroupDoc[] {
  return API_GROUPS.filter((group) => group.apis.some(isExposed))
}

/** Worker 的 API_NAMES：从注册表派生，不再手抄 */
export function exposedApiNames(): string[] {
  return API_GROUPS.flatMap((group) => group.apis.filter(isExposed).map((api) => api.full))
}

/* ---------- 渲染 ---------- */

const AVAILABILITY_LABEL: Record<ApiAvailability, string> = {
  always: '恒可用',
  exam: '试卷组：宿主注入 exam 时可用',
  ui: '界面组：宿主注入 ui 时可用',
  browser: '浏览器组：宿主注入 browser 时可用',
  subagent: '子代理组：导师专用',
  mcp: 'MCP 组：用户启用 MCP 时可用',
  conditional: '条件组：宿主注入时可用；没有注入时调用会回「沙箱里没有这个 api」',
}

/** `api.__help()` 的正文 */
export function renderRootHelp(): string {
  const lines = ['execute 沙箱 api 集（先查组，再查单条 api）：', '']
  for (const group of exposedGroups()) {
    lines.push(
      group.key === 'core'
        ? '- 顶层函数 — ' + group.label + '：' + group.intro
        : '- api.' + group.key + ' — ' + group.label + '：' + group.intro,
    )
  }
  lines.push(
    '',
    '用法：',
    '    await api.<组>.__help()        // 这一组有哪些 api、签名与一句话用法',
    '    await api.<组>.<api>.__help()  // 这一条 api 的参数、返回、完整用法与示例',
    '    await api.__help()             // 这份总览',
    '',
    '纪律：不要凭记忆猜 api 名或参数；先 __help 再写。应用数据用对应组，files.* 只用于工作区/静态资源/技能/外部文件。',
  )
  return lines.join('\n')
}

/** `api.<group>.__help()` 的正文 */
export function renderGroupHelp(key: string): string {
  const group = API_GROUPS.find((x) => x.key === key)
  if (!group) return '没有 api.' + key + ' 这一组。先 await api.__help() 看有哪些组。'
  const items = group.apis.filter(isExposed)
  if (!items.length) return 'api.' + key + ' 这一组在当前版本没有可用的 api。'
  const title = key === 'core' ? '顶层函数（api.<name>）' : 'api.' + key + ' — ' + group.label
  const lines = [title, '', group.usage, '', '可用 api：']
  for (const api of items) {
    lines.push('- ' + api.signature + ' — ' + api.summary)
  }
  if (group.example) {
    lines.push('', '组示例：', group.example)
  }
  lines.push(
    '',
    key === 'core'
      ? '单条用法：await api.<name>.__help()'
      : '单条用法：await api.' + key + '.<api>.__help()',
  )
  return lines.join('\n')
}

/** `api.<group>.<api>.__help()` 的正文 */
export function renderApiHelp(full: string): string {
  const api = apiDocOf(full)
  if (!api) {
    const group = full.includes('.') ? full.slice(0, full.indexOf('.')) : ''
    return (
      '没有登记 api.' +
      full +
      '。' +
      (group ? '先 await api.' + group + '.__help() 看这一组有哪些 api。' : '先 await api.__help() 看有哪些组。')
    )
  }
  const lines = [api.full, '签名：' + api.signature, '', '作用：' + api.summary, '', '用法：' + api.usage]
  if (api.params) lines.push('', '参数：' + api.params)
  if (api.returns) lines.push('', '返回：' + api.returns)
  lines.push('', '示例：', api.example)
  for (const ex of api.examples ?? []) lines.push('', ex)
  if (api.availability && api.availability !== 'always') {
    lines.push('', '可用性：' + AVAILABILITY_LABEL[api.availability])
  }
  if (api.deprecated) lines.push('', '已退役：' + api.deprecated)
  return lines.join('\n')
}

/**
 * 预先渲染好的帮助文本：Worker 启动时注入，`__help()` 同步返回，
 * 不花一次宿主往返。
 */
export interface SandboxHelp {
  root: string
  groups: Record<string, string>
  apis: Record<string, string>
}

export function buildSandboxHelp(): SandboxHelp {
  const groups: Record<string, string> = {}
  const apis: Record<string, string> = {}
  for (const group of exposedGroups()) {
    groups[group.key] = renderGroupHelp(group.key)
    for (const api of group.apis.filter(isExposed)) {
      apis[api.full] = renderApiHelp(api.full)
    }
  }
  return { root: renderRootHelp(), groups, apis }
}

/** 系统提示词里的 api 集索引：只给组名与一句说明，不给具体签名 */
export function groupIndexForSystemPrompt(): string {
  return exposedGroups()
    .map((group) =>
      group.key === 'core'
        ? '- 顶层函数：' + group.intro
        : '- api.' + group.key + ' — ' + group.label + '：' + group.intro,
    )
    .join('\n')
}

/** 设置页/子代理 brief 用的简洁清单：组 → 条目 */
export function catalogGroups(): Array<{
  key: string
  label: string
  intro: string
  items: Array<{ name: string; signature: string; summary: string; availability: ApiAvailability }>
}> {
  return exposedGroups().map((group) => ({
    key: group.key,
    label: group.label,
    intro: group.intro,
    items: group.apis.filter(isExposed).map((api) => ({
      name: api.full,
      signature: api.signature,
      summary: api.summary,
      availability: api.availability ?? 'always',
    })),
  }))
}

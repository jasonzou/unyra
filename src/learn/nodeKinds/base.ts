/**
 * 节点类型的**登记契约**。
 *
 * ## 为什么要有这一层
 *
 * 以前「一种节点类型」的知识散在四个地方：类型清单、显示名、连线规则、同列排序权重，
 * 全写在 `structure.ts` 里；落盘格式在 `files/build.ts`，卡片渲染在画布组件。
 * 于是**加一种挂件要改 9 处、跨 4 层**，漏一处就"能存但看不见"或"画布上有但 agent 不知道"。
 *
 * 现在一种类型 = 一个文件，实现这个契约，在 `index.ts` 注册一行。其余全部派生。
 *
 * ## 加一种新类型要做的事（就这两步）
 *
 * 1. 新建 `nodeKinds/闪卡.ts`，导出一个 `NodeKindSpec`；
 * 2. 在 `nodeKinds/index.ts` 的 `NODE_KINDS` 里加一行。
 *
 * 类型清单、显示名、连线规则、同列排序会**自动**跟着变；漏写字段是编译期错误
 * （`satisfies Record<string, NodeKindSpec>` 会挡住）。
 */

/** 内容的落盘格式（P1 起用于单文件节点里的 parts） */
export type NodeFormat = 'markdown' | 'json' | 'html'

/**
 * 节点对象成员方法的登记项：agent 拿到 `api.node(path)` 返回的对象后能调什么，
 * 全部以这份声明为唯一来源——沙箱门面的方法表、`n.help()` 的正文、
 * 调用校验（没声明的方法一律拒绝并列出可用清单）都从它派生。
 */
export interface NodeMethodDoc {
  /** 方法名（节点对象上就叫这个） */
  name: string
  /** 给人看也给模型抄的签名 */
  signature: string
  /** 一句话作用 */
  summary: string
  /** 完整用法（可选；一般一句 summary 够用，差异点才写这里） */
  usage?: string
  /** 主示例（可选） */
  example?: string
  /** 返回值是另一个节点对象（如 note()/outline()）：沙箱门面据此把回执再包成节点对象 */
  returnsNode?: boolean
}

/** 正文与笔记共用的那套文本读写方法：同一份声明两个类型复用，说明按 subject 措辞 */
export function textMethods(subject: string): NodeMethodDoc[] {
  return [
    { name: 'read', signature: 'read()', summary: '读整份' + subject + '（回 { path, chars, content }）', example: 'const body = await n.read()' },
    { name: 'readRange', signature: 'readRange(start?, end?)', summary: '按字符区间分段读（默认从 0 读 1500 字）', example: 'const head = await n.readRange(0, 2000)' },
    { name: 'find', signature: 'find(要找的文字, { from?, limit? }?)', summary: '在' + subject + '里找文字（回命中位置与上下文）', example: "const hits = await n.find('夹逼')" },
    {
      name: 'write',
      signature: 'write(内容)',
      summary: '整份写入' + subject,
      usage: '整篇覆盖前先读，不要覆盖用户已有内容。',
      example: "await n.write('# 极限\\n\\n从数列极限开始……')",
    },
    { name: 'append', signature: 'append(内容)', summary: '追加到末尾（不覆盖已有正文）', example: "await n.append('\\n\\n## 补充：几何直觉')" },
    {
      name: 'replace',
      signature: 'replace({ start?, end?, content, expected? })',
      summary: '按区间改一处',
      usage: 'expected 是「改之前这儿应该是什么」——对不上就不改（防并发覆盖）。',
      example: "await n.replace({ expected: '旧的一句话', content: '新的一句话' })",
    },
  ]
}

export interface NodeKindSpec {
  /** 落盘的判别值，也是登记表的键 */
  type: string
  /** 中文名：卡片标题、api 说明、设置页目录共用这一份 */
  label: string
  /**
   * 同一列里的上下次序：越小越靠上。
   * 读图方向是「大纲 → 文档 → 叶子」，所以大纲 0、文档 1、叶子 2。
   */
  rank: number
  /**
   * 这个类型能连到哪些类型（有向：`from` 把上下文交给 `to`）。
   *
   * 原来这张表集中写在 `structure.ts` 的 `GRAPH_EDGE_RULES`，离类型本身很远——
   * 改一条连线规则得先想起它在哪个文件。现在规则跟着类型走。
   */
  targets: readonly string[]
  /** 内容默认存成什么 */
  format: NodeFormat
  /** 每个节点最多一份（正文、大纲）；不填 = 可以有任意多份（笔记、试卷、超级文档） */
  singleton?: boolean
  /**
   * 锚点卡：**没有入边是常态**——文档是子树的挂点（大纲、笔记都挂它下面），
   * 入口是整张图的起点。派生对账的「挂不上的新卡片不出现」不剪它们（见 structureSeed）。
   */
  anchor?: boolean
  /**
   * 上画布时这张卡的声明；不声明 = 这个类型不上画布。
   *
   * 一个数据节点可以有好几张卡（正文一张、大纲一张、每份笔记各一张），
   * 卡片身份是 `{节点uuid}:{kind}[:{name}]`，坐标存在节点文件的 `layout` 里。
   */
  facet?: { label: string }
  /**
   * 这个类型作为**节点对象**（api.node）开放给 agent 的成员方法清单。
   * help 索引、节点对象的方法表与调用校验都从这份声明派生（见 NodeMethodDoc）；
   * 不声明 = 这个类型不是内容载体（入口、试卷），api.node 取不到它的写法。
   * 声明了就必须有同名的行为类方法（nodeKinds/index 的 NODE_HANDLES 对账）。
   */
  methods?: readonly NodeMethodDoc[]
}

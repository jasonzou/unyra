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
   * 上画布时这张卡的声明；不声明 = 这个类型不上画布。
   *
   * 一个数据节点可以有好几张卡（正文一张、大纲一张、每份笔记各一张），
   * 卡片身份是 `{节点uuid}:{kind}[:{name}]`，坐标存在节点文件的 `layout` 里。
   */
  facet?: { label: string }
}

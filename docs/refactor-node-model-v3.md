# 学习数据模型 v3 重构计划（单文件节点 + 类型登记表 + 拓扑归一）

> **状态**：讨论定稿，**未执行**
> **日期**：2026-10-22
> **执行者**：未来的 agent 会话（这份文档就是交接说明，不要凭记忆改）
> **交付纪律**：每阶段结束 commit 一次；**不 push、不开 PR、不 merge**，除非用户显式要求。

---

## 0. 怎么用这份文档

1. **一次只做一个阶段**。阶段之间必须 `npm run typecheck` + `npm test` 全绿才能进下一个。
2. 每阶段末尾有「验收标准」，**验收不过就不算完成**，不要靠"看起来对了"。
3. 第 7 节「已知坑」是这份文档最贵的部分——里面每一条都对应一处会静默坏掉的地方。
4. 遇到与本文件冲突的现状代码：**以本文件为准，但先把冲突记到第 10 节**，不要自行发挥。

---

## 1. 背景与目标

用户诉求（2026-10-22 两次讨论的原话归纳）：

| # | 目标 | 判断标准 |
|---|---|---|
| G1 | **泛化** | 教学文档节点以后会挂各种挂件（闪卡、习题、代码沙箱、视频片段…），加一种不能散落改 9 处 |
| G2 | **可扩展** | 一种新挂件 = 一个登记文件；agent 侧零 api 改动 |
| G3 | **降维护** | 节点内容落点从「每种内容一个文件/目录」收敛到「一个节点一个文件」 |
| G4 | **降 agent 成本** | 拓扑规则归代码，模型只表达意图；读写内容的 api 收敛成一套 |

现状量化（本次调研实测）：

- 加一种挂件要动 **9 处、跨 4 层**：领域 3（`structure.ts` 的类型表/规则表/卡片高度、`structureSeed.ts` 的 leaves 装配）、落盘 2（`files/build.ts`、`files/parse.ts`）、画布 2（`StructureCanvas.tsx`、`structureView.ts`）、API 2（`sandbox/api.ts`、`apiRegistry.ts`）。
- 一个挂了 2 笔记 + 1 试卷 + 1 超管的节点落 **7 个文件**，其中试卷与超管**双写**（独立文件 + `meta.json` 里一整份），读回时还要按 id 去重。
- `files/meta.ts` 第 47 行注释写超级文档「不落独立文件」，而 `build.ts` 确实写了独立文件、`parse.ts` 也确实去读它 —— **注释与实现已经矛盾**，这是"同一份东西两个落点"的必然结果。

---

## 2. 非目标（明确不做，别顺手做）

- 不做云同步 / 多用户 / 实时协作。
- 不引入数据库、ORM、事件总线。
- 不改目标级账本（`chat.json` / `reading.json` / `essay.json` / `mind.json` / `method.json` / `workflow.json`）的**语义与文件名**。
- 不做"外部编辑器实时监听"（现在也没有，读盘只在启动）。
- 不动 `static/`（目标级资源库）与 `images/`（只读遗留）。

---

## 3. 已定决策

| # | 决策 | 理由 / 代价 |
|---|---|---|
| **D1** | 节点内容**全内联**到一个文件：正文、大纲、笔记、试卷、超级文档、学习状态、注解、坐标 | 用户明确选"彻底一点"；可读性由 md 导出兜底 |
| **D2** | 一个节点 = `nodes/{uuid}.json` + **可选的** `files/{uuid}/` | 图片/代码/PDF 进不了 JSON，目录不会真的消失 |
| **D3** | 目标目录用 uuid：`docs/{goalUuid}/`；人可读靠生成的 `index.md` | 目录名不再承担身份，改名不搬目录 |
| **D4** | 目标级账本**保持独立文件**，不并进 `goal.json` | `chat.json` 流式写入高频且体积大，合并会让每条消息重写整份账本 |
| **D5** | 画布卡 = 数据节点的 **facet**（面）；一个节点可以有多个 facet | 保住 2026-10-21 定的「文档 → 大纲 → 子文档」拓扑与两张卡的视觉，不动产品 |
| **D6** | 拓扑归**中央边表**；节点不存父子指针 | 单真相、移动=删一条+加一条、环检测集中 |
| **D7** | 类型用**抽象基类 + 登记表**；store 里存 plain record，实例只在读取边界构造 | class 实例进 store 会破坏 memo 比较、undo 快照、JSON 往返、缓存 |
| **D8** | api 三分：`graph.*` 管结构 / `content.*` 管内容 / `state.*` 管状态；`exam.*` 只留出卷判卷 | 新挂件零 api 改动 |
| **D9** | 磁盘路径不再承担身份；`key` 降级为显示别名 | 去掉"标题唯一"这条硬不变量 |
| **D10** | 目标本身就是一个节点：`goal.json`（`type: 'goal'`），`goalId` 就是它自己的 uuid | 消掉 `goal.id` 与 `rootNodeId` 两个 uuid 指一件事 |

---

## 4. 目标数据模型

### 4.1 磁盘布局

```
{root}/users/{uid}/
├─ state.json                      不变
├─ schema.json                     版本标记，写 0.8.0
└─ docs/
   ├─ index.md                     生成物：全部目标清单（标题 → uuid）
   └─ {goalUuid}/
      ├─ goal.json                 目标节点（type: 'goal'），parts 里含根教学文档
      ├─ index.md                  生成物：本目标节点清单（缩进树 + uuid）
      ├─ edges.json                拓扑：{ version, edges: [{from,to,rel,slot?}] }
      ├─ structure.json            只剩 { version, edgeStyle, viewport? }
      ├─ chat.json                 不变（目标级对话）
      ├─ reading.json              不变
      ├─ essay.json                不变
      ├─ mind.json                 不变
      ├─ method.json               不变
      ├─ workflow.json             不变
      ├─ nodes/{nodeUuid}.json     节点全量
      ├─ files/{nodeUuid}/...      该节点的真实文件（原 workspace/ 的内容）
      └─ static/                   目标级资源库（不变，manifest.json 也在里面）
```

**注意**：`goal.json` 就是目标节点的文件，**不**再在 `nodes/` 下放一份，避免两个落点。

### 4.2 节点文件形状

```jsonc
{
  "version": 3,
  "uuid": "9f1c…",
  "type": "doc",                    // 登记表主键（判别字段）
  "title": "极限",
  "goal": "3a77…",                  // 归属目标（= 目标节点的 uuid）
  "createdAt": 1729500000000,
  "updatedAt": 1729500000000,
  "status": "learning",             // learning | mastered
  "origin": "ai",
  "learning": { /* 原样，见 learn/learning.ts */ },
  "annotations": [ /* 原样 */ ],
  "layout": {                       // facet key → 画布坐标；没有就不在画布上
    "doc":     { "x": 0,   "y": 0 },
    "outline": { "x": 320, "y": 0 },
    "note:错题本": { "x": 640, "y": 0 }
  },
  "parts": [                        // ← 所有内容都在这，新增挂件 = 加一条
    { "kind": "teaching", "format": "markdown", "body": "# 极限\n…" },
    { "kind": "outline",  "format": "json",     "body": { "intro": "", "children": [] } },
    { "kind": "note",     "name": "错题本", "format": "markdown", "body": "…",
      "createdAt": 0, "updatedAt": 0 },
    { "kind": "exam",     "name": "8f2e…", "format": "json", "body": { /* Exam */ } },
    { "kind": "superdoc", "name": "讲义", "format": "html", "body": "<html>…" }
  ]
}
```

**parts 用数组而不是对象**：名字里可能有 `:`、`/`、空格，做 key 要转义；数组无冲突、顺序稳定。part 数量很少（个位数），线性查找无所谓。

**唯一性规则**：`singleton: true` 的 kind（`teaching` / `outline`）每节点最多一条；其余 `name` 在同一 kind 内唯一（与现在笔记名、超管名的规则一致）。

### 4.3 facet：数据节点 ↔ 画布卡

这是本次重构**唯一一处概念增加**，必须理解对：

| 概念 | 是什么 | 数量关系 |
|---|---|---|
| 数据节点 | 一个 uuid、一个文件 | N 个 |
| facet | 节点的一个"面"，画布上的一张卡 | 每节点 ≥1 个 |
| facet key | `${uuid}:${kind}` 或 `${uuid}:${kind}:${name}` | 例：`9f1c:doc`、`9f1c:outline`、`9f1c:note:错题本` |

- 画布卡**仍然是"文档卡 + 大纲卡"两张**，`GRAPH_EDGE_RULES` 的语义一字不改。
- 坐标存节点文件的 `layout`，按 facet key 分键 → 一个文件装下所有卡的坐标。
- 边表的端点写 **facet key**；解析时按 `:` 切第一段拿 uuid。
- facet 由登记表声明（`facets: [{ kind, label, cardHeight }]`）；**不上画布的挂件不声明 facet**。

**为什么不做成"一个节点一张卡"**：那会推翻 2026-10-21 用户亲自定的「文档 → 大纲 → 子文档」拓扑与两张卡的可读性，属于产品变更，不在本次范围。

### 4.4 边表

```jsonc
// docs/{goalUuid}/edges.json
{ "version": 1, "edges": [
  { "from": "9f1c:doc",     "to": "9f1c:outline", "rel": "expand" },
  { "from": "9f1c:outline", "to": "77ab:doc",     "rel": "slot", "slot": "极限" },
  { "from": "9f1c:doc",     "to": "9f1c:note:错题本", "rel": "attach" }
]}
```

`rel` 取值：`expand`（文档→自己的大纲）、`slot`（大纲→子文档，带接入点）、`attach`（文档→叶子）。
`canConnect` 由登记表的 `targets` 决定，**规则跟着类型走**，不再集中一张表。

内存里维护邻接索引：

```ts
// 用数组引用当版本号：store 不可变，引用变了就是内容变了
const adjacencyCache = new WeakMap<readonly Edge[], Adjacency>()
```

### 4.5 类型登记表

目录：`src/learn/nodeKinds/`，一种类型一个文件。

```ts
// base.ts
export interface NodeKindSpec {
  type: string                          // 落盘判别值
  label: string                         // 中文名（卡片标题、api 说明共用）
  format: 'markdown' | 'json' | 'html'  // part 的默认格式
  singleton?: boolean                   // 每节点最多一份
  targets: readonly string[]            // 能连到哪些类型（取代 GRAPH_EDGE_RULES）
  facets?: readonly FacetSpec[]         // 上画布时声明；不声明 = 不上画布
  cardHeight?: (node: NodeRecord, part?: PartRecord) => number
  agent?: { readable?: boolean; writable?: boolean; createHint?: string }
}

// index.ts
export const NODE_KINDS = {
  goal: goalKind, teaching: teachingKind, outline: outlineKind,
  note: noteKind, exam: examKind, superdoc: superdocKind,
} satisfies Record<string, NodeKindSpec>   // ← 漏一个类型编译期就报错
```

**新增一种挂件的完整动作**：新建 `src/learn/nodeKinds/flashcard.ts` 实现 `NodeKindSpec` → 在 `index.ts` 加一行。**别的地方一律不改。**

### 4.6 索引

| 索引 | 用途 | 缓存键 |
|---|---|---|
| `Map<uuid, NodeRecord>` | 取代 167 处 `nodeById` 的线性查找 | store.nodes 数组引用 |
| `Adjacency`（out/in） | 取代 `prereqIds` / `parentIds` 的全表 filter | edges 数组引用 |
| `Map<goalUuid, Map<normalizeKey, uuid[]>>` | agent 的 path 寻址（允许重名，所以是数组） | nodes 数组引用 |
| `nodeFileCache: Map<uuid, {node, edges, exams, goals, text}>` | **保存时只序列化变了的节点**（见第 6 节性能） | 引用相等 |

---

## 5. 分阶段任务

> 每个阶段都是"可独立交付、可独立回滚"的。**不要跨阶段混做。**

### P0 · 地基（行为零变化）

**目标**：把查找索引与类型登记表建起来，但**不改变任何行为与磁盘格式**。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/graph/lookup.ts` | `nodeById` 改走 `Map`；索引用 `WeakMap<nodes[], Map>` |
| `src/learn/graph/edges.ts` | `prereqIds` / `parentIds` 改走邻接索引 |
| `src/learn/nodeKinds/*` | 新建；六种类型的 `NodeKindSpec` 先只填 `type/label/targets`，**规则表暂时仍从 `structure.ts` 读** |
| `src/learn/structure.ts` | `GRAPH_EDGE_RULES` 改为从登记表派生（结果必须与现在逐项相同） |

**验收**
- `npm test` 全绿，且 `structure.test.ts` 里关于连线规则的用例一条不改就过。
- 加一个临时 kind（`flashcard`）只写一个文件 + 一行注册，**类型检查通过**（不需要任何其他改动）——证明登记表真的自洽。测完删掉。

**风险**：低。**回滚**：直接 revert。

---

### P1 · 持久化合并（磁盘格式变更）

**目标**：一个节点一个文件；旧的七种落点全部消失。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/types.ts` | 新增 `NodeRecord` / `PartRecord` / `FacetKey`；`KnowledgeNode` 逐步退役（P1 期间两个都保留） |
| `src/learn/files/build.ts` | 新增 `buildNodeFile(store, uuid)`；`buildDocs` 改为输出新布局；保留 `nodeFileCache` |
| `src/learn/files/parse.ts` | 新增 `parseNodeFile`；**保留旧解析器**（见兼容策略） |
| `src/learn/layout.ts` | `nodeLayout` 删除；新增 `goalDir(uuid)` / `nodeFile(uuid)` / `nodeFilesDir(uuid)` |
| `src/learn/files/names.ts` | 只留 `sanitizeSegment`（笔记/超管不再有独立文件名） |
| `src/lib/migration/v3Nodes.ts` | 新增迁移脚本 `m_0_7_1_to_0_8_0` |
| `src/lib/migration/scripts.ts` | 注册上面的脚本；`LATEST_SCHEMA_VERSION` → `0.8.0` |

**兼容策略（必须按这个顺序）**
1. 读：存在 `docs/*/goal.json` → 走 v3 解析；否则走 v2 解析（旧代码原样保留）。
2. 写：**只写 v3**。
3. 迁移：`docs/` 整目录复制一份 `docs.bak-{ts}/` → 读 v2 → 写 v3 → 校验 → 把旧目录改名为 `docs.legacy-{ts}/`（**不删**）。
4. 校验不通过 → 恢复 `docs.bak-{ts}` 并中止，`schema.json` 不升版本。

**验收（逐项对账，缺一不可）**
- 节点数一致；每份教学文档字数一致（±0）。
- 笔记：名字、顺序、正文逐字一致；空笔记仍然不落盘（= 迁移后没有这条 part）。
- 试卷：份数、id、attempts 数一致；超管：名字、html 逐字一致。
- 大纲：`intro` + `children` 的 `key` 顺序一致。
- 画布：节点数、边数、每条边的 from/to 语义、每张卡的坐标一致。
- 老 `.笔记.md`、`images/` 这类遗留数据不报错、不丢失。
- 迁移跑两遍结果相同（幂等）。

**风险**：**最高**。**回滚**：把 `docs.legacy-{ts}` 改回 `docs`，schema 版本改回 `0.7.1`。

---

### P2 · api 收敛（破坏性）

**目标**：agent 的 api 从 6 组变 3 组；新挂件零 api 改动。

| 现在 | 以后 |
|---|---|
| `graph.*`（list/read/title/paths/create/createTree/rename/update/annotate/move/relations/link/delete） | `graph.list / tree / read / create / move / link / unlink / delete` |
| `doc.*`、`outline.*`、`sdoc.*`、`exam.*` 的读写 | `content.read / write / append / find`（按 `part` 区分） |
| `state.*` | 不变 |
| `exam.*` 出卷/判卷 | 只留 `exam.create / start / submit / grade / read`（业务动作，不碰存储） |

`content.*` 的 target 写法（保持人类可读，内部转 uuid）：

```
content.read('极限')                 // 主内容（teaching）
content.read('极限/笔记/错题本')      // 指定 part
content.write('极限/大纲', {...})     // 大纲
content.read('#9f1c…/exam:8f2e…')    // facet/uuid 直指
```

改动：

| 文件 | 做什么 |
|---|---|
| `src/agent/sandbox/apiRegistry.ts` | 删 4 组、加 1 组、重写用法文本（这份是唯一真相，`__help()`、系统提示词索引、设置页目录全从它派生） |
| `src/agent/sandbox/api.ts` | 实现 `content.*`；`doc.*` / `outline.*` / `sdoc.*` 保留**薄别名**一个版本（只转发，不实现逻辑） |
| `src/agent/sandbox/types.ts` | 同步类型 |
| `tests/apiRegistry.test.ts` | 同步名单（登记表与测试是互相钉住的） |

**验收**
- `apiRegistry.test.ts` 全绿；`__help()` 输出里没有已删除的组。
- 一条断言：`content.read` 能读到 teaching / outline / note / exam / superdoc **五种**内容，写法只有一种。
- 系统提示词里的 api 索引重新生成，长度**不超过**改动前（这是收敛的硬指标）。

**风险**：中（破坏性但可灰度：别名兜住老写法）。**回滚**：恢复 `apiRegistry.ts` 与 `api.ts`。

---

### P3 · 拓扑归一

**目标**：数据边与画布边合成一张；删掉"对账"与"用户删过的名单"。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/structure.ts` | 删 `StructureNode` / `GraphEdge` / `canAddEdge` / `normalizeStructure` 里的节点部分；只留几何（`CARD_W`、`fitZoom`、`centerPan`）与 `edgeStyle` |
| `src/learn/structureSeed.ts` | 删 `reconcileStructure`；`structureFromStore` 改成"首次打开时建一次边" |
| `src/learn/graph/*` | 新增 `GraphStore` 服务：`link / unlink / move / remove`，内部保证不重复、不成环、级联 |
| `src/components/learn/structure/StructureCanvas.tsx` | 节点/边从 store 派生，不再写 `structure.json` 的 nodes/edges |
| `src/learn/files/build.ts` | `structure.json` 只写 `edgeStyle` + `viewport` |

**验收**
- agent 新建的任何内容（文档/笔记/试卷/超管）**立刻**出现在画布上，无需对账。
- 用户删掉的连线**不会**在下次打开时自己长回来。
- `structure.json` 里不再有 `nodes` / `edges` / `hidden`。

**风险**：中高（画布手势、撤销、持久化全在这条线上）。**回滚**：保留旧 `structure.json` 不删，代码 revert。

---

### P4 · 清理

- 删 `key` 的唯一性约束（`addNode` 的同名复用、`titleTaken`、`rename` 的重名拦截）。
- 删 `*Gid` 合成 id、`nodeLayout` 的 BFS、`resolveNode` 的四级模糊兜底。
- 删 `assetMoves` / `ASSET_DIRS` 的搬迁逻辑（目录不再随标题改名）。
- 删旧解析器（v2 兼容读保留一个版本后）。
- 重写 `docs/data-and-privacy.md`（见第 7 节第 5 条）。

**验收**：`npm run typecheck` + `npm test` 全绿；`grep` 不到 `GRAPH_KIND_LABEL` / `noteGid` / `nodeLayout`。

---

## 6. 性能：必须保留的缓存

合并后没有独立的 `meta.json` 可以缓存，**但 `buildDocs` 仍然必须只序列化"变了的节点"**，否则每次保存要 `stringify` 全量：

- 现在：`metaCache` 用 `cached.node === node && cached.edges === store.edges && …` 判断。
- 以后：`nodeFileCache` 用同样的凭据，命中时**直接复用上次的整份文件文本**。
- 依赖前提：store 不可变、节点对象引用稳定。**任何 `{...node}` 的无谓重建都会让该节点全量重写**，P1 时要审计一遍。

实测参考（本机，Node 22）：`stringify` 4MB 内容 8.4ms、编码 1.2ms。**CPU 不是瓶颈**，瓶颈是每次保存把 1~4MB 字符串过 IPC。若单节点超过 4MB，把 `superdoc` 的 html 外置到 `files/{uuid}/`（这是唯一预留的例外，写进 `NodeKindSpec` 的 `external?: boolean`）。

---

## 7. 已知坑（每条都对应一处会静默坏掉的地方）

1. **chip 里存了物理路径** — `src/learn/chipRef.ts` 的 `matches()` 要求 chip 的 `path` 与 `nodeDocPath` 结果一致；布局一变，**老会话里的引用点不开**。
   处理：改为「带 `nodeId` 就信 `nodeId`，`path` 只做兜底」，并给 `tabRefFromChip` 补一条"路径已过时但仍能按 id 命中"的测试。
2. **`graph.paths` 的 8 个字段全失效** — `dir / doc / notesDir / outline / meta / superdocsDir / examsDir / workspaceDir` 收敛成 `{ file, filesDir }`。模型可能已把旧字段写进笔记，需在 api 变更说明里点名。
3. **`nodeDocPath` 的"在资源管理器中打开"** — 以后点开是 JSON。改成"打开所在文件夹"，或在 `files/{uuid}/` 下生成一份导出副本（**默认不生成**，只在用户点"在文件夹中显示"时导出）。
4. **`wsChipUserRel` 里 `p.startsWith(DOCS_DIR + '/')` 直通** — 老 workspace 路径会直接透传成不存在的路径。改成"透传前先确认文件存在，否则按新规则重算"。
5. **产品承诺变更** — `docs/data-and-privacy.md` 现在明写「`.md` 是干净的正文，可以脱离应用直接读、改、备份」。**必须同步改写**，并说明"导出 md"这条替代路径（`useExportFlow` 已有 md / html / pdf 三条路）。
6. **`exam.nodeId` / 笔记名唯一性** — 合并后 exam 是 part，`store.exams` 变成派生索引；`exam.nodeId` 保留（指向宿主 uuid），不要删字段，否则 `chipRef` 的 exam 分支要重写。
7. **`slot` 的语义** — 它是「大纲的哪条目标项被哪个子文档落地」，属于**边**不属于节点。P3 必须把它从节点搬到边上，否则一个文档只能占一个接入点。
8. **StrictMode 双跑** — `main.tsx` 无条件包了 StrictMode，dev 下 effect 跑两遍。任何"取一次就没"的迁移/初始化逻辑要配 done 哨兵（见 `lib/docReveal` 的旧坑）。
9. **CRLF** — 工作区是 CRLF、blob 是 LF。用脚本改多行文本前先归一成 `\n`，写回时还原，否则匹配必然失败。
10. **写盘排队** — `electron/storage/files.ts` 对**同一目标文件**串行排队。单文件变大后，一次保存占用队列更久，`state.json` 这类高频小写入可能被拖慢。P1 后要复测"边打字边看阅读计时"是否卡顿。

---

## 8. 测试影响面

预计要改的测试（约 22 个）：

`buildDocsChunked` · `chatPersist` · `chipOps` · `dataPaths` · `docReveal` · `examMigration` · `explorerReveal` · `migration` · `migrationStructure` · `notes` · `outline` · `outlineMindmap` · `perGoal` · `persistCommit` · `readingPersist` · `structure` · `structureView` · `superdocHtml` · `superdocs` · `teachDocGroup` · `workspace` · `wsTabs` · `apiRegistry`

**新增测试（必须写）**
- `nodeFile`：一个节点的所有内容能 round-trip（build → parse → 深度相等）。
- `nodeFileCache`：没变的节点不重新序列化（用 spy 数 `stringify` 调用次数）。
- `migrationV3`：迁移幂等 + 逐项对账（第 5 节 P1 的验收清单逐条断言）。
- `facet`：一个节点的 doc 与 outline 是两张卡、坐标互不影响、边端点能解析回 uuid。
- `contentApi`：五种 part 读写各一条，写法只有一种。

---

## 9. 术语表

| 词 | 意思 |
|---|---|
| 数据节点 | 一个 uuid、一个 `nodes/{uuid}.json` |
| part | 节点里的一段内容（正文/大纲/笔记/试卷/超管/未来的闪卡） |
| facet | 节点在画布上的一个"面"（一张卡），key = `${uuid}:${kind}[:${name}]` |
| 登记表 | `NodeKindSpec` 的集合，一种类型一个文件 |
| 落点 | 一份内容在磁盘上的存放位置（本次重构就是把落点从 7 个收敛到 1 个） |
| 目标级账本 | 挂在目标上、不挂节点的数据（对话、阅读、随笔、记忆、函数、工作流） |

---

## 10. 未决问题（执行到这里必须先问用户）

1. **`index.md` 要不要进版本比对**：它是生成物，内容不变时 diff 不会重写，但如果节点标题变了它会变——可接受。**默认：写，且不参与用户编辑**。
2. **旧 api 别名保留几个版本**：默认保留一个版本（`doc.*` / `outline.*` / `sdoc.*` 转发到 `content.*`），下个版本删。
3. **`files/{uuid}/` 里要不要保留"导出 md"的副本**：默认**不保留**（按需导出）。
4. **P1 是否要拆成"双写一个版本"**：如果用户担心迁移风险，可以先双写（新+旧都写）一个版本再切单写。代价是磁盘翻倍、IO 翻倍。

---

## 11. 执行前检查清单

- [ ] 用户确认 D1–D10（尤其 D5 facet 与 D3 uuid 目录）。
- [ ] 用户确认第 10 节的四个未决问题。
- [ ] `git status` 干净（本项目常驻别人未提交的改动，动手前必须确认）。
- [ ] 跑一次 `npm test` 记录基线（哪些本来就是红的）。
- [ ] 准备一份真实数据目录做迁移演练（**不要拿用户唯一的真实数据当试验品**）。
- [ ] 确认 `useExportFlow` 的 md 导出覆盖正文（用户选择 D1 的前提）。

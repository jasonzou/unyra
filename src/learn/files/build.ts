/** 这个文件负责什么：内存 → 磁盘——把整份学习数据摊成「相对路径 → 文件内容」（buildDocs），以及某个节点的文件在数据根下的落点（nodeDocPath）。 */

/* ---------- 内存 → 磁盘 ---------- */

import type { DependencyEdge, DocKind, LearnStore } from '../types'
import type { Exam } from '../exam'
import { DOCS_DIR, MANIFEST_FILE, STATIC_DIR, nodeLayout } from '../layout'
import { manifestText } from '../static/manifest'
import { CHAT_VERSION, TMP_VERSION, jsonText, tmpText } from './meta'
import { NODE_FILE_SUFFIX, NODE_FILE_VERSION, partsOfNode, type NodeFile } from './nodeFile'
import { yieldToMain } from '../../lib/yieldToMain'

/**
 * 一个节点上一次序列化出来的**整份文件文本**（见 buildDocs 里的复用判断）。
 *
 * 为什么可以复用：`JSON.stringify` 是整份摊平里最贵的一笔，而一次保存里绝大多数节点
 * 一个字都没动。凭据是**节点对象本身 + 派生它的那三份 store 级数组**：
 * store 是不可变的（图操作一律返回新 store，数组只换不原地改），这四样全同就意味着
 * 这一份文件的每个字段都同、JSON 文本逐字节相同。
 *
 * 注意与旧版的差别：旧版缓存的是很小的 meta.json（正文在单独的 .md 里，直接取字符串即可）；
 * 合并成单文件之后，**正文也在缓存里**——缓存命中与否直接决定"这次保存要不要重新序列化
 * 一整篇正文"，所以它比以前更要紧，别删。
 */
interface NodeFileCacheEntry {
  node: LearnStore['nodes'][number]
  edges: LearnStore['edges']
  exams: LearnStore['exams']
  goals: LearnStore['goals']
  text: string
}

let nodeFileCache = new Map<string, NodeFileCacheEntry>()

/** 凭据全同 ⇒ 上一份文件文本可以原样再用（理由见 NodeFileCacheEntry） */
function cacheReusable(
  cached: NodeFileCacheEntry | undefined,
  node: NodeFileCacheEntry['node'],
  store: LearnStore,
): cached is NodeFileCacheEntry {
  return (
    !!cached &&
    cached.node === node &&
    cached.edges === store.edges &&
    cached.exams === store.exams &&
    cached.goals === store.goals
  )
}

/**
 * 把整份学习数据摊成「相对路径 → 文件内容」。
 *
 * 路径是**相对用户根目录**的，必须以 `docs/` 开头——读（parseDocs）、写
 * （store 的 userRel）、差异比对（diffDocs）三处共用同一套路径，
 * 少一层前缀就会「写得进去、读不回来」。
 *
 * 它是**生成器**：每处理完一个节点就 `yield` 一次，由调用方决定要不要真的把主线程
 * 让出去（见下面的 buildDocs / buildDocsChunked）。
 */
function* buildDocsSteps(store: LearnStore): Generator<void, Map<string, string>, void> {
  const files = new Map<string, string>()
  const byId = new Map(store.nodes.map((n) => [n.id, n]))

  // 依赖边按来源分组：写进各自的节点文件
  const deps = new Map<string, DependencyEdge[]>()
  for (const e of store.edges) {
    const dl = deps.get(e.from)
    if (dl) dl.push(e)
    else deps.set(e.from, [e])
  }

  /** 检验记录按节点分组、目标按 id 查表：都搬到按节点循环的**外面**做一次 */
  const examsOf = new Map<string, Exam[]>()
  for (const e of store.exams) {
    const list = examsOf.get(e.nodeId)
    if (list) list.push(e)
    else examsOf.set(e.nodeId, [e])
  }
  const goalById = new Map<string, LearnStore['goals'][number]>()
  for (const g of store.goals) if (!goalById.has(g.id)) goalById.set(g.id, g)

  /** 这一轮还要复用的文件文本；循环结束后整张换上去（见 NodeFileCacheEntry） */
  const nextCache = new Map<string, NodeFileCacheEntry>()

  for (const [id, { dir, base }] of nodeLayout(store)) {
    const node = byId.get(id)
    if (!node) continue
    const goal = goalById.get(node.goalId)
    const path = [DOCS_DIR, ...dir].join('/')

    const cached = nodeFileCache.get(id)
    let text: string
    if (cacheReusable(cached, node, store)) {
      text = cached.text
      nextCache.set(id, cached)
    } else {
      const file: NodeFile = {
        version: NODE_FILE_VERSION,
        id: node.id,
        type: 'doc',
        title: node.title,
        key: node.key,
        description: node.description,
        status: node.status,
        origin: node.origin,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        annotations: node.annotations,
        ...(node.learning !== undefined ? { learning: node.learning } : {}),
        ...(node.tint !== undefined ? { tint: node.tint } : {}),
        dependencies: (deps.get(node.id) ?? []).map((e) => ({ to: e.to, createdAt: e.createdAt })),
        parts: partsOfNode(node, examsOf.get(node.id) ?? []),
        // 目标信息只写在根节点的文件里：一个目标一份文档，根节点就是那份文档
        ...(goal && id === goal.rootNodeId
          ? {
              goal: {
                id: goal.id,
                question: goal.question,
                createdAt: goal.createdAt,
                updatedAt: goal.updatedAt,
              },
            }
          : {}),
      }
      text = jsonText(file)
      nextCache.set(id, {
        node,
        edges: store.edges,
        exams: store.exams,
        goals: store.goals,
        text,
      })
    }
    files.set(`${path}/${base}${NODE_FILE_SUFFIX}`, text)

    /**
     * 目标级账本写在**目标目录**里（一个目标一份上下文）。目标目录同时就是根节点的目录，
     * 所以判据是「这个节点是不是根」而不是「这个节点有没有对话」。
     */
    if (goal && id === goal.rootNodeId) {
      const conversations = store.conversations.filter((c) => c.goalId === goal.id)
      files.set(`${path}/chat.json`, jsonText({ version: CHAT_VERSION, conversations }))
      /** 资源清单写在目标目录的资源目录里（见 learn/static）。没有资源就不写这个文件 */
      const resources = store.resources?.[goal.id] ?? []
      if (resources.length) {
        files.set(`${path}/${STATIC_DIR}/${MANIFEST_FILE}`, manifestText(resources))
      }
      /** 工作记忆（memory.work）写在目标目录里；没有记忆就不写文件 */
      const workMemory = store.memory?.work?.[goal.id] ?? []
      if (workMemory.length) {
        files.set(`${path}/mind.json`, jsonText({ version: 2, work: workMemory }))
      }
      /** 目标级持久化函数（method）：没有就不写 */
      const methods = store.methods?.[goal.id] ?? []
      if (methods.length) {
        files.set(`${path}/method.json`, jsonText({ version: 1, methods }))
      }
      /** 目标级工作流：没有登记过就不写 */
      const goalWorkflows = store.workflows?.byGoal?.[goal.id] ?? []
      if (goalWorkflows.length) {
        files.set(`${path}/workflow.json`, jsonText({ version: 1, workflows: goalWorkflows }))
      }
      /** 有效阅读：这个目标没有记录就不写 */
      const goalReading = store.reading?.byGoal?.[goal.id]
      if (goalReading && (goalReading.sessions.length || Object.keys(goalReading.days).length)) {
        files.set(`${path}/reading.json`, jsonText(goalReading))
      }
      /** 随笔与提交记录：一条都没有就不写 */
      const goalEssays = store.essays?.[goal.id] ?? []
      const goalCommits = store.essayCommits?.[goal.id] ?? []
      if (goalEssays.length || goalCommits.length) {
        files.set(`${path}/essay.json`, jsonText({ version: 2, essays: goalEssays, commits: goalCommits }))
      }
      /** 结构图：一个节点都没铺过时不写文件。画布删空但墓碑还在的照写——
       *  否则重启之后被删的卡会跟着实体集体复活。 */
      const structure = store.structure?.[goal.id]
      if (structure && (structure.nodes.length || structure.hidden?.length)) {
        files.set(`${path}/structure.json`, jsonText(structure))
      }
    }

    /**
     * 临时变量（Agent 的大块中间数据）仍是**一个节点一个文件**：
     * 它不是节点内容，是随时可丢的草稿，塞进节点文件只会让每次保存都重写一大坨无关数据。
     */
    const tmp = tmpText(store.tmp?.[node.id])
    if (tmp) files.set(`${path}/tmp.json`, tmp)

    yield
  }

  // 兜底未匹配到节点的试卷（写入根级 exams/{id}.json）
  const placedExamIds = new Set<string>()
  for (const node of store.nodes) {
    for (const exam of examsOf.get(node.id) ?? []) placedExamIds.add(exam.id)
  }
  for (const exam of store.exams) {
    if (!placedExamIds.has(exam.id)) files.set(`exams/${exam.id}.json`, jsonText(exam))
  }

  // 整张换上去：这一轮没走到的节点（删掉的、读不出来的）自然就从缓存里消失了
  nodeFileCache = nextCache
  return files
}

/** 同步摊平：一次跑完，中途不让出主线程 */
export function buildDocs(store: LearnStore): Map<string, string> {
  const steps = buildDocsSteps(store)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

/** 一次摊平里，两片之间最多连着跑多久 */
const SLICE_BUDGET_MS = 6

/** 节点很少时，分片本身比工作更贵，直接走同步路径避免一次无意义的让出。 */
const SMALL_STORE_MAX_NODES = 3

/**
 * 分片摊平：每片最多连着跑 `budgetMs` 毫秒，片间 `await yieldToMain()`。
 *
 * 为什么还要它：合并成单文件后，**一个节点的序列化体积变大了**（正文也在里面），
 * 整份摊平更容易一次性占住主线程，所以分片比旧版更有必要。
 */
export async function buildDocsChunked(store: LearnStore, budgetMs = SLICE_BUDGET_MS): Promise<Map<string, string>> {
  if (store.nodes.length <= SMALL_STORE_MAX_NODES) return buildDocs(store)

  const steps = buildDocsSteps(store)
  let sliceStart = performance.now()
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
    if (performance.now() - sliceStart >= budgetMs) {
      await yieldToMain()
      sliceStart = performance.now()
    }
  }
}

/**
 * 某个节点在数据根下的相对路径；节点不在任何目标里时返回 null。
 *
 * **合并之后所有内容都指向同一个文件**（正文 / 大纲 / 笔记 / 试卷 / 超级文档都在里面），
 * 所以 `target` 只用来做一次存在性判断（要指的那份笔记还在不在），不再影响路径。
 * 调用方（资源管理器里打开、chip 反查）因此都会落到这个 `.node.json` 上——
 * 这是合并落点的直接代价，可读性由「导出 md」兜底。
 */
export function nodeDocPath(
  store: LearnStore,
  nodeId: string,
  target: { kind: DocKind | 'outline' | 'super'; note?: string; name?: string } = { kind: 'teaching' },
): string | null {
  const entry = nodeLayout(store).get(nodeId)
  if (!entry) return null
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  if (target.kind === 'note') {
    const name = target.note ?? ''
    if (!name || !node.notes.some((n) => n.name === name)) return null
  }
  return [DOCS_DIR, ...entry.dir, `${entry.base}${NODE_FILE_SUFFIX}`].join('/')
}

/** 某个节点的临时变量文件（Agent 的中间数据），与节点文件同目录 */
export function nodeTmpPath(store: LearnStore, nodeId: string): string | null {
  const entry = nodeLayout(store).get(nodeId)
  if (!entry) return null
  return [DOCS_DIR, ...entry.dir, 'tmp.json'].join('/')
}

/** 临时变量的版本号：写盘时由 tmpText 使用（保留出口给需要自己拼的地方） */
export { TMP_VERSION }

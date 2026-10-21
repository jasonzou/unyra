/** 反序列化的顶层入口：把 nodes / goals / conversations / 资源与各类账本整份归一成 LearnStore。 */

import type {
  Conversation,
  DependencyEdge,
  KnowledgeNode,
  LearningGoal,
  LearnStore,
  MethodEntry,
  MethodStore,
  WorkflowBook,
} from '../../types'
import type { Exam } from '../../exam'
import { allTabs, ensureAnchorOutlines, focusedTab, normalizeDocs, reconcileOwners, withOwners, withParked } from '../../groups'
import { tabNodeId } from '../../tabs'
import { normalizeAgentTabs } from '../../agentTabs'
import { normalizeDrafts } from '../../drafts'
import { BUILTIN_WORKFLOW_IDS, normalizeWorkflowEfforts, normalizeWorkflowEntries } from '../../workflows'
import { normalizeReadingBook } from '../../reading'
import { normalizeEssayDock, normalizeEssays } from '../../essays'
import { normalizeEssayCommits } from '../../essayCommits'
import { normalizeFocus } from '../../focus'
import { normalizeSchedule } from '../../schedule'
import type { VideoResource } from '../../types'
import { normalizeMemoryStore } from '../../memory'
import { normalizeResourceList, retargetStaticRefs, type StaticResource } from '../../static'
import { normalizeTmpStore, pruneTmpToNodes } from '../../../lib/tmpStore'
import { normalizeNode } from './node'
import { normalizeConversation } from './conversation'
import { normalizeExam } from './exam'
import { normalizeDocScroll, normalizeFavorites, normalizeFavGroups, normalizeLocalFiles, normalizeTab } from './tabs'

/**
 * 把一份（可能来自磁盘、也可能来自导入文件）的数据归一成合法的学习数据；
 * 结构不合法返回 null。
 */
export function normalizeLearnStore(data: unknown): LearnStore | null {
  try {
    if (!data || typeof data !== 'object') return null
    const d = data as Partial<LearnStore>
    /*
     * 原始那一份（不经过 LearnStore 的形状）：文件区那一块要读**旧版**字段
     * （顶层的 tabs / activeTab），而它们已经不在 LearnStore 里了——从 d 上读不到。
     */
    const legacy = data as { tabs?: unknown; activeTab?: unknown; pomodoro?: unknown }
    if (!Array.isArray(d.nodes)) return null

    const parsed = d.nodes.map(normalizeNode).filter((n): n is KnowledgeNode => n !== null)

    // 同一目标内按 key 去重
    const seen = new Set<string>()
    const nodes: KnowledgeNode[] = []
    for (const n of parsed) {
      const sk = `${n.goalId}\u0001${n.key}`
      if (seen.has(sk)) continue
      seen.add(sk)
      nodes.push(n)
    }
    const ids = new Set(nodes.map((n) => n.id))

    const rawEdges: unknown[] = Array.isArray(d.edges) ? d.edges : []
    const edges: DependencyEdge[] = []
    for (const rawEdge of rawEdges) {
      if (!rawEdge || typeof rawEdge !== 'object') continue
      const r = rawEdge as Record<string, unknown>
      const from = typeof r.from === 'string' ? r.from : ''
      const to = typeof r.to === 'string' ? r.to : ''
      if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue
      edges.push({ from, to, createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now() })
    }

    const rawGoals: unknown[] = Array.isArray(d.goals) ? d.goals : []
    const goals: LearningGoal[] = []
    for (const rawGoal of rawGoals) {
      if (!rawGoal || typeof rawGoal !== 'object') continue
      const r = rawGoal as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const rootNodeId = typeof r.rootNodeId === 'string' ? r.rootNodeId : ''
      if (!id || !rootNodeId || !ids.has(rootNodeId)) continue
      goals.push({
        id,
        rootNodeId,
        question: typeof r.question === 'string' ? r.question : '',
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
        updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
      })
    }
    const goalIds = new Set(goals.map((g) => g.id))

    // 无归属的节点（旧数据）挂到第一个目标上，避免丢失
    const fallbackGoal = goals[0]?.id ?? ''
    const fixedNodes = nodes.map((n) =>
      n.goalId && goalIds.has(n.goalId) ? n : { ...n, goalId: fallbackGoal },
    )

    // 节点 → 它所属的目标，供旧数据里的 nodeId 折算成 goalId
    const goalOfNode = new Map(fixedNodes.map((n) => [n.id, n.goalId]))
    const conversations: Conversation[] = []
    const convSeen = new Set<string>()
    if (Array.isArray(d.conversations)) {
      for (const rawConv of d.conversations) {
        const conv = normalizeConversation(rawConv, goalIds, (nodeId) => goalOfNode.get(nodeId) ?? '')
        // 按会话 id 去重。曾经这里按 nodeId 去重——那会把同一个节点的多个会话
        // 只留一条，且下一次保存时把其余的真的删掉，与「一个节点可挂多个对话」
        // 的设计正好相反。
        if (!conv || convSeen.has(conv.id)) continue
        convSeen.add(conv.id)
        conversations.push(conv)
      }
    }

    const activeGoalId =
      typeof d.activeGoalId === 'string' && goalIds.has(d.activeGoalId)
        ? d.activeGoalId
        : (goals[0]?.id ?? null)
    const activeNodeId =
      typeof d.activeNodeId === 'string' && ids.has(d.activeNodeId)
        ? d.activeNodeId
        : (goals.find((g) => g.id === activeGoalId)?.rootNodeId ?? null)
    // 会话按目标归属：当前会话必须在当前目标里，否则回落到该目标最近的一个
    const activeConversationId =
      typeof d.activeConversationId === 'string' &&
      conversations.some((c) => c.id === d.activeConversationId && c.goalId === activeGoalId)
        ? d.activeConversationId
        : ([...conversations].reverse().find((c) => c.goalId === activeGoalId)?.id ?? null)

    const exams: Exam[] = []
    if (Array.isArray(d.exams)) {
      for (const raw of d.exams) {
        const e = normalizeExam(raw, ids)
        if (e) exams.push(e)
      }
    }

    // 资源清单按目标归属：目标已经没了的那些条目留不住（文件本体是另一回事）
    const resources: Record<string, StaticResource[]> = {}
    const rawResources = (d.resources && typeof d.resources === 'object' ? d.resources : {}) as Record<
      string,
      unknown
    >
    for (const [goalId, list] of Object.entries(rawResources)) {
      if (!goalIds.has(goalId)) continue
      const items = normalizeResourceList(list)
      if (items.length) resources[goalId] = items
    }

    /*
      记忆（见 learn/memory）：长期那份跨目标（来自 state.json），工作那份按目标归属——
      目标没了的记忆也没有意义（与 resources 同一条纪律）。
      老形状（上一版的 minds，目标 id → 条目）一并交下去，折成这个目标的工作记忆。
    */
    const memory = normalizeMemoryStore(
      d.memory,
      // legacyMinds 来自 parseDocs（磁盘上老形状的 mind.json）；minds 来自导入的旧备份
      (d as { legacyMinds?: unknown; minds?: unknown }).legacyMinds ??
        (d as { minds?: unknown }).minds,
      goalIds,
    )

    // 目标级持久化函数（method.*）按目标归属：目标没了的函数也没有意义
    const methods: MethodStore = {}
    const rawMethods = (d.methods && typeof d.methods === 'object' ? d.methods : {}) as Record<string, unknown>
    for (const [goalId, list] of Object.entries(rawMethods)) {
      if (!goalIds.has(goalId) || !Array.isArray(list)) continue
      const items: MethodEntry[] = []
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const m = item as Record<string, unknown>
        const name = typeof m.name === 'string' ? m.name.trim() : ''
        const code = typeof m.code === 'string' ? m.code : ''
        if (!name || !code) continue
        // 同名条目只认第一份：手改出来的重复会调用时指不清是哪一个
        if (items.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
        items.push({
          name: name.slice(0, 64),
          code,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
          updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
        })
      }
      if (items.length) methods[goalId] = items
    }

    // 工作流登记表（见 learn/workflows）：global 跟着用户走（state.json 里的那一份），
    // byGoal 只留还活着的目标——目标没了的工作流也没有意义（与 method 同一条纪律）
    const workflows: WorkflowBook = {
      global: normalizeWorkflowEntries(d.workflows?.global),
      byGoal: {},
    }
    const rawGoalWorkflows = (d.workflows?.byGoal ?? {}) as Record<string, unknown>
    for (const [goalId, list] of Object.entries(rawGoalWorkflows)) {
      if (!goalIds.has(goalId)) continue
      const items = normalizeWorkflowEntries(list)
      if (items.length) workflows.byGoal[goalId] = items
    }
    // 思考档位配置：只认「内置 ∪ 这次还活着的工作流」的键。登记删了键还留着的幽灵
    // 一律剪掉——读盘是唯一一次全量过手的机会（与上面 tmp / 阅读记录同一条纪律）
    const validWorkflowIds = new Set<string>(BUILTIN_WORKFLOW_IDS)
    for (const e of workflows.global) validWorkflowIds.add(e.id)
    for (const list of Object.values(workflows.byGoal)) for (const e of list) validWorkflowIds.add(e.id)
    workflows.efforts = normalizeWorkflowEfforts(d.workflows?.efforts, validWorkflowIds)

    const byId = new Map(fixedNodes.map((n) => [n.id, n]))
    /*
     * 文档区：新版读 docs，旧版读顶层的 tabs / activeTab（自动折成单组，见 groups 的
     * normalizeDocs）。两种数据都要认——用户升级之后第一次打开，看到的该还是那排页签。
     */
    const docAreaRaw = normalizeDocs(d.docArea, legacy, (raw) => normalizeTab(raw, byId))
    // 停靠场的键也是目标 id。旧版本只校验了形状，目标删除后留下的停靠组会在下次
    // 打开大纲时复活文档，因此读盘时先按当前目标表剪掉无主停靠组。
    const parked = Object.fromEntries(
      Object.entries(docAreaRaw.parkedTabs ?? {}).filter(([goalId]) => goalIds.has(goalId)),
    )
    const docArea0 = ensureAnchorOutlines(
      withParked(docAreaRaw, Object.keys(parked).length > 0 ? parked : undefined),
      (nodeId) => byId.get(nodeId)?.goalId ?? null,
      (goalId) => goals.find((g) => g.id === goalId)?.rootNodeId ?? null,
    )
    /*
     * 目标页签归属（见 groups/goals）：旧数据里没有这张表，现算补一份。
     *
     * 补得对不对直接决定「升级之后第一次打开会不会看到页签集体消失」——所以这一步
     * 必须在读盘时做，而不是等界面第一次过滤时才发现表是空的。判据取自节点自己的
     * goalId（页签上带着 nodeId），于是补出来的归属与用户当初的直觉一致。
     */
    const docArea: typeof docArea0 = (() => {
      const owners = reconcileOwners(docArea0.tabOwners, allTabs(docArea0), (nodeId) => byId.get(nodeId)?.goalId ?? null)
      return withOwners(docArea0, owners)
    })()
    // 「当前节点」跟着焦点格里激活的页签走：两者都是上次退出时存的，一个被手改过或者
    // 指向了已经删掉的节点时，让它们重新对齐（页签是用户看得见的那个，以它为准）
    const activeTabNode = focusedTab(docArea)
    const tabNodeId2 = activeTabNode ? tabNodeId(activeTabNode.ref) : null
    const nextActiveNodeId = tabNodeId2 && ids.has(tabNodeId2) ? tabNodeId2 : activeNodeId

    // agent 栏页签：目标没了 / 会话或子代理会话没了的当场剪掉，激活项对齐留下的页签
    let agentTabsState = normalizeAgentTabs(d.agentTabs, d.agentActiveTab, {
      goals: goalIds,
      conversations,
    })
    /*
     * 升级路径：老 state.json 里没有 agent 页签（那时还是单面板），但「上次在看哪段对话」
     * 有存——把那段会话的目标折成第一枚导师页签，重开应用对话栏不因此空白。
     */
    if (!agentTabsState.tabs.length && activeConversationId) {
      const conv = conversations.find((c) => c.id === activeConversationId)
      if (conv) {
        agentTabsState = {
          tabs: [{ kind: 'goal', goalId: conv.goalId, conversationId: conv.id }],
          active: 'ga:' + conv.goalId,
        }
      }
    }

    /** 随笔窗口的几何（认不出就是没有：下次打开按默认位置摆） */
    const essayDock = normalizeEssayDock(d.essayDock)

    const store: LearnStore = {
      version: 2,
      nodes: fixedNodes,
      edges,
      goals,
      conversations,
      exams,
      // 临时变量只保留还挂在现有节点上的那些——节点没了，它的暂存数据也没有意义
      tmp: pruneTmpToNodes(normalizeTmpStore(d.tmp), ids),
      resources,
      memory,
      methods,
      // 随笔同样是目标级的：目标没了的整本丢掉，空文本条目丢掉（见 learn/essays）
      essays: normalizeEssays(d.essays, goalIds),
      // 提交记录与随笔同一份 essay.json：目标没了的、认不出的丢掉；running 降成「未完成可重试」
      essayCommits: normalizeEssayCommits(d.essayCommits, goalIds),
      // 窗口几何只校验是不是数；夹进视口是打开那一刻的事（见 EssayDock）
      ...(essayDock ? { essayDock } : {}),
      workflows,
      /*
       * 阅读 / 打卡 / 专注：认不出的部分各自丢掉，坏数据不该拖垮整库。
       * 阅读记录还要**按节点过滤**（与上面 tmp 同一个道理）：节点被删掉之后，那些按
       * nodeId 索引的记录就成了空索引——今日阅读面板里一行 uuid、点不动的条目就是这么来的。
       * 放在这里做还能顺手清掉以前删节点时留下的旧空索引（读盘是唯一一次全量过手的机会）。
       *
       * 阅读是**按目标**的账本（见 learn/reading 的 ReadingBook）：逐本过一遍，
       * 目标已经不在的那些直接丢掉——那是它的账，目标没了账就该跟着没。
       */
      reading: normalizeReadingBook(d.reading, ids, goalIds),
      // 专注于旧版是 pomodoro：读盘时就地迁移（旧 log 的 minutes 折算成 ms，见 learn/focus）
      focus: normalizeFocus(d.focus ?? legacy.pomodoro),
      // 日程是用户级数据（见 learn/schedule）：不按目标过滤，坏条目逐条丢
      schedule: normalizeSchedule(d.schedule),
      // 视频资源（见 learn/types 的 VideoResource）：用户级、不按目标过滤，坏条目逐条丢
      ...(normalizeVideos(d.videos).length ? { videos: normalizeVideos(d.videos) } : {}),
      activeGoalId,
      activeNodeId: nextActiveNodeId,
      activeConversationId,
      docArea,
      // 暂存区按节点 id 校验：节点已经没了的那些不认（同页签的口径）
      drafts: normalizeDrafts(d.drafts, ids),
      // 读到哪儿了：只认有限的非负数，坏值丢掉（位置读错只该退回从头，不该让整份状态读不出来）
      docScroll: normalizeDocScroll(d.docScroll),
      localFiles: normalizeLocalFiles(d.localFiles),
      favGroups: normalizeFavGroups(d.favGroups),
      // 收藏夹按「东西还在不在」校验（与页签的口径一致）：节点没了、笔记改名了的收藏当场丢
      favorites: normalizeFavorites(d.favorites, byId, exams),
      agentTabs: agentTabsState.tabs,
      agentActiveTab: agentTabsState.active,
    }
    return retargetStaticRefs(store)
  } catch (err) {
    // 静默吞掉等于「启动整库读空、下一次保存把好数据覆盖掉」——收藏就是这么丢的。
    // 至少要把这一声喊出来：修数据的线索全在这一条日志里。
    console.error('[learn] 学习数据解析失败，本次启动按空库处理：', err)
    return null
  }
}

/** 解析一段 JSON 文本为学习数据（导入备份用）；结构不合法返回 null */
export function parseLearnStore(raw: string): LearnStore | null {
  try {
    return normalizeLearnStore(JSON.parse(raw))
  } catch (err) {
    // 与上面同一件事：导入备份解析失败也不该是一声不吭的 null
    console.error('[learn] 备份数据解析失败：', err)
    return null
  }
}


/**
 * 视频资源：只认「字段齐全 + id 唯一」的条目。
 * title 缺了用输入截断顶上（列表里总得有个名字）；fields 只留标量值。
 */
function normalizeVideos(raw: unknown): VideoResource[] {
  if (!Array.isArray(raw)) return []
  const out: VideoResource[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const input = typeof o.input === 'string' ? o.input.trim() : ''
    const pluginId = typeof o.pluginId === 'string' ? o.pluginId.trim() : ''
    if (!id || !input || !pluginId || seen.has(id)) continue
    seen.add(id)
    const fields: Record<string, string | number | boolean> = {}
    if (o.fields && typeof o.fields === 'object') {
      for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fields[k] = v
      }
    }
    out.push({
      id,
      pluginId,
      ...(typeof o.pluginName === 'string' && o.pluginName ? { pluginName: o.pluginName } : {}),
      input,
      ...(Object.keys(fields).length ? { fields } : {}),
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : input.slice(0, 60),
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      ...(typeof o.updatedAt === 'number' ? { updatedAt: o.updatedAt } : {}),
    })
  }
  return out
}

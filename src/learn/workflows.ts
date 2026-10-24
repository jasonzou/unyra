import { REASONING_EFFORTS, type ReasoningEffort } from '../ai/types'
import { promptModuleByKey, type PromptModule } from './ai/promptModules'
import type { LearnStore, WorkflowEntry, WorkflowEffortSetting } from './types'

export type { WorkflowEffortSetting }

/**
 * 工作流：**不由某条用户消息直接驱动**的任务模板（开讲、回忆、出卷、超级实验室……）。
 *
 * 与 method（learn/methods）是两类东西：method 存的是**可执行代码**，由沙箱当场执行；
 * 工作流存的是**指令文本**——它被触发时才以一条 user 消息整段进入上下文（隐藏消息、
 * 界面上是一条分界条），**绝不进系统提示词**。这样两件事同时成立：
 * - 系统提示词保持只与目标相关（前缀缓存稳定，见 buildTeacherSystem 的说明）；
 * - 每个工作流的指令可以长、可以随时改，代价只落在触发的那一轮。
 *
 * 三级分级：**内置**（随应用提供，指令在本文件里）/ **全局**（跨目标、跟着用户走，
 * 存在 state.json）/ **目标级**（只当前目标可用，存在目标目录的 workflow.json）。
 * 同名同级的登记即覆盖——那是「更新一个工作流」，与 method 同一条规矩。
 */

/** 名字的上限：够写「课前摸底开讲」，防手滑把整段指令粘进名字 */
export const WORKFLOW_NAME_MAX = 64
/** 单条指令的上限：与 method 的函数体同量级（触发时它整段进上下文，不能再大） */
export const WORKFLOW_TEXT_MAX = 60_000

export type WorkflowTier = 'builtin' | 'global' | 'goal'

/**
 * 一条工作流在列表里露出的完整面目。内置条目比登记条目多三样：
 * 触发前的宿主准备（prep）、指令里的占位符清单（params）、能否从列表直接跑（runnable）。
 */
export interface WorkflowRow extends WorkflowEntry {
  tier: WorkflowTier
  /**
   * 触发前的宿主准备，两种：
   * - 'ask'：响一声铃。问询类工作流的第一步是一张压在输入框上方的表单，
   *   用户盯着文档时听不见——这一声让它被看见。
   * - 'show'：也响铃。交付物在对话里（如「伪编译」），用户此刻正盯着自己点的地方
   *   （代码块上的转圈，随后亮起来的「运行」按钮），响一声就够，别的不做。
   *
   * 两档现在**行为相同**（都是响铃）——分开只是标注这条工作流的交互形态：
   * 会弹表单等用户动作（ask）还是只把东西摆出来（show）。原来的另一种做法
   * （'ask' 额外把对话栏切到主位）随 api.ui.switchMain 一起撤了：主栏归用户自己管。
   */
  prep?: 'ask' | 'show'
  /** instruction 里的 {{占位符}} 清单：触发方必须把这些参数补齐 */
  params?: string[]
  /**
   * 触发时随指令注入的**内置提示词模块**（learn/ai/promptModules；只有内置条目用——
   * 登记的走 WorkflowEntry.prompt）。规程类知识（如超级文档规范）按模块 key 注入，
   * 同一上下文只注一次；之后再次触发只发 instruction。
   */
  promptModule?: string
  /** 能不能从工作流列表直接跑：出卷/阅卷要专用入口（选类型等级 / 先交卷），列表里不给他们按钮 */
  runnable: boolean
  /**
   * 思考档位的三态设置（见 WorkflowEffortSetting）。这是**用户的配置**，不是推荐值——
   * 列表合成时从 store.workflows.efforts 按 id 挂上（见 listWorkflowRows）；
   * 内置的推荐档在 BUILTIN_DEFS.effort，用户没配时经 resolveWorkflowEffort 的 'default' 兜住。
   */
  effort?: WorkflowEffortSetting
}

/* ---------- 内置工作流的指令 ---------- */

/**
 * 「开讲」：空节点的内容填充（画布上空文档卡点「生成」、或新建节点后的自动开讲）。
 *
 * **指令只写「做什么」与参数**（函数调用）：完整流程（列前置、检索、摸底、写法、
 * 记账）在「教学文档生成」提示词模块里（assistant 声明一次，随本工作流注入、
 * 同上下文不重复——提示词与指令的分工见 personaMessage 与 promptModuleMessage 的说明）。
 * 指令里不再重复步骤，只给这轮特有的参数与边界。
 */
const TEACH_NODE_INSTRUCTION = [
  '本轮任务是**填充一个空节点**：节点实体与标题已由系统就位（来自用户的大纲目标项或选中的词条），它就是**当前节点**——const n = await api.node() 取到它，教学文档用 n.write 写进它自身。',
  '先 api.graph.list() 看清节点与目标的现状（回执的 current 就是当前节点），再照「教学文档生成」那份声明的流程执行：列前置知识 → api.ask 摸底 → 按盲点写文档 → 记学习状态 → 收尾打开文档。',
  '本轮边界（硬性）：这是一次内容生成，不是建树——graph.create / graph.createTree 都不要调（哪怕指令附带了大纲目标项的定位：**那条目标项的实体就是当前节点**，把正文写进来就完成了落地）；也不要给当前节点拆下一层大纲（n.outline() 不要调），那会在画布上多出一排空节点——要拆层，用户会另点「生成大纲」。',
  '若随本指令附带了【本轮参数】等上下文（如这份文档落地哪条大纲目标项），以它为准。',
].join('\n')

/**
 * 「学习大纲」：新目标的**第一轮**——先判断这次是「长期学习」还是「一次性任务」，
 * 再决定要不要一棵知识树。
 *
 * 为什么要有这条分叉：用户新建目标不总是为了系统学一门课。让导师读一个代码项目、
 * 精读一篇论文、弄懂一份报错，这些事**没有长期路线**——硬造一棵大纲树，只会得到
 * 一堆永远不会被点开的空节点，还把真正的交付物（根节点文档）推到第二位。
 * 任务型因此只建根节点与根节点文档，大纲保持空白。
 *
 * 形态**不靠用户勾选**，由导师从首条消息与附件里判断；只有在「长期 / 一次性」两种信号
 * 同时成立、且两种走法交付物差别很大时才值得问一次——反复确认比偶尔走错更烦人，
 * 而且走错也容易补救（任务型随时能补大纲，学习型多出来的空节点用户自己能删）。
 *
 * 学习型的交付物仍是大纲页（路线住在大纲文件里，教学文档只写总述）。
 */
const GOAL_OUTLINE_INSTRUCTION = [
  '这是用户刚新建的目标。用户的原话与参考资料在会话首条消息中，当前根节点的标题还是用户原话的临时形态。',
  '若用户在首条消息或当前指令中附带了参考资料、文件、项目路径或大纲图片，必须仔细研读这些内容，优先依据它们来规划。',
  '',
  '【第零步｜先判断这是哪一类目标（最重要，别跳过）】',
  '两类目标的差别只有一条——**要不要一棵知识树**：',
  '- **学习型**：用户想系统掌握一个领域（「从零学微积分」「系统学 Rust」「备考」）。交付物是**大纲树 + 逐节点讲义**，节点由浅入深、彼此有依赖。',
  '- **任务型**：用户只想让导师陪着把**一件具体的事**做完——读一个代码项目、精读一篇论文、弄懂一份报错或文档、临时答疑。这类目标没有长期路线，硬造大纲树只会塞满用户永远不会点开的空节点；交付物是**根节点文档**，要深入时用户会自己点名某个方向，那时再建**那一个**子节点。',
  '',
  '按下面的顺序判，命中即定，**不要凭感觉**：',
  '1. **先看有没有具体制品**：一个项目目录、一篇论文、一份报错日志、一段代码、一份外部文档。有 → **任务型**（用户要的是把这份东西读懂，不是学一门课）。',
  '2. **再看有没有长期意图**：「系统学 / 掌握 / 从零学 / 学习路线 / 分阶段 / 备考 / 课程」。有 → **学习型**。',
  '3. **都没有**（例如只有一句「帮我看看这个」「我想搞懂 X」）→ 按**任务型**处理：先把这件事在一份根节点文档里讲清楚。用户真要长期学，下一句会说，到时再补大纲完全来得及。',
  '4. **只有一种情况值得问**：同一句话里同时要「长期系统地学」和「只读我给的这一份材料」，两种走法的交付物差别很大。这时才用 api.ask 问一次（题目「这次想怎么用这个目标？」，选项：A 长期学习，拆成知识树 / B 一次性任务，只读这份材料）。**除此之外不要问**——反复确认比偶尔走错更烦人，而且走错了也好补救：任务型随时能补大纲，学习型多出来的空节点用户自己能删。',
  '',
'【任务型｜只建根节点与根节点文档，绝不建大纲树】',
'1. **先把文档打开**：api.ui.point() 打开根节点文档——用户要看着它长出来，而不是盯着一个空大纲页等。',
'2. api.graph.rename：起一个准确的主题名（读项目就用项目名，读论文就用论文标题的短名）。',
'3. api.graph.update(path, { description })：100~200 字，说清这次要解决什么、材料是什么、边界在哪。',
'4. 把根节点文档写成**这次任务的交付物**（const root = await api.node(path)；root.write(内容)）：',
  '   - 读项目：先给项目定位与目录结构导读，再讲核心模块的职责与调用关系、关键数据结构、上手路径；引用**真实**文件路径与代码位置，不要泛泛而谈。',
  '   - 读论文：按「问题 → 方法 → 实验 → 结论 → 局限」精读，讲清作者为什么这么做、与已有工作差在哪；关键公式与术语要解释。',
  '   - 答疑 / 读文档：先给结论与依据，再补必要的背景。',
'   一律基于**真实读到的内容**（api.node(path).read / api.web.search / api.web.fetch），禁止凭印象编造；用到网络资料时按既有规范在末尾写「## 📚 参考资料与权威来源」，并用网页 chip 声明来源。',
'5. **不要**调用 api.graph.createTree，**不要**写根节点的大纲（api.node(path).outline() 不要调）——大纲保持空白即可（界面显示「还没有大纲」是正常状态，不是你漏做了什么）。',
  '6. 收尾用一两句话告诉用户「读了什么、从哪开始看、接下来可以让我深入哪一块」。之后用户点名要深入某个模块或某一节时，再按需建**那一个**子节点，不要提前铺开。',
  '',
  '【学习型｜按创建模式执行（强制先 api.ask 确认模式）】',
  '在动笔生成大纲与文档前，**必须首先调用 api.ask 询问创建模式**：',
  '表单题目：选择目标创建模式（单选）',
  '- 选项 A: 探索式（默认模式：生成根节点文档和初步大纲，后续节点由用户逐步确认生成。边探索边构建）',
  '- 选项 B: 规划式（先规划，再执行：生成根节点文档，并通过多源深度网络调研生成完整大纲树）',
  '- 选项 C: 完整式（一次性全套交付：生成完整大纲树，并一次性生成所有节点的完整教学文档）',
  '',
  '【学习型的多轮确认纪律（规划式二次确认，完整式三次确认）】',
  '规划式和完整式由于生成时间较长，因此必须通过 api.ask 进行多轮确认：',
  '1. 探索式：用户选择探索式后，无需额外确认，立即开始执行。',
  '2. 规划式（必须二次确认）：',
  '   - 第二次确认：调用 api.ask 表单（标题「确认规划完整大纲树」，说明规划式将通过网络搜索深入调研行业规范与课程大纲，耗时稍长），选项提供「确认开始规划完整大纲树」与「返回修改为探索式」。用户确认后方可执行。',
  '3. 完整式（必须三次确认）：',
  '   - 第二次确认：调用 api.ask 表单（标题「耗时与生成规模评估」，说明完整式将一次性规划完整大纲树并生成所有节点的完整详尽讲义，消耗较多轮次与时间），选项提供「了解耗时，继续确认」与「返回修改为探索式」。',
  '   - 第三次确认：调用 api.ask 表单（标题「最终确认启动全量生成」，提示保持网络通畅与会话连接，询问是否立即启动），选项提供「确认立即启动全量生成」与「取消并改为探索式」。三次确认完成后方可启动。',
  '',
'【学习型第二步｜目标基础命名与描述更新】',
'1. 用 api.graph.rename(path, 新标题) 给这个目标起一个准确的主题名（长成数据目录名，去掉问句成分）。',
'2. 用 api.graph.update(path, { description }) 写一段 150~300 字的目标描述，阐明目标边界、核心技能与学习要求。',
'3. const root = await api.node(path)；root.write(总述) 编写根节点的教学文档：概述知识体系与起步建议。若参考了网络资料，**末尾必须包含「## 📚 参考资料与权威来源」，且必须使用网页类 chip（#[{"type":"web","url":"...","title":"..."}]）声明，严禁普通 Markdown 超链接 [文字](url)**。注意 chip 宽度有限，title 请精炼（15~25 汉字以内）。',

'【学习型第三步｜按所选模式执行大纲树与文档生成】',
'- **若为探索式**：',
  '  用 api.node(path).outline().write({ intro, children }) 写根节点大纲：intro 一两段说明阶段划分，children 列出直接子层级（只写直接子层级一层），每项 { title, summary }。后续节点由用户在界面中逐步确认生成。',
  '- **若为规划式**：',
  '  必须积极调用 api.web.search 检索行业规范与权威学术大纲，**调用 api.graph.createTree({ parent: rootId, tree: [...] }) 生成完整大纲树**（包含各层级分支与子节点，填充 title、description 与 outline），先规划完整棵知识树。',
  '- **若为完整式**：',
  '  必须积极调用 api.web.search 检索技术细节与实战范式，**调用 api.graph.createTree({ parent: rootId, tree: [...] }) 一次性生成完整大纲树，并为所有节点在 content 字段中填入详尽、高质量的教学讲义（每篇讲义末尾以网页类 chip 声明权威来源）**，一次性交付全套体系。',
  '',
  '学习型全部完成后调用 api.ui.point() 打开根节点教学文档并在大纲页中呈现完整学习路线；任务型按上面第 6 条收尾。',
].join('\n')

/**
 * 「生成大纲」：给任意一个节点规划或重写它这一层的大纲（手动触发——大纲页上的
 * 「请导师生成大纲」，或工作流列表）。与「学习大纲」的分工：那条只管刚新建的总目标，
 * 这一条管所有节点（阶段目标要拆下一层、或者计划变了要重排）。
 *
 * 指令只写「做什么」：写法与规矩在「大纲编写」提示词模块里（随本工作流注入、
 * 同上下文只注一次）。
 */
const OUTLINE_INSTRUCTION = [
  '本轮任务：为**当前节点**规划或重写它这一层的大纲（const o = await api.node().outline()；o.write(…) 整份覆盖）。',
  '照「大纲编写」那份声明的流程执行：先 o.read() / api.graph.read() / api.node().readRange(0, 2000) 看现状 → 多源检索权威分类目录并读原文再拆层 → 拆出直接子层级（一般 3~8 个）→ o.write 落盘 → api.ui.point 打开大纲页。',
  '本轮边界：已有下级节点的计划要与它们对齐；只写直接子层级一层为止，本轮不建节点。',
].join('\n')

/**
 * 「前置知识大纲」：文档卡右键菜单的「生成前置知识大纲」触发
 * （旧入口「画布拖一张空大纲卡接上游」已随占位卡一起退役）。
 *
 * 与「生成大纲」的分工：那条给**方向已定**的节点规划「往下怎么学」；
 * 这条给**还没拆过的文档**定「学它之前要先会什么」。写法的通用规矩在「大纲编写」
 * 提示词模块里（随本工作流注入），指令只写本轮特有的任务与边界。
 */
const PREREQ_OUTLINE_INSTRUCTION = [
  '本轮任务：为**当前节点**生成一份**前置知识大纲**——学会这个节点，先要会哪些东西。',
  '照「大纲编写」那份声明的流程执行（先看现状、多源检索读原文再拆层、const o = await api.node().outline()；o.write(…) 落盘、写完打开大纲页），差异只有两处：',
  '- 提炼的是**前置知识**而不是往后学的阶段：不会它们就学不动这个节点，一般 3~6 条；已有的下级节点不算前置——它们是往后学的。',
  '- children 每项的 summary 写清「这条前置要会到什么程度」，**够用就行**，不要展开成完整课程。',
  '本轮边界：只负责计划——节点是「生成文档」流程在目标项上做的事，本轮产出里没有新节点；写完在对话里用两三句说清定了哪几条前置、为什么。',
].join('\n')

/**
 * 「出卷」：类型与难度由 Agent 问用户，出题后直接保存试卷文件。
 *
 * 题目 JSON 契约、两阶段读写与篡改禁令都在「试卷与考试」提示词模块里（随本工作流
 * 注入、同上下文只注一次）；指令只写本轮的决策内容：考什么、问什么、怎么定时限。
 */
const EXAM_INSTRUCTION = [
  '本轮任务：为**当前知识点**出一份试卷。**类型与难度由你问用户**，不要替他决定，也不要在问之前就出题。题目 JSON 契约、api.exam.* 的用法与篡改禁令见「试卷与考试」那份声明，照它执行。',
  '第一步｜摸清可考范围：先 const n = await api.node(p.doc)；n.read() 读教学文档（可 n.readRange 分段），n.note(名字).read() 读笔记，api.graph.list() 看上级与同层节点的已有内容。**可考范围 = 这些已有内容 + 你的学科常识**——出卷只消费内容，不生产内容：补讲、写文档、调整树都是「生成文档」那条流程的事，与出卷轮无关。当前节点的文档还空着时正好两选一：把卷子出成**导学卷**（考查「要学这个主题得先懂什么、核心概念怎么理解」，题目围绕节点标题与上级文档来）；或用 api.ask 问学习者「这份文档还没生成，先出导学卷还是等文档生成后再出？」。两条路都是合理流程，唯独「先建节点补内容再出卷」不是。',
  '第二步｜问一次：用 api.ask 出一张表单，两道题——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项里写清各自的题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）。最多再加一道「有没有特别想考的章节」。**不要多问**：响铃已由系统在你这一轮开始前做好，不必再调 tiktok。',
  '第三步｜定时限：除随堂小测（不限时，minutes: 0）外，按题量与难度认真估一个 minutes（分钟）。下限是题目数 × 2——要写过程、要计算的题多留时间；宁可宽一点，也别让用户做不完。',
  '第四步｜检索查证与落卷：**积极使用网络搜索（api.web.search）**检索该知识点的权威考试真题、标准题型、规范公式与参考题解，并**用 api.web.fetch 读 1~2 份真题原文**确认题型结构与评分口径再命题，严禁单凭模型自身主观意志编造生硬题目或错误答案。然后用**一条 api.exam.create({ title, kind, level, minutes, questions })** 落卷。数学公式一律 LaTeX 写进 stem / options；需要图形的题给 image 字段（完整 SVG 源码）。',
  '出完就在对话里告诉用户试卷已生成并列出试卷名称与题量，请用户开始作答。',
].join('\n')

/**
 * 「阅卷」：交卷后自动触发，判分并写错题讲解。
 */
const GRADE_INSTRUCTION = [
  '学习者刚交卷。这是一套完整的阅卷流程，**一次 execute 里连着做完**，不要分两轮。**本轮只做阅卷这件事**：读卷、判分、写讲解、记错法——教学文档、笔记与知识树都不动（api.graph.update 只动 status 字段）：',
  '第零步｜先查再用：await api.exam.__help() 把 grade / explain 的参数查清楚，再动手。',
  '第一步｜读试卷与作答：api.exam.read() 读当前节点的试卷与历次 attempts（给了 attemptId 就读那一次）。取出最新一次作答。**注意严格边界**：用户的 answers、inputs、dwell、blurs 是真实客观作答事实，**严禁修改篡改任何字符或数据项**！',
  '第二步｜判分：对照参考答案逐题评判客观题，依据 rubric 评判填空题与简答题，然后**一条 api.exam.grade({ attemptId, passed, summary, results }) 落账**——results 是 [{ questionId, correct, score, maxScore, comment, by: "agent" }]，passed 决定节点是否标记已掌握，summary 写综合评价。不要手写 exams/*.json 文件。',
  '第三步｜写错题讲解：用 api.exam.explain({ content, attemptId }) 写详尽的步骤推导解析（Markdown），它落在同一次考试上并自动打开试卷副本。',
  '第四步｜修正掌握度：用 api.graph.update(p.path, { status: passed ? \'mastered\' : \'learning\' }) 更新掌握状态，并把高频薄弱错法用 api.state.mistake(p.path, { pattern, cause }) 记进错误记忆。',
].join('\n')

/**
 * 「超级实验室」：问清用户要什么实验/功能，然后生成一份可交互的超级文档。
 */
const SUPERLAB_INSTRUCTION = [
  '现在启动「超级实验室」：在当前节点做一份**超级文档**——可交互的实验或小工具，用户在页签里点、文档干活并显示结果。**本轮的交付物就这一份实验**：const lab = await api.node().superdoc(实验名)；lab.write(html) 写到当前节点身上；知识树、教学文档都不动——那是别的流程的职责。',
  '第一步｜问需求：用 api.ask 问用户想做什么实验 / 需要什么功能（一道简答题，给两三个贴合当前节点主题的示例选项帮他起意）。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。',
  '第二步｜先想后写：确定这个实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。',
  '第三步｜落盘 HTML：写入一份完整可运行的自包含 HTML（样式变量使用 var(--color-*)，说明装进 <moji-markdown>；名字不含 .html 后缀）。若包含复杂的计算函数，可通过 api.method.create 保存并通过 window.api.method.call 调用。',
  "第四步｜用 api.ui.superdoc(p.path, '实验名') 打开该超级文档页签，再用一两句话告诉用户这个实验能玩什么。",
].join('\n')

/**
 * 「压缩上下文」：把这段对话折成一份交接摘要（见 learn/compact）。
 *
 * 关键差别：**摘要由你（导师）自己写**，不是宿主另起一次「把历史重发一遍再总结」的请求——
 * 你本来就看得到整段上下文，直接写就行。写完调 api.compact 落进会话；
 * **本轮结束后**它才生效：那之前的消息全部失活，只剩这份摘要 + 之后的新消息进上下文。
 *
 * 因此这份指令的重点全在两件事上：**未做完的事要高保真**，以及**别做别的**。
 */
const COMPACT_INSTRUCTION = [
  '把这段对话压缩成一份**交接摘要**：本轮结束后，这之前的消息全部失活，此后只有你写的这份摘要（以及之后的新消息）继续进上下文。原始消息不会再发给你，所以摘要里没写的东西就是真的没了。按顺序做：',
  '第一步｜先列「还没做完的事」（tasks，**这是最容易丢、也最要命的部分**）：这几轮里用户要的但还没交付的、正做到一半的、你答应过还没做的，逐条写清楚——涉及哪个节点、哪一份文档、哪个文件名、卡在哪一步、下一步该做什么。要写得能让「换一个人接手」照着继续干，不要写「继续完善文档」这种空话。做完了的事不要列进来。',
  '第二步｜再写正文摘要（summary，Markdown）：## 学习目标与背景 / ## 已经讲清的内容（结论、定义、例子）/ ## 学习者的状态（自评、错在哪、还卡在哪）/ ## 约定与术语（符号写法、文件名、命名口径）。用户说过的话里凡是表达「我想要什么」的，保留原意——那是这个目标的方向。',
  '第三步｜api.compact({ summary, tasks }) 提交。**只调这一次**：不要顺手改文档、不要建节点、不要出题，也不要重复调用。',
  '第四步｜回一句话告诉用户已经压好了（比如「前面的对话已折成摘要，未完成的事我都记着」），**不要复述摘要内容**。',
  '硬性要求：只写这段对话里真实出现过的东西——不要推测、不要补常识、不要编造；概念名、公式、文件名要写全；summary 控制在 1200 字以内。',
].join('\n')

/**
 * 「了解」：用户在正文里划了一个词、点了「了解」。
 */
const EXPLAIN_INSTRUCTION = [
  '用户在文档里选中了「{{term}}」，点了「了解」——他想要一句能挂在这段文字旁边的解释。严格按顺序做：',
  "第一步｜先看它在讲什么：先调用 api.graph.paths() 得到当前教学文档路径，用 api.node(docPath).readRange(0, 2000) 读**这一段所在的上下文**。解释要贴着这篇文档讲——它在这里是什么意思、为什么这么说，而不是给一段百科式的通解。",
  "第二步｜写注解：调用 api.graph.annotate({ term: '{{term}}', occurrence: {{occurrence}}, body: '注解内容' }) 将注解标在正文对应位置；同时可用 api.node(节点路径).note('词条解释').write(词条解释) 把解释记录进笔记。",
  '第三步｜回话：一句话就够（例如「已把 {{term}} 的注解标在正文上」）。不要把那段解释再在对话中抄一遍。',
  '',
  '词条：{{term}}',
  '出现次数（从 0 起）：{{occurrence}}',
  '用户选中的原文：',
  '{{snippet}}',
].join('\n')

const CODE_COMPILE_INSTRUCTION = [
  '用户点了文档里那段代码块上的「编译」。请把这段代码**伪编译**成一段能在本应用里直接跑起来的 JavaScript。严格按顺序做：',
  '第零步｜先判它有没有输出（**这一步不通过就直接结束，不要往下做**）：扫一眼这段代码——如果它从头到尾只有定义（类型、接口、函数、类、常量），没有任何会被执行的语句、也不会打印任何东西，那它转译出来照样什么都不产出。这时**立刻停止编译**：调 api.code.silent({ key, reason })（reason 一句话说清为什么，如「只有类型与函数定义，没有被调用的语句」），然后在对话里用一句话告诉用户，**不要再写 js、也不要再调 code.save**。注意分寸：只要有哪怕一句会被执行的语句（一次调用、一个 print、一段循环、一次赋值后使用），就往下走，别把能跑的代码判成无输出。',
  '第一步｜看代码与它的上下文：下面那段代码很可能是个**残缺片段**（上面少一个函数定义、少两个变量、少一行 import）。用 api.node(docPath).read() 读**这篇文档**，从上下文里把缺的东西补齐——这段代码就是从这篇文档里摘出来的。',
  '第二步｜能补就补，补不上就假设：文档里也找不到的，按代码里的用法**模拟一份合理的假上下文**（假数据、假函数都行），让整段代码能跑出可见结果。**绝不要**因为片段不完整就回一句「无法编译」。',
  '第三步｜写 JavaScript。运行环境必须按这个来：一个 Web Worker——没有 window / document / DOM，没有 require / import / export，装不了 npm 包；可以用 console.log、await、Promise、setTimeout、Math / JSON / Date / 正则、TextEncoder / TextDecoder、crypto、URL；顶层可以直接写 await（宿主会把整段代码包在 async 函数里执行）；fetch 能用，但每次运行都要用户点一次同意。要让用户看见结果就必须 console.log（对象会被结构化显示）。',
  '第四步｜交货：调 **api.code.save({ key, js, note })**：',
  '　- key：用下面给的那串，**原样抄**，别改也别自己编（宿主靠它认领是哪一块代码）；',
  '　- js：转译好的**完整、自包含**的那段代码（不要写成函数包一层，直接就是可执行的语句；需要 return 就 return）；',
  '　- note：一两句中文说明——你补了哪些假设、做了什么改动。用户会看到它。',
  '　- **这一次必须调**：不调的话，那个代码块上的「运行」永远不会亮起来。代码原文不用你回抄，宿主按 key 自己认得是哪一段。',
  '第五步｜回话：在对话里用两三句说清「改了什么、假设了什么」。不要整段复述代码（产物已经在上面那次调用里交给宿主了），也不要重复贴围栏——用户正盯着他点的那块代码，回执就画在那儿（转圈 → 「运行」亮起），你这段话他自己会来看。',
  '',
  '语言标记：{{language}}',
  'key：{{key}}',
  '代码：',
  '```',
  '{{code}}',
  '```',
].join('\n')

/**
 * 「浏览器操作」：替用户驱动内置浏览器完成任务。之所以特化成工作流：网页是
 * **看图干活**的场景，普通对话里模型容易去猜页面内容、或想找条「读文字」的近路——
 * 这里把「看 = 截图、动手 = 模拟鼠标键盘」钉成唯一的路子，并把连招塞进同一次
 * execute（连招才是浏览效率的主要来源），推理档位给 low（识别与决策都轻）。
 */
const BROWSER_USE_INSTRUCTION = [
  '你要替用户操作**内置浏览器**（文档区那种地球图标页签）完成任务。这一轮只用 api.browser.* 与 api.wait：',
  '**看 = snapshot（元素清单）/ read（整页 markdown）/ capture（截图，最后手段），',
  '动手 = browser.dom（对 ref 做受控 DOM 操作）**——没有执行任意页面 JS 的通道，',
  '也不要用 api.fetch 外部抓取凑合（那是另一个抓取器，看不到登录态）。',
  '',
  '流程：',
  '1. **开工第一步必先 api.browser.tabs() 清点存活页签，这一步不可跳过**：目标网址已经',
  '   开着就直接 api.browser.activate 到它，绝不重复 api.browser.open 同一个网址——',
  '   页签越开越多，后面收拾它们全是额外动作。没有合适的才 open（纯关键词会当搜索词）。',
  '   后续操作按 tabId 指名；省略 tabId 指焦点格正看着的那个。',
  '2. **看**：先 api.browser.snapshot(tabId?) 拿「带 ref 的可交互元素清单」，认结构、找要点的元素全靠它；',
  '   要整页文字就 api.browser.read(tabId?)（转 markdown：短的回全文、长的落盘回大纲，登录态页面也能读）。**截图（capture）是最后手段**，',
  '   只有布局与视觉必须亲眼看时才用；页面还在加载时先 api.wait(800)。',
  '3. **动手**：api.browser.dom(tabId?, ref, op, arg?)——对 snapshot 清单里的 ref 做受控操作：',
  '   "click" 点它 / "fill" 填文字（触发 input/change，React 输入框也认）/ "focus" 聚焦 /',
  '   "submit" 提交所在表单 / "text" 取元素文字 / "attr" 取属性（如 "href"）。',
  '   表单的连招：fill → submit；个别站点不认程序化点击时，用 point 高亮请用户手点。',
  '4. **指给用户看**：api.browser.point(tabId?, { ref } 或选择器)——页面滚到该元素并高亮一阵。',
  '',
  '编排纪律（少一轮是一轮，这是这个工作流的生命线）：',
  '- **一段 execute 写完一条完整的链**：snapshot → 按清单判断 → dom 的 fill/submit 连招 → read 收尾，',
  '  不要每个动作单独一轮。',
  '- 拿不准就用 **if/else + try/catch 把备选一次写全**：ref 过期就在 catch 里重新 snapshot 再试、',
  '  选择器失败换 { ref }、dom 点不动就 point 高亮请用户手点——失败被接住继续走，程序不中断，',
  '  也省掉「试一次、看报错、再试」的额外轮次。',
  '- **capture 只用在 snapshot/read 拿不到信息的时候**（看布局、验证视觉结果）。',
  '',
  '卡住了就问，别内耗：',
  '- 某一步你无法独立完成（验证码、登录、系统权限弹窗、页面就是不给面子）——**api.ask 把情况',
  '  说清楚，等用户来操作**；表单回来后接着干。',
  '- 表单一分钟没人理会会自动超时收回（回执里 timedOut: true）：那时你自行判断——换个路子继续，',
  '  或把手头的成果交付掉、说清卡在哪，等用户回来看。',
  '- **不会就是不会，绝不内耗**：同一个目标连续两次尝试失败，或你判断这条路走不通，就停下交付——',
  '  把已完成的、卡在哪、需要用户做什么说清楚。反复重试耗的是用户的 token。',
  '- 临近交付：这一轮开了很多页签的话，用 api.browser.close 把中间搜索页、试错页签挑没用的关掉，',
  '  留下用户可能还要看的；用户自己开的页签别动。',
  '',
  '安全纪律：这是用户的**真实登录会话**。提交订单、支付、删除、发送消息这类不可逆动作，',
  '必须先用 api.ask 跟用户确认再动手；用户没让关的页签不要 api.browser.close。',
].join('\n')

/**
 * 内置条目的定义形：没有时间戳（它们不是「登记」出来的），runnable 可以不给（默认能跑）。
 * effort 是**推荐档**——交付物型的厚（教学文档、出卷）、对话型的薄（了解、压缩），
 * 逐条写在定义里；这是产品对「这项功能的底线质量」的表态，用户随时可以覆盖。
 */
type BuiltinDef = Omit<WorkflowRow, 'tier' | 'runnable' | 'createdAt' | 'updatedAt' | 'effort'> & {
  runnable?: boolean
  effort?: ReasoningEffort
}

/** 内置工作流的定义：id 稳定（触发与校验都靠它），名字就是对话里的分界条文案。 */
/**
 * 「随笔整理」：一次随笔提交之后，把**全部随笔**（按与上次的差异）统一整理进知识树的笔记。
 * 提交方（EssayDock 的提交按钮）已经把「提交历史 + 全部随笔相对上次的新增 / 修改 / 删除 /
 * 未变化清单」渲染进 {{feed}}——它不面向工作流列表。
 */
const ESSAY_COMMIT_INSTRUCTION = [
  '用户提交了**当前的全部随笔**（提交说明：{{message}}）。快照是完整的，但之前的提交已经整理过其中大部分内容：这次只处理与上次相比**新增、修改、删除**的部分，别把未变化的内容重做一遍。',
  '',
  '【提交内容与历史】',
  '{{feed}}',
  '',
  '要求：',
  '1. 先看知识树（api.graph.list 拿全部节点与层级），并读一读【已有整理记录】里提到的那几份笔记，弄清上次整理到哪儿了、内容是什么。',
  '2. **只处理【本次新增的随笔】【本次修改的随笔】【本次删除的随笔（只剩标题）】**；【本次未变化的随笔】只用来理解上下文，**不要再写一遍**；【已有整理记录】里的内容已经进过笔记。',
  '3. 修改类随笔只给出了改动处（>>> 新增 / 改动 <<< 之间）：把这段改动**合并进上次对应的笔记**，保留其余段落；确实需要整篇写回时，先 api.node(路径).note(名字).read() 读全文，再在原文基础上改，不要整篇重写。',
  '4. 新增内容若与某份已有笔记主题相同，合并进那份笔记的相应位置；该节点还没有合适笔记时才新建「随笔整理」：api.node(节点路径).note("随笔整理").write(内容)。节点路径要写全（例如 api.node("微积分/极限")），只写「笔记/…」会落到目标根节点上。',
  '5. 归不进任何已有节点的：并进最合适上级节点的「随笔整理」笔记；只有内容足够独立、值得单独成节时才 api.graph.create({ title, parent: "父节点路径" }) 建子节点，再给它写笔记。',
  '6. 删除类随笔：只在对应笔记里**清理只来自它的段落**，或把它改写进更合适的位置；不要因为一条随笔被删就删掉整份笔记。',
  '7. 只保留有长期价值的知识、结论、疑问与例子；合并重复内容，不要逐句照抄，不要编造材料里没有的东西。整理后的笔记要能独立读懂。',
  '8. 每改完一处，在回复里用一行列出「节点路径 → 笔记名（新建/更新）」。',
  '9. 最后，为这次提交写一条**提交评论**，放在下面这对标记之间（两行标记必须原样保留，一个字都不能改；标记之间是 Markdown，**第一行是标题**——一句话概括这次整理，之后用两三句正文说明把哪些内容归到了哪些节点、留下了什么疑问）。',
  '<!-- essay-commit-comment',
  '## （标题）',
  '（正文）',
  '-->',
].join('\n')

/**
 * 「修复函数图像」：文档里一个 ```plot 渲染失败，点错误卡片上的扳手触发。
 *
 * 报错原因、字符区间与围栏原文都由触发方（LearnWorkspace 的 plotFixHandler）算好带来：
 * 区间与 doc.replace 的参数同语义，agent 一次替换就改完——**不需要读文档**，
 * 也不存在「渲染验证」这件事（它没有渲染通道），验收标准就是下面列的几条硬要求。
 */
const PLOT_FIX_INSTRUCTION = [
  '文档「{{nodeTitle}}」里有一个函数图像渲染失败了，请直接修复并交付：**一轮完成，不要验证渲染结果**。',
  '',
  '报错原因：',
  '{{reason}}',
  '',
  '失败围栏的字符区间：{{range}}（从文档源码开头算，含首尾两行围栏标记）。',
  '失败围栏原文（原样，含首尾 ``` 标记）：',
  '```plot',
  '{{source}}',
  '```',
  '',
  '修复（一次成员调用完成）：const n = await api.node("{{path}}")；n.replace({ start: {{start}}, end: {{end}}, expected: 上面原文块的完整文本（含首尾两行 ``` 标记）, content: 修好的完整围栏 })。',
  '',
  '修好的围栏必须满足（这就是验收标准，不用也无法渲染验证）：是完整的 ```plot 围栏（含首尾两行标记）；JSON 能通过 JSON.parse；data 非空且每项有 fn；xAxis / yAxis 只能是对象（区间用 domain 写），不能写成字符串；函数变量固定用 x（参数方程用 t，极坐标用 theta）。',
  '',
  '若上面的区间是 [0, 0)（未能自动定位，文档可能刚被改过）：先用 api.node("{{path}}").find 按上面的原文找到这段围栏，换算出区间再替换。',
  'expected 校验失败说明文档已变：用 api.node("{{path}}").find 按原文重新定位，改好区间后重试一次。',
  '',
  '改完立即 api.delivery.submit 登记修复。不要读整篇文档，不要尝试渲染验证（你没有渲染通道），不要复述修复过程。',
].join('\n')

const BUILTIN_DEFS: BuiltinDef[] = [  {
    id: 'teach-node',
    name: '开讲',
    description: '摸底前置知识盲点后，生成针对性的教学文档',
    instruction: TEACH_NODE_INSTRUCTION,
    // 方法流程在「教学文档生成」模块里（assistant 声明一次，同上下文不重复）——
    // 指令只写本轮任务与参数（提示词与指令的分工，见 TEACH_NODE_INSTRUCTION 的说明）。
    // 这一次的交付物就是一份讲义：排版配方（doc-html）也必须**动笔之前**在场——
    // 靠 doc.* 写入触发只会晚一轮，第一份文档就永远是纯 HTML 草稿（v0.5.8 踩过）。
    // 纯 Markdown 策略下这些会被格式过滤拦掉（见 runTurnUnchecked 的 effectiveModules）
    promptModule: 'teach-method doc-html',
    prep: 'ask',
    // 核心交付物是教学文档：要深，但 max 的等待不值
    effort: 'high',
  },
  {
    id: 'goal-outline',
    name: '学习大纲',
    description: '先分清长期学习还是一次性任务：学习型规划大纲树与讲义，任务型只写根节点导读文档',
    instruction: GOAL_OUTLINE_INSTRUCTION,
    // 同「开讲」：总述也是讲义，排版配方要先于动笔在场
    promptModule: 'doc-html',
    // 标题 / 描述 / 大纲决定后续学习路径，值得想透
    effort: 'high',
  },
  {
    id: 'outline',
    name: '生成大纲',
    description: '为当前知识点规划或重写大纲（只列直接子层级一层）',
    instruction: OUTLINE_INSTRUCTION,
    // 写法与规矩在「大纲编写」模块里（assistant 声明一次，同上下文不重复）
    promptModule: 'outline-method',
    // 交付物长在大纲页里（用户多半正盯着它）：只响一声铃、不抢主位
    prep: 'show',
    // 大纲规划要全局权衡层级
    effort: 'high',
  },
  {
    id: 'prereq-outline',
    name: '前置知识大纲',
    description: '读当前节点的文档，把「先要学会什么」提炼成大纲目标项（文档卡右键菜单触发）',
    instruction: PREREQ_OUTLINE_INSTRUCTION,
    // 与「生成大纲」共用同一份大纲写法声明
    promptModule: 'outline-method',
    // 交付物同在大纲页里：只响一声铃、不抢主位
    prep: 'show',
    // 前置的取舍与顺序同样要全局权衡，与「生成大纲」同档
    effort: 'high',
  },
  {
    id: 'exam',
    name: '出卷',
    description: '先问清类型与难度，再出一份带时限的试卷',
    instruction: EXAM_INSTRUCTION,
    promptModule: 'exam',
    // 它自己会先 ask 一次（类型 / 难度），所以没有占位符、也从列表里可跑
    prep: 'ask',
    // 题干与干扰项质量直接影响学习；卷子的章法主要靠指令模板，high 是质量与等待的平衡点
    effort: 'high',
  },
  {
    id: 'exam-grade',
    name: '阅卷',
    description: '判分 + 看历史错题写讲解、记错法、修正掌握度（交卷后自动跑）',
    instruction: GRADE_INSTRUCTION,
    promptModule: 'exam',
    // 必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    runnable: false,
    // 判分记错账会污染掌握度，讲解要质量；判分对照本身偏机械，max 的边际收益不值多等的
    effort: 'high',
  },
  {
    id: 'explain',
    name: '了解',
    description: '就正文里选中的那段文字写一条两三句的注解，划在正文上（选中文字 →「了解」触发）',
    instruction: EXPLAIN_INSTRUCTION,
    // 词条、序号与选段都由触发方补齐；从工作流列表里空跑没有词条可讲
    params: ['term', 'occurrence', 'snippet'],
    runnable: false,
    // 只响一声铃、不切主位：交付物就画在用户盯着的那段文字旁边（同「伪编译」）
    prep: 'show',
    // 选中即出的两三句注解，等待感最明显
    effort: 'low',
  },
  {
    id: 'superlab',
    name: '超级实验室',
    description: '问清想做什么实验，生成一份可交互的超级文档',
    instruction: SUPERLAB_INSTRUCTION,
    promptModule: 'sdoc',
    prep: 'ask',
    // 生成可交互 HTML/JS：复杂代码合成是 max 收益最大的场景，失败代价最高、也等得起
    effort: 'max',
  },
  {
    id: 'code-compile',
    name: '伪编译',
    description: '把文档里这段代码转译成可运行的 JS，产物交给它运行',
    instruction: CODE_COMPILE_INSTRUCTION,
    // 产物交付的 api 口径（save / silent）随这条工作流注入一次
    promptModule: 'code',
    // 代码、语言与 key 由代码块菜单补齐；从工作流列表里空跑没有意义
    params: ['language', 'key', 'code'],
    runnable: false,
    // 响一声铃就够：用户点的是代码块，回执也在那儿（转圈 → 运行亮起），见 WorkflowRow.prep
    prep: 'show',
    // 转译规则明确、代码块通常短
    effort: 'medium',
  },
  {
    id: 'plot-fix',
    name: '修复函数图像',
    description: '文档里一个函数图像渲染失败时，按报错与区间一次改完（点错误卡片触发）',
    instruction: PLOT_FIX_INSTRUCTION,
    // 报错、区间与原文都由触发方算好带来；从列表里空跑没有可修的图
    params: ['nodeTitle', 'reason', 'path', 'range', 'start', 'end', 'source'],
    runnable: false,
    // 响一声铃就够：用户点的是错误卡片，修复结果直接落在文档里
    prep: 'show',
    // 区间与原文都已给全，照着替换即可；JSON 合法性靠验收清单而不是思考深度
    effort: 'medium',
  },
  {
    id: 'compact',
    name: '压缩上下文',
    description: '把前面的对话折成一份交接摘要（旧消息随即失活）',
    instruction: COMPACT_INSTRUCTION,
    // api.compact 的生效时机与参数口径随这条工作流注入一次
    promptModule: 'compact',
    // 压缩是摘录式改写：材料全在上下文里，不需要额外推理，None 最快也最省
    effort: 'none',
  },
  {
    id: 'browser-use',
    name: '浏览器操作',
    description: '替用户操作内置浏览器：截图看页面、模拟鼠标键盘完成任务',
    instruction: BROWSER_USE_INSTRUCTION,
    // 全程看图干活：识别与决策都轻，low 足够——快才是浏览效率
    effort: 'low',
  },
  {
    id: 'essay-commit',
    name: '随笔整理',
    description: '每次带上全部随笔，按与上次的差异（新增 / 修改 / 删除）统一整理进知识树对应节点的笔记',
    instruction: ESSAY_COMMIT_INSTRUCTION,
    // 历史与本次材料由「随笔」窗口的提交按钮补齐；从工作流列表空跑没有意义
    params: ['message', 'feed'],
    runnable: false,
    // 归类、合并、改写都要判断，值得多想一会儿
    effort: 'high',
  },
]

/** 内置工作流的 id 集：normalize 剪 efforts 幽灵键、UI 判「有没有推荐档」都认它 */
export const BUILTIN_WORKFLOW_IDS: ReadonlySet<string> = new Set(BUILTIN_DEFS.map((d) => d.id))

/** 内置工作流的推荐档（id → 档位）：resolveWorkflowEffort 的 'default' 落点 */
export const BUILTIN_EFFORT: Record<string, ReasoningEffort> = Object.fromEntries(
  BUILTIN_DEFS.map((d) => [d.id, d.effort ?? 'high']),
)

/* ---------- 触发前的宿主准备 ---------- */

/**
 * 一条工作流触发前，宿主该做什么。
 *
 * 规则只有一条：**带 prep 的响一声铃**（问询类的表单要用户抬眼、展示类的交付要他知道
 * 结果在对话里），没带 prep 的（了解 / 大纲 / 压缩 / 阅卷）连铃都不响——
 * 那些是用户自己点出来的，他本来就在看着。
 *
 * 这里**不再切主位**（原先是 'ask' 才切）：主栏归用户管，页签化之后「眼前看哪一边」
 * 是他自己的选择，从手里把视线抢走这件事不值得由一次工作流触发来做。
 *
 * 抽成纯函数是为了让这条规矩有个能被钉住的地方（见 tests/workflows.test.ts）：
 * 它写在 useAgent 的回调里时，只有真跑一轮才验证得了。
 */
export function workflowPrep(prep: WorkflowRow['prep']): { beep: boolean } {
  return { beep: !!prep }
}

/**
 * 一轮该用哪档思考。行上没配（用户没动过）时：内置用推荐档、登记的跟随聊天；
 * 'chat' 跟随聊天滑条；'default' 取内置推荐（登记的没有推荐，回落聊天）；
 * 其余即固定档，原样。聊天滑条只对聊天框发起的轮直接生效——工作流轮的档位
 * **独立于它**（这是有意设计：出卷要深、了解要快，一个全局滑条伺候不了所有任务）。
 * 抽成纯函数与 workflowPrep 同一条理由：配置解析要有能被钉住的地方。
 */
export function resolveWorkflowEffort(
  row: Pick<WorkflowRow, 'id' | 'tier' | 'effort'>,
  chatEffort: ReasoningEffort,
): ReasoningEffort {
  const setting = row.effort ?? (row.tier === 'builtin' ? 'default' : 'chat')
  if (setting === 'chat') return chatEffort
  if (setting === 'default') return BUILTIN_EFFORT[row.id] ?? chatEffort
  return setting
}

/**
 * 一条工作流触发时要注入哪些提示词模块（动态提示词注入，见 learn/ai/promptModules）：
 * - 内置条目的 promptModule 指到注册表里的内置模块；**空格分隔可给多个**（如开讲同时
 *   要「教学文档生成」方法与「文档排版与图表」配方——方法与配方都是声明，声明一次）；
 * - 登记条目的 prompt 是自己的规程文本，按 wf:<id> 作键动态成模块。
 * 两者都有就都注入（去重在宿主那边做：同一 key 只注一次）。都没有就是空。
 */
export function workflowModules(
  row: Pick<WorkflowRow, 'id' | 'name' | 'prompt' | 'promptModule'>,
): PromptModule[] {
  const out: PromptModule[] = []
  if (row.promptModule) {
    for (const key of row.promptModule.trim().split(/\s+/)) {
      const m = promptModuleByKey(key)
      if (m) out.push(m)
    }
  }
  if (typeof row.prompt === 'string' && row.prompt.trim()) {
    out.push({ key: 'wf:' + row.id, title: row.name, text: row.prompt })
  }
  return out
}

/** 内置工作流列表（顺序即设置里的展示顺序；时间戳为 0——它们不是登记出来的） */
export function builtinWorkflowRows(): WorkflowRow[] {
  return BUILTIN_DEFS.map((d) => ({
    ...d,
    tier: 'builtin' as const,
    runnable: d.runnable ?? true,
    createdAt: 0,
    updatedAt: 0,
    // 推荐档不冒充用户配置：row.effort 只装用户的三态设置（listWorkflowRows 再挂），
    // 推荐档经 BUILTIN_EFFORT 按 id 查——两套语义不能混在同一个字段里
    effort: undefined,
  }))
}

/* ---------- 登记表的纯逻辑 ---------- */

const globalOf = (store: LearnStore): WorkflowEntry[] => store.workflows?.global ?? []
const goalOf = (store: LearnStore, goalId: string): WorkflowEntry[] =>
  goalId ? (store.workflows?.byGoal?.[goalId] ?? []) : []

/** 三级并成一张列表：内置在前，全局次之，目标级最后（同名的不会有——登记时就按名去重） */
export function listWorkflowRows(store: LearnStore, goalId: string | null): WorkflowRow[] {
  // 用户配过的思考档位（键 = id，内置与登记通吃）挂到行上；没配的保持 undefined
  const efforts = store.workflows?.efforts ?? {}
  const rows: WorkflowRow[] = builtinWorkflowRows()
  for (const r of rows) r.effort = efforts[r.id]
  for (const e of globalOf(store)) rows.push({ ...e, tier: 'global', runnable: true, effort: efforts[e.id] })
  if (goalId) for (const e of goalOf(store, goalId)) rows.push({ ...e, tier: 'goal', runnable: true, effort: efforts[e.id] })
  return rows
}

/**
 * 按 id 或名字找一条工作流（大小写不敏感——触发方抄写时大小写会飘，与 method 同一条宽容）。
 * 三级顺序查找：内置优先，全局次之，目标级最后。
 */
export function findWorkflow(store: LearnStore, goalId: string | null, ref: string): WorkflowRow | null {
  const key = (ref ?? '').trim().toLowerCase()
  if (!key) return null
  return listWorkflowRows(store, goalId).find((r) => r.id.toLowerCase() === key || r.name.toLowerCase() === key) ?? null
}

/**
 * 新建 / 覆盖一条登记工作流（global 或 goal 级；内置的不可造也不可覆）。
 * 同名同级覆盖（那是更新）；返回新 store 与最终条目，校验不过时带原因。
 */
export function upsertWorkflow(
  store: LearnStore,
  tier: 'global' | 'goal',
  goalId: string,
  input: { name?: unknown; instruction?: unknown; description?: unknown; prompt?: unknown },
  at: number,
): { ok: true; store: LearnStore; entry: WorkflowEntry; updated: boolean } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!name) return { ok: false, error: 'wf.create 需要 name（工作流名，列表与触发都靠它指名）' }
  if (name.length > WORKFLOW_NAME_MAX) {
    return { ok: false, error: `工作流名最长 ${WORKFLOW_NAME_MAX} 字（收到 ${name.length} 字）` }
  }
  if (!instruction) {
    return { ok: false, error: 'wf.create 需要 instruction（触发时以 user 消息发出去的完整任务指令）' }
  }
  if (instruction.length > WORKFLOW_TEXT_MAX) {
    return { ok: false, error: `instruction 最长 ${WORKFLOW_TEXT_MAX} 字符（收到 ${instruction.length}），把步骤写精` }
  }
  // 规程提示词（可选）：给了就校验长度；没给就保留原有的（更新时不传 prompt ≠ 清空）
  let prompt: string | undefined
  if (typeof input.prompt === 'string' && input.prompt.trim()) {
    prompt = input.prompt.trim()
    if (prompt.length > WORKFLOW_TEXT_MAX) {
      return { ok: false, error: `prompt 最长 ${WORKFLOW_TEXT_MAX} 字符（收到 ${prompt.length}）` }
    }
  }
  const list = tier === 'global' ? globalOf(store) : goalOf(store, goalId)
  const existing = list.find((w) => w.name.toLowerCase() === name.toLowerCase())
  const entry: WorkflowEntry = existing
    ? {
        ...existing,
        instruction,
        description: description || existing.description,
        ...(prompt !== undefined ? { prompt } : {}),
        updatedAt: at,
      }
    : {
        id: 'wf_' + at.toString(36) + Math.random().toString(36).slice(2, 8),
        name,
        description,
        instruction,
        ...(prompt !== undefined ? { prompt } : {}),
        createdAt: at,
        updatedAt: at,
      }
  const nextList = existing ? list.map((w) => (w === existing ? entry : w)) : [...list, entry]
  const book = {
    global: tier === 'global' ? nextList : (store.workflows?.global ?? []),
    byGoal: tier === 'goal' ? { ...(store.workflows?.byGoal ?? {}), [goalId]: nextList } : (store.workflows?.byGoal ?? {}),
    // 档位配置按 id 记在全局表里，登记的新建 / 覆盖都原样带走
    efforts: store.workflows?.efforts,
  }
  return { ok: true, store: { ...store, workflows: book }, entry, updated: !!existing }
}

/** 按 id 删一条登记工作流（全局与各级目标里都找一遍）；没有就原样返回 store */
export function removeWorkflow(store: LearnStore, id: string): LearnStore {
  const key = (id ?? '').trim().toLowerCase()
  if (!key) return store
  const global = globalOf(store)
  const byGoal = { ...(store.workflows?.byGoal ?? {}) }
  let removedId: string | null = null
  let nextGlobal = global
  const hitGlobal = global.find((w) => w.id.toLowerCase() === key)
  if (hitGlobal) {
    removedId = hitGlobal.id
    nextGlobal = global.filter((w) => w.id.toLowerCase() !== key)
  }
  for (const [goalId, list] of Object.entries(byGoal)) {
    const hitGoal = list.find((w) => w.id.toLowerCase() === key)
    if (!hitGoal) continue
    if (!removedId) removedId = hitGoal.id
    const rest = list.filter((w) => w.id.toLowerCase() !== key)
    if (rest.length) byGoal[goalId] = rest
    else delete byGoal[goalId]
  }
  if (!removedId) return store
  // 登记删了，配过的档位也一并删：efforts 按 id 记在全局表里，留键成幽灵
  const efforts = { ...(store.workflows?.efforts ?? {}) }
  delete efforts[removedId]
  return { ...store, workflows: { global: nextGlobal, byGoal, efforts } }
}

/**
 * 给一条工作流配思考档位（三态，键 = id，内置与登记通吃；配置写在全局 efforts 表）。
 * id 不认识任何工作流（内置 ∪ 已登记）时原样返回 store——配置不能落在不存在的东西上。
 */
export function setWorkflowEffort(store: LearnStore, id: string, effort: WorkflowEffortSetting): LearnStore {
  const key = (id ?? '').trim()
  if (!key) return store
  const known =
    BUILTIN_WORKFLOW_IDS.has(key) ||
    globalOf(store).some((w) => w.id === key) ||
    Object.values(store.workflows?.byGoal ?? {}).some((list) => list.some((w) => w.id === key))
  if (!known) return store
  const efforts = { ...(store.workflows?.efforts ?? {}) }
  efforts[key] = effort
  return {
    ...store,
    workflows: {
      global: globalOf(store),
      byGoal: store.workflows?.byGoal ?? {},
      efforts,
    },
  }
}

/**
 * 把指令里的 {{占位符}} 换成实参；没给到的占位符原样留下——
 * 那是登记时写漏了参数，触发方（与用户）看得见比静默替换成空串好。
 */
export function renderWorkflowInstruction(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole))
}

/**
 * 读回时校验一段登记清单：字段形状不对的丢掉、同名的只认第一份（手改出来的重复
 * 会在列表里出现两行一样的，触发时指不清是哪一个）。
 */
export function normalizeWorkflowEntries(raw: unknown): WorkflowEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WorkflowEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const name = typeof m.name === 'string' ? m.name.trim().slice(0, WORKFLOW_NAME_MAX) : ''
    const instruction = typeof m.instruction === 'string' ? m.instruction : ''
    if (!name || !instruction) continue
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
    out.push({
      id: typeof m.id === 'string' && m.id.trim() ? m.id : 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      description: typeof m.description === 'string' ? m.description : '',
      instruction,
      // 规程提示词（动态注入用，见 workflowModules）：形状不对就不带这一块
      ...(typeof m.prompt === 'string' && m.prompt.trim() ? { prompt: m.prompt } : {}),
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    })
  }
  return out
}

/**
 * 读回 state.json 里的思考档位配置：键必须指向一条真实存在的工作流（validIds 由调用方
 * 按「内置 ∪ 当时还登记着的」算好），值必须是三态之一；其余整键丢弃——幽灵键留着，
 * 只会让读代码的人以为还有第 14 条内置工作流。
 */
export function normalizeWorkflowEfforts(
  raw: unknown,
  validIds: ReadonlySet<string>,
): Record<string, WorkflowEffortSetting> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, WorkflowEffortSetting> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validIds.has(id)) continue
    if (v === 'default' || v === 'chat' || REASONING_EFFORTS.includes(v as ReasoningEffort)) {
      out[id] = v as WorkflowEffortSetting
    }
  }
  return out
}

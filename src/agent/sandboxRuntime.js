/**
 * 沙箱的运行时代码，**纯 JavaScript**。
 *
 * 为什么单独放一个 .js：这段代码会以字符串形式被塞进 Blob 再交给 Worker，
 * 浏览器是按 JS 解析它的，任何 TypeScript 语法（类型标注、as、接口）都会让
 * Worker 一启动就抛 SyntaxError——而且报错位置指向别处，极难自查。
 * 单独成文件后，构建器会像编译其它 .js 一样检查它的语法，写错立刻发现。
 *
 * 通信：宿主 postMessage({ kind: 'run', body, timeoutMs }) 起跑；
 * Worker 需要 api 时回 { kind: 'call', id, name, args }，宿主回 { kind: 'reply', id, ok, value/message }；
 * 跑完发 { kind: 'done', ok, value/error }。
 */
const API_NAMES = __API_NAMES__
const API_HELP = __API_HELP__

/**
 * 只给编排能力：网络与定时器统统收走。
 * 与外界交互的唯一通道是 api——否则沙箱就成了绕开应用逻辑的后门。
 */
globalThis.fetch = undefined
globalThis.XMLHttpRequest = undefined
globalThis.WebSocket = undefined
globalThis.importScripts = undefined

let seq = 0
const pending = new Map()
/** 本次 run 的超时定时器；收到任何活动（回复 / 心跳）都续命（见 run 里的 armTimer） */
let runTimer = null

self.onmessage = (ev) => {
  const msg = ev.data || {}
  if (msg.kind === 'reply') {
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    armTimer()
    if (msg.ok) slot.resolve(msg.value)
    else slot.reject(new Error(msg.message))
    return
  }
  if (msg.kind === 'heartbeat') {
    // 宿主在等一个 api 调用（ask 等用户、wait 在睡）时会持续发心跳：
    // 「合法的慢」不该被自家的超时杀掉；超时只管「真的没进展」
    armTimer()
    return
  }
  if (msg.kind !== 'run') return
  run(msg.body, msg.timeoutMs)
}

function armTimer() {
  if (runTimer) clearTimeout(runTimer)
  // 只在已经在跑时续命；armTimer 被复用为「重设」而不是「新建」
  if (timerMs > 0) runTimer = setTimeout(onTimeout, timerMs)
}

let timerMs = 0

function onTimeout() {
  runTimer = null
  timerMs = 0
  self.postMessage({
    kind: 'done',
    ok: false,
    error: '沙箱超时：这段代码疑似死循环或太慢，请拆小重试',
  })
}

function call(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    self.postMessage({ kind: 'call', id, name, args })
  })
}

function groupHelp(key) {
  return API_HELP.groups[key] || '没有 api.' + key + ' 这一组。先 await api.__help() 看有哪些组。'
}

function apiHelp(full) {
  return API_HELP.apis[full] || '没有登记 api.' + full + '。先 await api.<组>.__help() 看这一组有哪些 api。'
}

function attachGroupHelp(obj, key) {
  if (obj && typeof obj.__help !== 'function') obj.__help = () => groupHelp(key)
  return obj
}

function attachApiHelp(fn, full) {
  fn.__help = () => apiHelp(full)
  return fn
}

function makeApi() {
  const api = {}
  for (const full of API_NAMES) {
    // ui.dom 走下面那条特判通道：它要传回调函数，结构化克隆带不过去
    if (full === 'ui.dom') continue
    const segs = full.split('.')
    if (segs.length === 1) {
      // 不带点的顶层 api（wait / ask / tiktok…）：直接挂在 api 上
      api[full] = attachApiHelp((...callArgs) => call(full, callArgs), full)
      continue
    }
    let cur = api
    for (let i = 0; i < segs.length - 1; i++) {
      cur = cur[segs[i]] || (cur[segs[i]] = {})
    }
    attachGroupHelp(api[segs[0]], segs[0])
    cur[segs[segs.length - 1]] = attachApiHelp((...callArgs) => call(full, callArgs), full)
  }
  // 根 help：组总览。api.<组>.__help() 与 api.<组>.<api>.__help() 都是同步返回的
  api.__help = () => API_HELP.root
  // 暴露全局 files、process 与 skill 变量，使得 await files.read(...) 与 await api.files.read(...) 均可直接调用
  if (api.files) {
    globalThis.files = api.files
  }
  if (api.process) {
    globalThis.process = api.process
  }
  if (api.skill) {
    globalThis.skill = api.skill
  }
  // 别名：api.web.fetch 指向 api.fetch
  if (api.fetch) {
    api.web = attachGroupHelp(api.web || {}, 'web')
    api.web.fetch = attachApiHelp((...callArgs) => api.fetch(...callArgs), 'web.fetch')
  }
  api.ui = attachGroupHelp(api.ui || {}, 'ui')
  /**
   * api.ui.dom(fn)：宿主先建一个「会话」，回调拿到的是一层**门面**（facade）——
   * 它的每个方法都回到宿主去操作文档区根元素。只暴露选择器级别的读写与点击，
   * 因为 DOM 节点本身同样无法穿过 Worker 边界。
   */
  api.ui.dom = attachApiHelp(async (fn) => {
    if (typeof fn !== 'function') {
      throw new Error('api.ui.dom 需要传入一个回调函数：await api.ui.dom(async (root) => { ... })')
    }
    const session = await call('ui.dom.session', [])
    const op = (name, args) => call('ui.dom.op', [session, name, args])
    const facade = {
      exists: (sel) => op('exists', [sel]),
      count: (sel) => op('count', [sel]),
      query: (sel) => op('query', [sel]),
      text: (sel, i) => op('text', [sel, i]),
      // attr 的参数序统一成 (sel, name, i?)，传给宿主前换成 domOp 的 (sel, i, name)
      attr: (sel, name, i) => op('attr', [sel, i === undefined ? 0 : i, name]),
      html: (sel, i) => op('html', [sel, i]),
      rect: (sel, i) => op('rect', [sel, i]),
      click: (sel, i) => op('click', [sel, i]),
    }
    return await fn(facade)
  }, 'ui.dom')
  api.log = (...args) => {
    const line = args
      .map((a) => {
        try {
          return typeof a === 'string' ? a : JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
    call('log', [line]).catch(() => {})
  }

  return api
}

const DEPRECATED_HINTS = {
  docs: '没有 api.docs 这一组：文档请用 api.doc.*（先 await api.doc.__help()）。',
  description: 'api.description 已退役：修改节点描述请用 await api.node.update(path, { description })。',
  review: '没有 api.review：复习计划用 api.outline.write / api.state.* 表达，不要自己找数据文件。',
  retrieval: '没有 api.retrieval：联网检索请用 api.web.search。',
  note: '没有 api.note 这一组：笔记请用 api.doc.read / api.doc.write，路径写「节点/笔记/名字」。',
  stats: 'api.stats 不存在：阅读事实用 api.reading.*，注意力用 api.attention.get。',
  memory: 'api.memory 不存在：长期事实用 api.doc.* / api.state.*，可执行逻辑用 api.method.*。',
  mind: 'api.mind 不存在：知识结构用 api.node.*，文档用 api.doc.*。',
  checkin: 'api.checkin 不存在：没有打卡数据这一组。',
  plot: 'api.plot 不存在：图像请写进教学文档（```plot 围栏），静态素材用 api.res.*。',
  methods: 'api.methods 不存在：方法调用请用 api.method.call(name, ...args)。',
}

async function run(body, timeoutMs) {
  const started = Date.now()
  timerMs = timeoutMs
  armTimer()
  const api = makeApi()
  try {
    /*
     * 编译成「async 箭头 + 立即执行」的形状：
     *
     *   ((api)=>{ ... })     → 求值得到函数 → 带着 api 调它；
     *   ((api)=>{...})()     → 自己调过了 → 得到 Promise → 直接等它。
     *
     * 外面这层 async 是关键：model 写的函数体里能不能用 await，**只由这里决定**，
     * 跟它自己写没写 async 无关。早先直接 new Function('api', 'return (' + body + ')')
     * 时，await 能不能用取决于 body 自身的形状——同一句 await 时通时不通，
     * 那种不可预测比报错更糟。现在 await 无条件可用。
     */
    const evaluated = new Function('api', 'files', 'process', 'return (' + body + ')')()
    const raw = typeof evaluated === 'function' ? await evaluated(api, api.files, api.process) : await evaluated
    timerMs = 0
    clearTimeout(runTimer)
    runTimer = null
    /*
     * 结果要能过结构化克隆。模型有时会 return 一个函数或带函数的对象，
     * 那会让 postMessage 直接抛 DataCloneError——报错信息还错位到别处，极难自查。
     * 这里先把不可克隆的部分换成一句可读的说明。
     */
    let value
    try {
      structuredClone(raw)
      value = raw
    } catch {
      value = typeof raw === 'function' ? '[函数] ' + String(raw).slice(0, 200) : String(raw)
    }
    self.postMessage({ kind: 'done', ok: true, value, ms: Date.now() - started })
  } catch (err) {
    timerMs = 0
    clearTimeout(runTimer)
    runTimer = null
    const e = err || {}
    const stack = typeof e.stack === 'string' ? String(e.stack) : ''
    const where = stack ? stack.split('\n').slice(0, 3).join(' | ') : ''
    let message = e.message ? String(e.message) : String(err)
    for (const [key, hint] of Object.entries(DEPRECATED_HINTS)) {
      const reg = new RegExp(`\\bapi\\.${key}\\b`)
      if (reg.test(body) || message.includes(`'${key}'`) || message.includes(`"${key}"`)) {
        message += `\n［提示：${hint}］`
        break
      }
    }
    self.postMessage({ kind: 'done', ok: false, error: message + (where ? '［' + where + '］' : '') })
  }
}

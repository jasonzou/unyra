/**
 * 英文字典的「专注 / 守卫」分片：专注模式、守卫 agent 页签与专注报告的文案。
 * 键 = 界面里的中文原文（与其余分片同一条规矩：同一个键的译法必须一致）。
 */
export default {
  // 专注模式 tip（FocusButton）
  '专注模式': 'Focus mode',
  '专注': 'Focus',
  '专注中': 'Focusing',
  '已暂停': 'Paused',
  '就绪': 'Ready',
  '守卫': 'Guard',
  '守卫当值': 'Guard on duty',
  '至少一路 · 每分钟巡检': 'At least one · checks every minute',
  '至少开启一路': 'Enable at least one',
  '监控屏幕': 'Watch screen',
  '监控摄像头': 'Watch camera',
  '开启一路守卫后开始。守卫每分钟看一次画面，分心会提醒，涉及隐私立即熔断。':
    'Enable at least one guard monitor to start. The guard checks the frames once a minute, warns you when you drift off task, and fuses immediately on anything private.',
  '至少开启一项守卫功能才能开始专注模式。': 'Enable at least one guard monitor to start focus mode.',
  '画面仅用于实时状态判定，不落盘；若检测到隐私内容将熔断停止。':
    'Frames are only used to judge your focus in real time and are never stored. Privacy-sensitive content triggers an immediate fuse.',
  '守卫发现你不在屏幕前，值守已暂停——回到应用随便点一下或敲个键就继续':
    'The guard noticed you are away from the screen. Monitoring is paused — click or press any key to resume.',
  '结束专注': 'End focus',
  '开始专注': 'Start focus',
  '正在开启守卫…': 'Starting the guard…',
  '专注没有时限，随时结束；结束三分钟以上的场次会生成专注报告。':
    'Focus has no time limit — end it whenever you like. Sessions of three minutes or more produce a focus report.',
  '专注模式：守卫暂停中——回到应用一交互就继续':
    'Focus mode: the guard is paused — interact with the app to resume.',
  '专注模式：守卫正在当值': 'Focus mode: the guard is on duty',
  '专注模式：开始一场有守卫盯着的学习': 'Focus mode: start a guarded study session',
  '专注模式：先开启屏幕或摄像头守卫': 'Focus mode: enable the screen or camera guard first',
  '当前的模型不支持看图——守卫模式需要能看图的模型，换一个或关闭勾选。':
    'The current model cannot see images — the guard needs a vision model. Switch models or turn the monitor off.',

  // 顶栏 Dock（docks.tsx）
  '守卫暂停中——等你回来': 'Guard paused — waiting for you',
  '守卫当值 · 已看 {0} 眼': 'Guard on duty · {0} checks',
  '查看守卫': 'Open guard',
  '屏幕': 'Screen',
  '摄像头': 'Camera',
  '等待画面…': 'Waiting for video…',

  // 页签
  '守卫 Agent': 'Guard Agent',
  '专注报告': 'Focus reports',

  // 守卫页签（GuardView）
  '守卫还没有跑过。': 'The guard has not run yet.',
  '在顶栏专注模式的 tip 里勾选「监控屏幕」或「监控摄像头」，开始专注后守卫就会在这里建起自己的上下文：每分钟看一眼画面，判断你在不在学、在不在屏幕前，涉及隐私会立即熔断。':
    'Tick "Watch screen" or "Watch camera" in the focus tip and start a session — the guard builds its context here: checking the frames every minute to tell whether you are studying, whether you are at the screen, and fusing immediately on anything private.',
  '当值中': 'On duty',
  '已暂停——等你回来': 'Paused — waiting for you',
  '已熔断': 'Fused',
  '已结束': 'Ended',
  '已看 {0} 眼': '{0} checks',
  '因隐私保护熔断：{0}': 'Fused for privacy: {0}',
  '系统提示词（按勾选的监控现算）': 'System prompt (computed from the monitors you ticked)',
  '守卫在第 {0} 秒看到的画面': 'Frame the guard saw at second {0}',
  '点开看大图（这一帧已发给模型）': 'Click to enlarge (this frame was sent to the model)',
  '判定：': 'Verdict: ',
  '（无说明）': '(no explanation)',
  '模型的思考与回复原文': 'Model reasoning and raw reply',
  '随图发送：{0}': 'Sent with the frames: {0}',
  '没看懂这一轮': 'Round not understood',
  '在学': 'On task',
  '分心警告': 'Distraction warning',
  '判离开 · 已暂停': 'Away · paused',
  '隐私熔断': 'Privacy fuse',
  '还没有看过任何一眼——等第一轮监控（开始后约半分钟）。':
    'No checks yet — waiting for the first round (about half a minute after start).',

  // 专注报告页签（FocusReportView）
  '正在打开报告…': 'Opening the report…',
  '这份报告不见了（文件被移动或删掉）。': 'This report is missing (the file was moved or deleted).',
  '共 {0} 分钟': '{0} min in total',
  '专注时长': 'Focus duration',
  '被暂停': 'Paused',
  '{0} 次 · {1} 分钟': '{0} times · {1} min',
  '没有': 'None',
  '{0} 次': '{0} times',
  '监控': 'Monitors',
  '屏幕 + 摄像头': 'Screen + camera',
  '没开': 'Off',
  '因隐私保护立即熔断：{0}': 'Fused immediately for privacy: {0}',
  '出过的事': 'What happened',
  '分心警告：{0}': 'Distraction warning: {0}',
  '守卫判离开，暂停 {0} 分钟': 'Guard judged you away, paused {0} min',
  '守卫判离开，暂停到收场': 'Guard judged you away, paused until the end',
  '守卫的判定（新 → 旧）': 'Guard verdicts (newest first)',
  '（没看懂这一轮）': '(round not understood)',
  '屏': 'S',
  '摄': 'C',
  '这一场没有守卫轮次（监控没拿到画面或开始后立即结束）。开一路守卫再开始，才会留下判定记录。':
    'This session has no guard rounds (no frames were captured, or it ended immediately). Enable a guard monitor before starting to keep verdicts.',

  // 资源管理器（sections.tsx）
  '{0}-{1} {2}:{3}': '{0}-{1} {2}:{3}',
  '{0} 开始的一场专注（{1} 分钟）': 'A focus session started at {0} ({1} min)',
  '{0} 分': '{0}m',

  // 宿主编排（LearnWorkspace）
  '守卫：{0}——值守已暂停，回到应用就继续': 'Guard: {0} — monitoring paused, come back to resume',
  '守卫：欢迎回来，值守继续': 'Guard: welcome back, monitoring resumes',
  '专注报告已生成——资源管理器的「专注报告」里看': 'Focus report generated — see "Focus reports" in the explorer',
  '专注模式没有在跑': 'Focus mode is not running',
  '专注模式已持续 {0} 分钟（守卫：{1}）': 'Focus mode has been running for {0} min (guard: {1})',
  '至少开启一项守卫功能才能开始专注模式': 'Enable at least one guard monitor to start focus mode',
  '守卫没有开起来：屏幕与摄像头都没拿到画面，专注模式未开始':
    'The guard did not start — neither screen nor camera produced frames, so focus mode did not begin',
  '专注模式没能开始，请再试一次': 'Focus mode could not start — please try again',
  '守卫提醒：屏幕上的内容与学习无关': 'Guard: the screen is not on studying',
  '{0}（误判可直接忽略，这一条也会记进专注报告。）': '{0} (If this is a false positive, just dismiss it — it is recorded in the focus report.)',
  '回到学习': 'Back to studying',
  '专注模式已熔断': 'Focus mode fused',
  '守卫在画面里看到了涉及隐私的内容（{0}），已立即停止监控并结束这次专注；看到的画面不会保存。':
    'The guard saw something private in the frames ({0}). Monitoring stopped immediately and this focus session ended; the frames are not saved.',
  '知道了': 'Got it',

  // 守卫运行时（agent/guardRuntime）
  '屏幕与摄像头都没拿到，守卫没有开起来': 'Neither screen nor camera could be captured — the guard did not start',
  '有一路监控没拿到（权限或设备占用），按拿到的继续': 'One monitor could not be captured (permission or device busy) — continuing with the other',
  '还没有收到过任何交互': 'No interaction received yet',
  '距上一次与应用交互 {0} 秒': '{0} s since the last interaction with the app',
  '回复不是约定的 JSON，这一轮没有动作': 'The reply was not the agreed JSON — no action this round',
  '（模型没给说明）': '(the model gave no explanation)',
  '（附屏幕截图与摄像头画面）': ' (a screen capture and a camera frame are attached)',
  '（附屏幕截图）': ' (a screen capture is attached)',
  '（附摄像头画面）': ' (a camera frame is attached)',
} as Record<string, string>

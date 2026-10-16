import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Bookmark,
  Brain,
  Check,
  Copy,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react'
import type { LearningGoal, MindEntry, MindStore } from '../../learn/types'
import { MIND_MAX_CHARS } from '../../learn/mind'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface MemoryTabProps {
  goals: LearningGoal[]
  minds: MindStore
  onWrite: (goalId: string, input: { key?: string; text: string }) => void
  onUpdate: (goalId: string, id: string, text: string) => void
  onDelete: (goalId: string, idOrKey: string) => void
  onClear: (goalId: string) => void
  onToast: (msg: string) => void
}

/** 格式化时间戳 */
const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function MemoryTab({
  goals,
  minds,
  onWrite,
  onUpdate,
  onDelete,
  onClear,
  onToast,
}: MemoryTabProps) {
  // 选中的目标 ID，null 表示「全部目标」
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 新增记忆表单状态
  const [isAdding, setIsAdding] = useState(false)
  const [newGoalId, setNewGoalId] = useState<string>('')
  const [newKey, setNewKey] = useState('')
  const [newText, setNewText] = useState('')

  // 编辑记忆状态
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // 清空二次确认
  const [confirmClearGoalId, setConfirmClearGoalId] = useState<string | null>(null)

  // 目标查找表
  const goalMap = useMemo(() => {
    return new Map<string, LearningGoal>(goals.map((g) => [g.id, g]))
  }, [goals])

  // 所有展平的记忆条目
  const allEntries = useMemo(() => {
    const list: Array<{ goalId: string; goalTitle: string; entry: MindEntry }> = []
    for (const [gid, items] of Object.entries(minds)) {
      if (!Array.isArray(items)) continue
      const g = goalMap.get(gid)
      const goalTitle = g?.question || t('未知目标 ({0})', gid.slice(0, 8))
      for (const item of items) {
        list.push({ goalId: gid, goalTitle, entry: item })
      }
    }
    // 按最近更新时间倒序
    list.sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
    return list
  }, [minds, goalMap])

  // 过滤后的记忆条目
  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allEntries.filter((item) => {
      if (selectedGoalId && item.goalId !== selectedGoalId) return false
      if (!q) return true
      return (
        item.entry.text.toLowerCase().includes(q) ||
        (item.entry.key && item.entry.key.toLowerCase().includes(q)) ||
        item.goalTitle.toLowerCase().includes(q)
      )
    })
  }, [allEntries, selectedGoalId, searchQuery])

  // 复制正文
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedId(id)
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur))
    }, 1500)
  }

  // 提交新增
  const handleCreate = () => {
    const targetGid = selectedGoalId || newGoalId || goals[0]?.id
    if (!targetGid) {
      onToast(t('请先选择或创建一个学习目标'))
      return
    }
    const text = newText.trim()
    if (!text) {
      onToast(t('记忆内容不能为空'))
      return
    }
    onWrite(targetGid, { key: newKey.trim() || undefined, text })
    setNewText('')
    setNewKey('')
    setIsAdding(false)
    onToast(t('已为目标写入记忆'))
  }

  // 提交编辑
  const handleSaveEdit = (goalId: string, entryId: string) => {
    const text = editText.trim()
    if (!text) return
    onUpdate(goalId, entryId, text)
    setEditingId(null)
    setEditText('')
    onToast(t('记忆内容已更新'))
  }

  return (
    <div className={pane(4)}>
      {/* 顶部概览 */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-card via-card to-paper-deep/50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-seal/10 text-seal border border-seal/20 shadow-2xs">
              <Brain size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-bold text-ink-strong">{t('Agent 长期记忆管理 (Mind)')}</h3>
                <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep">
                  {t('共 {0} 条沉淀记忆', allEntries.length)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {t('超级导师在引导学习过程中自主记录的偏好判断与关键认知，按学习目标独立归档存储。')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsAdding((v) => !v)
                if (!newGoalId && goals.length > 0) {
                  setNewGoalId(selectedGoalId || goals[0].id)
                }
              }}
              className="flex items-center gap-1.5 rounded-xl bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-2xs transition hover:bg-seal-deep"
            >
              <Plus size={14} />
              <span>{isAdding ? t('收起表单') : t('录入记忆')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* 记忆机制原理科普提示 */}
      <section className="rounded-xl border border-line/60 bg-paper-deep/40 p-3.5 text-[11px] leading-relaxed text-ink-faint flex items-start gap-2.5">
        <Sparkles size={14} className="text-seal shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-ink-soft">{t('前缀缓存友好架构：')}</span>
          <span>
            {t(
              '记忆数据绝不会静默拼接进系统提示词，以确保模型前缀缓存 (Prefix Caching) 精确对齐。导师在需要回忆过往认知时，会通过 sandboxed mind.list() 与 mind.read() 原生接口主动查阅。',
            )}
          </span>
        </div>
      </section>

      {/* 新增记忆卡片表单 */}
      {isAdding && (
        <section className="rounded-2xl border border-seal/30 bg-seal/5 p-4 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-seal/15">
            <div className="flex items-center gap-2 text-[12.5px] font-bold text-ink-strong">
              <Bookmark size={14} className="text-seal" />
              <span>{t('手动录入长期记忆')}</span>
            </div>
            <span className="text-[10.5px] text-ink-faint">
              {t('上限 {0} 字符', MIND_MAX_CHARS)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-ink-soft mb-1">{t('归属目标')}</label>
              <select
                value={selectedGoalId || newGoalId || (goals[0]?.id ?? '')}
                disabled={Boolean(selectedGoalId)}
                onChange={(e) => setNewGoalId(e.target.value)}
                className="w-full rounded-xl border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none focus:border-seal"
              >
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.question}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-ink-soft mb-1">
                {t('记忆主题 Key (可选，同 Key 自动覆盖更新)')}
              </label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('如：薄弱知识点、学习偏好、常犯错题')}
                className="w-full rounded-xl border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none focus:border-seal"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-[11px] font-medium text-ink-soft mb-1">{t('记忆正文')}</label>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={3}
              placeholder={t('输入该学习目标下的关键记忆结论、偏好规则或反思记录…')}
              className="w-full rounded-xl border border-line bg-paper p-3 text-[12px] text-ink-strong outline-none focus:border-seal font-mono leading-relaxed resize-none"
            />
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false)
                setNewText('')
                setNewKey('')
              }}
              className="rounded-xl border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-soft hover:bg-paper-deep"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="rounded-xl bg-seal px-4 py-1.5 text-[11.5px] font-medium text-white shadow-2xs hover:bg-seal-deep"
            >
              {t('写入记忆库')}
            </button>
          </div>
        </section>
      )}

      {/* 目标筛选与检索工具栏 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        {/* 目标标签切换 */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            type="button"
            onClick={() => setSelectedGoalId(null)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
              selectedGoalId === null
                ? 'bg-seal text-white shadow-2xs font-semibold'
                : 'bg-paper text-ink-faint hover:bg-paper-deep hover:text-ink border border-line/60'
            }`}
          >
            <span>{t('全部目标')}</span>
            <span
              className={`rounded-full px-1.5 py-px text-[10px] ${
                selectedGoalId === null ? 'bg-white/20 text-white' : 'bg-line/60 text-ink-faint'
              }`}
            >
              {allEntries.length}
            </span>
          </button>

          {goals.map((g) => {
            const count = (minds[g.id] || []).length
            const isSelected = selectedGoalId === g.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGoalId(g.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                  isSelected
                    ? 'bg-seal text-white shadow-2xs font-semibold'
                    : 'bg-paper text-ink-faint hover:bg-paper-deep hover:text-ink border border-line/60'
                }`}
              >
                <span className="max-w-[120px] truncate">{g.question}</span>
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-line/60 text-ink-faint'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 搜索与清空操作 */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索记忆关键字或标签…')}
              className="w-full rounded-xl border border-line bg-paper pl-8 pr-3 py-1.5 text-[11.5px] text-ink-strong outline-none focus:border-seal focus:ring-1 focus:ring-seal/20"
            />
          </div>

          {selectedGoalId && (minds[selectedGoalId] || []).length > 0 && (
            confirmClearGoalId === selectedGoalId ? (
              <button
                type="button"
                onClick={() => {
                  onClear(selectedGoalId)
                  setConfirmClearGoalId(null)
                  onToast(t('该目标下的记忆已全部清空'))
                }}
                onBlur={() => setConfirmClearGoalId(null)}
                className="flex items-center gap-1 rounded-xl border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11.5px] font-medium text-warn-deep hover:bg-warn/20"
              >
                <AlertCircle size={12} />
                <span>{t('点此确认清空')}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClearGoalId(selectedGoalId)}
                className="flex items-center gap-1 rounded-xl border border-line bg-paper px-2.5 py-1.5 text-[11.5px] text-ink-faint hover:bg-warn/10 hover:text-warn-deep"
                title={t('清空当前目标下的全部记忆')}
              >
                <Trash2 size={12} />
                <span>{t('清空此目标')}</span>
              </button>
            )
          )}
        </div>
      </section>

      {/* 记忆列表展示区 */}
      <section className="space-y-2.5">
        {filteredEntries.length === 0 ? (
          <div className="rounded-2xl border border-line bg-card/60 p-12 text-center">
            <Brain size={32} className="mx-auto text-ink-faint/60" />
            <h4 className="mt-3 text-[13px] font-semibold text-ink-soft">
              {searchQuery ? t('没有匹配到相关记忆') : t('暂无已沉淀的导师记忆')}
            </h4>
            <p className="mt-1 text-[11.5px] text-ink-faint max-w-[420px] mx-auto leading-relaxed">
              {searchQuery
                ? t('尝试更换检索关键字，或切换目标查看其他分类下的记忆条目。')
                : t('在学习过程中，超级导师会根据你的解题表现与对话习惯自动沉淀长期记忆；你也可以在上方点击「录入记忆」手动添加。')}
            </p>
          </div>
        ) : (
          filteredEntries.map(({ goalId, goalTitle, entry }) => {
            const isEditing = editingId === entry.id
            return (
              <div
                key={entry.id}
                className="group rounded-2xl border border-line bg-card p-4 shadow-2xs transition hover:border-line-strong/80 hover:shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-paper-deep px-2 py-0.5 text-[10.5px] font-medium text-ink-soft">
                      {goalTitle}
                    </span>
                    {entry.key && (
                      <span className="flex items-center gap-1 rounded-md bg-seal/10 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep">
                        <Tag size={10} />
                        <span>#{entry.key}</span>
                      </span>
                    )}
                    <span className="text-[10.5px] text-ink-faint">{fmtTime(entry.updatedAt)}</span>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => handleCopy(entry.id, entry.text)}
                      className="rounded p-1 text-ink-faint transition hover:bg-paper-deep hover:text-ink"
                      title={t('复制正文')}
                    >
                      {copiedId === entry.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.id)
                          setEditText(entry.text)
                        }}
                        className="rounded p-1 text-ink-faint transition hover:bg-paper-deep hover:text-ink"
                        title={t('编辑正文')}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(goalId, entry.id)
                        onToast(t('记忆已删除'))
                      }}
                      className="rounded p-1 text-ink-faint transition hover:bg-warn/10 hover:text-warn-deep"
                      title={t('删除此记忆')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-2.5">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-seal bg-paper p-2.5 text-[12px] text-ink-strong outline-none font-mono leading-relaxed"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-soft hover:bg-paper-deep"
                        >
                          {t('取消')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(goalId, entry.id)}
                          className="rounded-lg bg-seal px-3 py-1 text-[11px] font-medium text-white shadow-2xs hover:bg-seal-deep"
                        >
                          {t('保存修改')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-strong font-mono">
                      {entry.text}
                    </p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

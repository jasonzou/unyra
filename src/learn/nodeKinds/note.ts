/** 笔记：学习者与导师都能写的一份 markdown。叶子，不再往下连。 */
import { textMethods, type NodeKindSpec } from './base'
import { TextHandle, type HandleContext } from './handle'

export const noteKind: NodeKindSpec = {
  type: 'note',
  label: '笔记',
  rank: 2,
  targets: [],
  format: 'markdown',
  facet: { label: '笔记' },
  methods: textMethods('笔记'),
}

/** 笔记节点：与正文同一套文本方法（多态的同形面）；write 一份不存在的笔记会新建 */
export class NoteHandle extends TextHandle {
  constructor(ctx: HandleContext, nodeId: string, baseLabel: string, name?: string) {
    super(ctx, nodeId, baseLabel, 'note', name)
  }
  get kind(): string {
    return 'note'
  }
}

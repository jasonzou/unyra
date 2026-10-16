/**
 * 链式数据迁移脚本注册表。
 *
 * 数据迁移机制用于后续版本迭代：当未来版本（如 0.7.0 / 0.8.0 等）引入数据存储结构变更时，
 * 在此注册具体的迁移脚本。
 *
 * 迁移引擎将根据用户当前数据版本自动计算有向迁移链路，实现跨版本平滑无损升级。
 */

import type { MigrationScript } from './types'

/**
 * 迁移脚本清单。
 * 后续版本若出现数据存储结构重构，在此添加具体的迁移脚本。
 * 格式示例：
 * {
 *   id: 'm_0_6_3_to_0_7_0',
 *   fromVersion: '0.6.3',
 *   toVersion: '0.7.0',
 *   title: '示例升级脚本',
 *   summary: '说明...',
 *   changes: ['...'],
 *   migrate: async (ctx) => { ... }
 * }
 */
export const MIGRATION_SCRIPTS: MigrationScript[] = []

/** 供外部或插件动态注册迁移脚本 */
export function registerMigrationScript(script: MigrationScript): void {
  const exists = MIGRATION_SCRIPTS.some((s) => s.id === script.id)
  if (!exists) {
    MIGRATION_SCRIPTS.push(script)
  }
}

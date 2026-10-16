/**
 * 启动期自动数据迁移调度器。
 *
 * 作用：
 * 当应用更新到新版本启动时，若检测到用户当前存储数据版本落后于应用目标版本，
 * 在加载教学文档 (hydrateLearnStore) 之前自动触发链式迁移，实现跨版本无感升级；
 * 避免用户因未手动进入设置页执行迁移而导致新代码读取旧结构报错。
 */

import { planChain, runChain } from './engine'
import {
  detectSchemaVersion,
  LATEST_SCHEMA_VERSION,
} from './version'

export interface AutoMigrateResult {
  migrated: boolean
  fromVersion?: string
  toVersion?: string
  error?: string
}

/**
 * 在用户作用域初始化时自动检查并执行迁移。
 * 默认开启自动迁移，可通过 schema.json 中的 autoMigrate: false 关闭。
 */
export async function autoMigrateIfNeeded(
  uid: string,
  onLog?: (msg: string) => void,
): Promise<AutoMigrateResult> {
  const logger = onLog || ((msg: string) => console.log(`[auto-migrate] ${msg}`))

  try {
    const { version: currentVersion, meta } = await detectSchemaVersion(uid)

    // 用户显式关闭了自动迁移
    if (meta?.autoMigrate === false) {
      logger(`用户已配置关闭自动迁移 (autoMigrate=false)，保持当前数据结构 v${currentVersion}`)
      return { migrated: false, fromVersion: currentVersion, toVersion: currentVersion }
    }

    // 规划迁移链
    const plan = planChain(currentVersion, LATEST_SCHEMA_VERSION)
    if (plan.isUpToDate || plan.scripts.length === 0) {
      return { migrated: false, fromVersion: currentVersion, toVersion: currentVersion }
    }

    logger(
      `检测到数据结构落后 (v${currentVersion} < v${LATEST_SCHEMA_VERSION})，正在启动启动期自动链式迁移（共 ${plan.scripts.length} 个阶段）…`,
    )

    const res = await runChain(uid, plan.scripts, undefined, logger)

    if (res.ok) {
      logger(`自动链式迁移成功完成，数据结构已对齐至最新 v${LATEST_SCHEMA_VERSION}。`)
      return {
        migrated: true,
        fromVersion: currentVersion,
        toVersion: LATEST_SCHEMA_VERSION,
      }
    } else {
      logger(`自动迁移执行遇到异常中断：${res.error}`)
      return {
        migrated: false,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        error: res.error,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger(`自动迁移探测失败：${msg}`)
    return {
      migrated: false,
      error: msg,
    }
  }
}

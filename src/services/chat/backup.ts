import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import type { ImportProgressCallback } from './history/importArchive.js'
import { clearLocalHistory, mergeHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 串行处理历史操作；支持 Web Locks 时也防止各标签页同时写入同一暂存区。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(() =>
    navigator.locks ? navigator.locks.request('chat-demo-history', run) : run()
  )
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

/** ZIP 完整校验后，合并尚未存在的会话与其图片原件。 */
export const importHistory = (file: File, onProgress?: ImportProgressCallback) =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return mergeHistory(() => importArchive(file, onProgress))
  })

/** 确认删除后调用，清空本地会话与附件。 */
export const clearHistory = (): Promise<void> => enqueueBackup(clearLocalHistory)

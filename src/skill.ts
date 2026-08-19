import type { Context } from '@deepseek-ai/cordis'

/** Runtime skill: automated crash-scene collection + analysis for automotive/Android devices. */
export const CRASH_ANALYSIS_SKILL = {
  name: 'dsh-adb-crash-analysis',
  description: '采集车机/安卓设备崩溃现场（crash buffer / dropbox / 进程 / 内存）并输出结构化分析报告',
  whenToUse: '遇到车机应用崩溃、ANR、无响应，或需要系统性采集崩溃上下文做稳定性分析时',
  content: `# 车机崩溃现场分析

用 dsh-adb 采集崩溃现场并给出结构化结论。适合实车/台架联调与稳定性回归。

## 流程

1. **确认设备**：调用 \`adb_devices\` 拿到设备 serial；多设备时用 \`-s <serial>\` 显式指定。
2. **采集崩溃现场**：调用 \`adb_crash_report\`（package 为目标应用，如 com.example.hmi），一次拿到：
   - crashBuffer：logcat crash 缓冲区的结构化条目（AndroidRuntime 堆栈、native crash）
   - dropbox：系统 dropbox 的崩溃条目摘录
   - processes：当前进程状态摘录
   - meminfo：目标应用内存摘要（PSS/堆）
3. **定位主崩溃**：从 crashBuffer 里找 \`FATAL EXCEPTION\` 或 \`AndroidRuntime\` E 级条目；提取崩溃线程、异常类型（如 NullPointerException / RuntimeException / SIGSEGV）、首次出现时间与最后出现时间。
4. **交叉验证**：
   - 有堆栈 → 结合进程状态判断是否仍在运行/重启循环
   - 内存异常（PSS 过高/持续增长）→ 用 \`adb_perf_snapshot\` 补充 meminfo/gfxinfo
   - dropbox 有 \`SYSTEM_TOMBSTONE\`/ANR 条目 → 一并纳入
5. **输出报告**（结构化）：
   - 崩溃进程与包名、时间线（首现/末现）、异常类型与关键堆栈（截断到可读）
   - 根因线索（代码位置、资源、并发、内存）与置信度
   - 建议动作（修代码 / 加防护 / 复测方案）

## 与定时任务组合（dsh-automation）

在 dsh-automation 中建每日/每版本任务，prompt 指向本流程：
「按 dsh-adb-crash-analysis 流程，对 <设备> 上 <包名> 采集崩溃现场并输出分析报告，保留可审计历史。」
配合 \`adb_crash_report\` 的 since 参数可只采集指定时间窗口之后的崩溃。
`,
}

type SkillsService = { register(skill: unknown): () => void }

export function registerSkills(ctx: Context): void {
  const skills = ctx.get('skills') as SkillsService | undefined
  if (skills === undefined) return
  ctx.effect(() => skills.register(CRASH_ANALYSIS_SKILL))
}

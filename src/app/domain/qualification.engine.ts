/**
 * 纯函数领域引擎：资质版本选择、计划按作业日计算、更新失效重算、
 * 并发证书裁决、追溯包幂等导出与按包号恢复。
 * 不依赖 Angular / RxJS，便于独立自测。
 */
import type {
  InspectionPlan,
  PlanBasisEntry,
  QualificationChangeEvent,
  QualificationConflict,
  QualificationVersion,
  TracePackage,
  Weld,
} from './types'

/** 日期比较：a < b 返回负数；入参为 YYYY-MM-DD，可直接字典序比较 */
export function dayDiff(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 取焊工在「作业日当天」唯一有效的证书版本。
 * 规则：状态为『生效』、日期区间覆盖作业日（含首尾）、方法覆盖焊缝方法；
 * 同日多版本命中时取 seq 最大者（换证以最新登记为准），其余由并发裁决保证不并存。
 */
export function qualificationOn(
  versions: QualificationVersion[],
  welderId: string,
  method: string,
  workday: string,
): QualificationVersion | null {
  const hit = versions
    .filter(
      (q) =>
        q.status === '生效' &&
        q.welderId === welderId &&
        dayDiff(q.effectiveFrom, workday) <= 0 &&
        (q.effectiveTo === null || dayDiff(workday, q.effectiveTo) <= 0) &&
        (q.methods.includes('*') || q.methods.includes(method)),
    )
    .sort((a, b) => b.seq - a.seq)
  return hit[0] ?? null
}

/** 计算一批焊缝在某作业日的资质依据 */
export function evaluateBasis(
  welds: Weld[],
  versions: QualificationVersion[],
  weldIds: string[],
  workday: string,
): PlanBasisEntry[] {
  return weldIds.map((weldId) => {
    const weld = welds.find((w) => w.id === weldId)
    if (!weld) {
      return { weldId, welderId: '', method: '', qualificationId: null, certNo: null, valid: false, reason: '焊缝不存在' }
    }
    const q = qualificationOn(versions, weld.welderId, weld.method, workday)
    if (!q) {
      return { weldId, welderId: weld.welderId, method: weld.method, qualificationId: null, certNo: null, valid: false, reason: `${workday} 无覆盖 ${weld.method} 的有效证书` }
    }
    return {
      weldId,
      welderId: weld.welderId,
      method: weld.method,
      qualificationId: q.id,
      certNo: q.certNo,
      valid: true,
      reason: `依据 ${q.certNo}（${q.effectiveFrom} 起生效）`,
    }
  })
}

/** 重算未完成计划：只更新依据有效性，不改变已完成计划 */
export function recalculatePlan(
  plan: InspectionPlan,
  welds: Weld[],
  versions: QualificationVersion[],
  now: string,
): InspectionPlan {
  if (plan.state === '已完成') return plan // 已完成结论保留原依据
  const basis = evaluateBasis(welds, versions, plan.weldIds, plan.date)
  const allValid = basis.every((b) => b.valid)
  return {
    ...plan,
    calculatedAt: now,
    lifecycle: allValid ? '有效' : '已失效待重排',
    invalidReason: allValid ? undefined : basis.filter((b) => !b.valid).map((b) => `${b.weldId}: ${b.reason}`).join('；'),
    // 未完成计划不固化 basis —— 执行当天才按当天证书固化
  }
}

export type SubmissionOutcome =
  | { kind: 'accepted'; versionId: string }
  | { kind: 'conflict'; conflictId: string; winnerId: string }
  | { kind: 'rejected'; conflictId: string }
  | { kind: 'duplicate'; versionId: string }

export interface QualificationSubmissionResult {
  versions: QualificationVersion[]
  conflicts: QualificationConflict[]
  events: QualificationChangeEvent[]
  plans: InspectionPlan[]
  outcome: SubmissionOutcome
}

/** 判断两本证书内容是否一致（同一焊工重复提交完全相同内容视为幂等重复） */
function sameCertificate(a: QualificationVersion, b: QualificationVersion): boolean {
  return (
    a.certNo === b.certNo &&
    a.standard === b.standard &&
    a.effectiveFrom === b.effectiveFrom &&
    a.effectiveTo === b.effectiveTo &&
    a.methods.length === b.methods.length &&
    a.methods.every((m) => b.methods.includes(m))
  )
}

function methodsOverlap(a: string[], b: string[]): boolean {
  if (a.includes('*') || b.includes('*')) return true
  return a.some((m) => b.includes(m))
}

/**
 * 两个录入端同时提交同一焊工的新证书：
 * 以 seq（服务端先到序号）裁决——seq 小者先到。
 *
 * 换证（replacesQualificationId 指向一本仍『生效』的旧证）：
 *  先到者把旧证置废、新证生效；后到者发现目标旧证已被置废，
 *  即与先到的新版本冲突——后到原文搁置、不覆盖。
 *
 * 不声明替换（补录/新增）时，与同一焊工生效日重叠且方法覆盖相交的
 * 已生效证书视为同一本证书的并发录入：先到生效，后到留冲突；
 * 方法覆盖互不相交的版本可共存。
 *
 * 提交后立即重算所有「未完成」计划；已完成计划不动。
 */
export function submitQualification(
  current: {
    versions: QualificationVersion[]
    conflicts: QualificationConflict[]
    plans: InspectionPlan[]
    welds: Weld[]
  },
  incoming: Omit<QualificationVersion, 'id' | 'seq' | 'status'> & {
    seq: number
    replacesQualificationId?: string
  },
  now: string,
): QualificationSubmissionResult {
  const candidate: QualificationVersion = { ...incoming, id: `Q-${incoming.seq}`, status: '生效' }
  const replaceId = incoming.replacesQualificationId

  const overlapping = (): QualificationVersion[] =>
    current.versions.filter(
      (q) =>
        q.welderId === candidate.welderId &&
        q.status === '生效' &&
        dayDiff(q.effectiveFrom, candidate.effectiveTo ?? '9999-12-31') <= 0 &&
        dayDiff(candidate.effectiveFrom, q.effectiveTo ?? '9999-12-31') <= 0 &&
        methodsOverlap(q.methods, candidate.methods),
    )

  // 幂等：完全相同内容（任一端重发）直接命中已存在版本
  const identical = current.versions
    .filter((q) => q.id !== replaceId)
    .find((q) => q.welderId === candidate.welderId && sameCertificate(q, candidate))

  if (identical) {
    return { versions: current.versions, conflicts: current.conflicts, events: [], plans: current.plans, outcome: { kind: 'duplicate', versionId: identical.id } }
  }

  let winner: QualificationVersion | null = null
  let rejectOnly = false
  let conflictReason = ''

  if (replaceId) {
    const target = current.versions.find((q) => q.id === replaceId)
    if (!target || target.welderId !== candidate.welderId) {
      rejectOnly = true
      conflictReason = `声明替换的证书 ${replaceId} 不存在或不属于该焊工`
    } else if (target.status === '作废') {
      // 目标旧证已被另一请求置废：找到先到的新版本（换证事件链）
      winner =
        overlapping().sort((a, b) => b.seq - a.seq)[0] ??
        current.versions
          .filter((q) => q.welderId === candidate.welderId && q.status === '生效' && q.seq > target.seq && q.seq < candidate.seq)
          .sort((a, b) => b.seq - a.seq)[0] ??
        null
      conflictReason = `旧证 ${target.certNo} 已被先到请求换发${winner ? `（${winner.certNo}，序号 ${winner.seq}）` : ''}，本端后到（序号 ${candidate.seq}），内容留存待裁决`
    } else if (target.status === '冲突搁置') {
      rejectOnly = true
      conflictReason = `目标证书 ${target.certNo} 处于冲突搁置状态，不能作为换证对象`
    } else {
      // 先到换证路径的前置检查：另有更早的重叠生效版本（防御乱序）
      const prior = overlapping().filter((q) => q.id !== replaceId && q.seq < candidate.seq).sort((a, b) => a.seq - b.seq)
      if (prior.length > 0) {
        winner = prior[0]
        conflictReason = `录入端 ${candidate.source} 后到（序号 ${candidate.seq} > ${winner.seq}），与已生效证书 ${winner.certNo} 重叠`
      }
    }
  } else {
    const prior = overlapping().filter((q) => q.seq < candidate.seq).sort((a, b) => a.seq - b.seq)
    if (prior.length > 0) {
      winner = prior[0]
      conflictReason = `录入端 ${candidate.source} 后到（序号 ${candidate.seq} > ${winner.seq}），与已生效证书 ${winner.certNo} 生效日重叠，原文留存待人工裁决`
    }
  }

  if (winner || rejectOnly) {
    const loser: QualificationVersion = { ...candidate, status: '冲突搁置' }
    const conflict: QualificationConflict = {
      id: `C-${candidate.seq}`,
      welderId: candidate.welderId,
      incoming: loser,
      winnerId: winner?.id ?? '',
      reason: conflictReason,
      status: '待裁决',
      createdAt: now,
    }
    return {
      versions: [...current.versions, loser],
      conflicts: [conflict, ...current.conflicts],
      events: [],
      plans: current.plans,
      outcome: winner
        ? { kind: 'conflict', conflictId: conflict.id, winnerId: winner.id }
        : { kind: 'rejected', conflictId: conflict.id },
    }
  }

  // 先到：候选生效
  let versions = [...current.versions, candidate]
  let conflicts = current.conflicts
  let supersededQualificationId: string | undefined

  if (replaceId) {
    supersededQualificationId = replaceId
    versions = versions.map((q) => (q.id === replaceId ? { ...q, status: '作废' } : q))
  }

  // 防御：存在 seq 更大的重叠版本（乱序到达），后到者转冲突
  const later = overlapping().filter((q) => q.seq > candidate.seq)
  if (later.length > 0) {
    versions = versions.map((q) => (later.some((l) => l.id === q.id) ? { ...q, status: '冲突搁置' } : q))
    conflicts = [
      ...later.map<QualificationConflict>((q) => ({
        id: `C-${q.seq}`,
        welderId: q.welderId,
        incoming: q,
        winnerId: candidate.id,
        reason: `与先到证书 ${candidate.certNo} 生效日重叠，转冲突留存`,
        status: '待裁决',
        createdAt: now,
      })),
      ...conflicts,
    ]
  }

  // 资质更新 → 所有未完成计划立即重算；记录「新失效」计划清单
  const before = current.plans
  const after = before.map((p) => recalculatePlan(p, current.welds, versions, now))
  const invalidatedPlanIds = after
    .filter((p, i) => p.lifecycle === '已失效待重排' && before[i].lifecycle !== '已失效待重排')
    .map((p) => p.id)

  const event: QualificationChangeEvent = {
    id: `E-${candidate.seq}`,
    at: now,
    welderId: candidate.welderId,
    qualificationId: candidate.id,
    certNo: candidate.certNo,
    source: candidate.source,
    seq: candidate.seq,
    supersededQualificationId,
    invalidatedPlanIds,
  }

  return { versions, conflicts, events: [event], plans: after, outcome: { kind: 'accepted', versionId: candidate.id } }
}

/**
 * 完成计划：执行当天固化依据快照（证书版本 + 资质链序号上界）。
 * 此后任何资质更新都不得改动该结论。
 */
export function completePlan(
  plan: InspectionPlan,
  welds: Weld[],
  versions: QualificationVersion[],
  now: string,
): InspectionPlan {
  if (plan.state === '已完成') return plan
  const basis = evaluateBasis(welds, versions, plan.weldIds, plan.date)
  const maxSeq = versions.reduce((m, q) => Math.max(m, q.seq), 0)
  return {
    ...plan,
    state: '已完成',
    lifecycle: '有效',
    invalidReason: undefined,
    calculatedAt: now,
    basis,
    basisQualSeq: maxSeq,
  }
}

/**
 * 追溯包导出：同一 idempotencyKey 的重复请求返回同一包、同一记录集，
 * 不允许重复导出多出记录。失败时落『导出失败』状态，可按包号恢复。
 */
export function exportTracePackage(
  packages: TracePackage[],
  params: { idempotencyKey: string; planIds: string[]; createdBy: string },
  now: string,
  fail = false,
): { packages: TracePackage[]; pkg: TracePackage; reused: boolean } {
  const existing = packages.find((p) => p.idempotencyKey === params.idempotencyKey)
  if (existing) {
    // 幂等命中：不新增任何记录
    return { packages, pkg: existing, reused: true }
  }

  const fingerprint = fingerprintOf(params.planIds)
  const pkg: TracePackage = {
    id: `TP-${now.replace(/[-:T.]/g, '')}-${fingerprint.slice(0, 6)}`,
    createdAt: now,
    createdBy: params.createdBy,
    planIds: [...params.planIds],
    fingerprint,
    recordCount: params.planIds.length,
    status: fail ? '导出失败' : '已导出',
    attempts: [{ at: now, result: fail ? '失败' : '成功', detail: fail ? '追溯包生成失败，记录不完整' : `导出 ${params.planIds.length} 条记录` }],
    idempotencyKey: params.idempotencyKey,
  }
  return { packages: [pkg, ...packages], pkg, reused: false }
}

/** 按包号恢复失败的追溯包；恢复成功记录不重复生成，只补流水并改状态 */
export function restoreTracePackage(packages: TracePackage[], packageId: string, now: string): { packages: TracePackage[]; pkg?: TracePackage } {
  const pkg = packages.find((p) => p.id === packageId)
  if (!pkg) return { packages }
  if (pkg.status === '已导出' || pkg.status === '已恢复') {
    // 已成功的包不允许恢复出第二份记录
    return { packages, pkg }
  }
  const restored: TracePackage = {
    ...pkg,
    status: '已恢复',
    recordCount: pkg.planIds.length, // 记录数与包内既定范围一致，不多不少
    attempts: [...pkg.attempts, { at: now, result: '恢复', detail: `按包号 ${packageId} 恢复，补齐 ${pkg.planIds.length} 条记录` }],
  }
  return { packages: packages.map((p) => (p.id === packageId ? restored : p)), pkg: restored }
}

function fingerprintOf(planIds: string[]): string {
  // 轻量确定性指纹（演示用 FNV-1a；正式环境替换为 SHA-256）
  const text = [...planIds].sort().join('|')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

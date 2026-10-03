import { computed, inject, Injectable, signal } from '@angular/core'
import {
  completePlan,
  dayDiff,
  evaluateBasis,
  exportTracePackage,
  qualificationOn,
  recalculatePlan,
  restoreTracePackage,
  submitQualification,
} from './qualification.engine'
import { seedPackages, seedPlans, seedVersions, seedWelds, welders, TODAY } from './seed'
import type {
  InspectionPlan,
  PlanBasisEntry,
  QualificationChangeEvent,
  QualificationConflict,
  QualificationVersion,
  TracePackage,
  Weld,
  Welder,
} from './types'

export interface QualificationFormInput {
  welderId: string
  certNo: string
  standard: string
  methods: string[]
  effectiveFrom: string
  effectiveTo: string | null
  source: 'pc' | 'pad'
  /** 换证时指向被替换的旧证书；补录/新增留空 */
  replacesQualificationId?: string
}

@Injectable({ providedIn: 'root' })
export class QualificationStore {
  private _welders = signal<Welder[]>(welders)
  private _welds = signal<Weld[]>(seedWelds)
  private _versions = signal<QualificationVersion[]>(seedVersions)
  private _conflicts = signal<QualificationConflict[]>([])
  private _plans = signal<InspectionPlan[]>(seedPlans)
  private _events = signal<QualificationChangeEvent[]>([])
  private _packages = signal<TracePackage[]>(seedPackages)
  private _seq = signal(100) // 模拟服务端单调序号；两端用同一 store 模拟先后到达

  /** 模拟系统作业日（默认真实今天，演示固定 2026-10-03） */
  readonly workday = signal<string>(TODAY)

  readonly weldersList = this._welders.asReadonly()
  readonly welds = this._welds.asReadonly()
  readonly versions = this._versions.asReadonly()
  readonly conflicts = this._conflicts.asReadonly()
  readonly plans = this._plans.asReadonly()
  readonly events = this._events.asReadonly()
  readonly packages = this._packages.asReadonly()

  private clock() {
    return new Date().toISOString().slice(0, 19)
  }

  // ---------- 查询：计划当天只看当天有效证书 ----------

  /** 某条焊缝在指定作业日的有效证书 */
  effectiveQualification(welderId: string, method: string, workday = this.workday()) {
    return qualificationOn(this._versions(), welderId, method, workday)
  }

  /** 计划的实时依据：未完成按作业日现算（不固化）；已完成返回固化快照 */
  planBasis(plan: InspectionPlan): PlanBasisEntry[] {
    if (plan.state === '已完成' && plan.basis) return plan.basis
    return evaluateBasis(this._welds(), this._versions(), plan.weldIds, plan.date)
  }

  /** 台账视图：每条焊缝在系统作业日的资质状态 */
  readonly weldRows = computed(() => {
    const day = this.workday()
    return this._welds().map((weld) => {
      const q = qualificationOn(this._versions(), weld.welderId, weld.method, day)
      const welder = this._welders().find((h) => h.id === weld.welderId)
      return {
        weld,
        welder,
        qualification: q,
        valid: q !== null,
        // 证书将在 30 天内到期（今天仍有效）
        expiringSoon: q !== null && q.effectiveTo !== null && dayDiff(day, q.effectiveTo) <= 0 && daysBetween(day, q.effectiveTo) <= 30,
      }
    })
  })

  readonly invalidOpenPlans = computed(() =>
    this._plans().filter((p) => p.state !== '已完成' && p.lifecycle === '已失效待重排'),
  )

  // ---------- 命令 ----------

  /**
   * 录入新证书。两个录入端几乎同时提交时，调用方各自拿到服务端序号：
   * 序号小的先到生效，大的后到留冲突（见引擎 submitQualification）。
   * 返回裁决结果供界面提示。
   */
  submitCertificate(input: QualificationFormInput) {
    const seq = this._seq() + 1
    this._seq.set(seq)
    const result = submitQualification(
      {
        versions: this._versions(),
        conflicts: this._conflicts(),
        plans: this._plans(),
        welds: this._welds(),
      },
      {
        welderId: input.welderId,
        certNo: input.certNo,
        standard: input.standard,
        methods: input.methods,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        source: input.source,
        seq,
        replacesQualificationId: input.replacesQualificationId,
      },
      this.clock(),
    )
    this._versions.set(result.versions)
    this._conflicts.set(result.conflicts)
    this._plans.set(result.plans)
    if (result.events.length) this._events.update((list) => [...result.events, ...list])
    return result.outcome
  }

  /** 人工裁决冲突：采纳搁置版本（覆盖先到版本，留痕）或驳回；采纳后重算未完成计划 */
  resolveConflict(conflictId: string, decision: '采纳' | '驳回', actor = '质量员') {
    const conflict = this._conflicts().find((c) => c.id === conflictId)
    if (!conflict || conflict.status !== '待裁决') return
    const now = this.clock()
    if (decision === '采纳') {
      // 人工裁决优先级最高：搁置版本转生效，先到版本作废（全程留痕可回溯）
      this._versions.update((list) =>
        list.map((q) => {
          if (q.id === conflict.incoming.id) return { ...q, status: '生效' as const }
          if (q.id === conflict.winnerId) return { ...q, status: '作废' as const }
          return q
        }),
      )
      this._plans.update((list) =>
        list.map((p) => (p.state === '已完成' ? p : recalculatePlan(p, this._welds(), this._versions(), now))),
      )
      this._events.update((list) => [
        {
          id: `E-R-${conflict.id}`,
          at: now,
          welderId: conflict.welderId,
          qualificationId: conflict.incoming.id,
          certNo: conflict.incoming.certNo,
          source: `人工裁决:${actor}`,
          seq: this._seq(),
          supersededQualificationId: conflict.winnerId || undefined,
          invalidatedPlanIds: [],
        },
        ...list,
      ])
    }
    this._conflicts.update((list) =>
      list.map((c) => (c.id === conflictId ? { ...c, status: decision, resolvedAt: now, resolvedBy: actor } : c)),
    )
  }

  /** 完成计划：当天固化依据，之后资质变更不再影响 */
  completePlan(planId: string) {
    const now = this.clock()
    this._plans.update((list) =>
      list.map((p) => (p.id === planId ? completePlan(p, this._welds(), this._versions(), now) : p)),
    )
  }

  /** 手动重排（已失效计划重算一次；资质补齐后即恢复有效） */
  recompute(planId?: string) {
    const now = this.clock()
    this._plans.update((list) =>
      list.map((p) => (planId === undefined || p.id === planId ? recalculatePlan(p, this._welds(), this._versions(), now) : p)),
    )
  }

  // ---------- 追溯包：幂等导出 + 按包号恢复 ----------

  exportPackage(planIds: string[], fail = false) {
    const key = `trace:${[...planIds].sort().join(',')}`
    const result = exportTracePackage(
      this._packages(),
      { idempotencyKey: key, planIds, createdBy: '质量负责人' },
      this.clock(),
      fail,
    )
    this._packages.set(result.packages)
    return { pkg: result.pkg, reused: result.reused }
  }

  restorePackage(packageId: string) {
    const result = restoreTracePackage(this._packages(), packageId, this.clock())
    this._packages.set(result.packages)
    return result.pkg
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

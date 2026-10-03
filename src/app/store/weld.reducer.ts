import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, InspectionPlan, Qualification, QualificationConflict, TracePackage, Weld } from '../types'
import { buildBasis, buildPackageSnapshot, packageNoFor, recalculatePlan, REFERENCE_DATE } from './domain'
import * as A from './weld.actions'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  qualifications: Qualification[]
  conflicts: QualificationConflict[]
  packages: TracePackage[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  audit: AuditEvent[]
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = {
  welds: [], plans: [], qualifications: [], conflicts: [], packages: [],
  selectedId: '', statusFilter: '全部', locked: false, version: 12, audit,
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function auditEntry(action: string, target: string, detail: string, actor = '当前审核人'): AuditEvent {
  return { id: `AE-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, time: nowTime(), actor, action, target, detail }
}

/** 未完成计划按作业日重算：已完成计划一律不动，结论保留原依据 */
function recalcPlans(plans: InspectionPlan[], welds: Weld[], certs: Qualification[], at: string): { plans: InspectionPlan[]; events: AuditEvent[] } {
  const events: AuditEvent[] = []
  const next = plans.map((plan) => {
    if (plan.state === '已完成') return plan
    const result = recalculatePlan(plan, welds, certs)
    const wasInvalid = !!plan.invalid
    if (result.invalid && !wasInvalid) {
      events.push(auditEntry('计划失效重算', plan.id, `资质更新后重算：${result.invalidWeldIds.map((w) => `${w.weldId}（${w.welder}）`).join('、')} 在计划当天 ${plan.date} 无有效证书，已暂停并移出执行序列`))
    } else if (!result.invalid && wasInvalid) {
      events.push(auditEntry('计划恢复', plan.id, `重算通过：计划当天 ${plan.date} 全部焊缝均有有效证书，恢复执行`))
    }
    return { ...plan, invalid: result.invalid, invalidWeldIds: result.invalidWeldIds, recalculatedAt: at }
  })
  return { plans: next, events }
}

export const weldReducer = createReducer(
  initialState,

  on(A.loadWeldsSuccess, (state, { welds, plans, qualifications }) => {
    const { plans: recalced, events } = recalcPlans(plans, welds, qualifications, nowTime())
    return {
      ...state, welds, qualifications,
      plans: recalced,
      selectedId: state.selectedId || welds[0]?.id || '',
      audit: [...events, ...state.audit],
    }
  }),

  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),

  on(A.advanceWeld, (state, { id, status }) => ({
    ...state,
    version: state.version + 1,
    welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld),
    audit: [auditEntry('状态流转', id, `状态变更为 ${status}`), ...state.audit],
  })),

  on(A.createPlan, (state, { plan }) => {
    const { plans, events } = recalcPlans([plan], state.welds, state.qualifications, nowTime())
    return { ...state, plans: [plans[0], ...state.plans], version: state.version + 1, audit: [...events, ...state.audit] }
  }),

  on(A.lockBaseline, (state) => ({
    ...state,
    locked: true,
    audit: [auditEntry('签字锁定', '检测批次', '焊工资质、检测比例与返修闭环已确认', '质量负责人'), ...state.audit],
  })),

  // ── 资质版本：先到生效，后到留冲突 ──────────────────────────────
  on(A.submitQualification, (state, { welder, certNo, method, grade, validFrom, validTo, baseVersion, terminal }) => {
    const current = state.qualifications
      .filter((q) => q.welder === welder && q.status === '现行')
      .sort((a, b) => b.version - a.version)[0]

    if (current && current.version !== baseVersion) {
      // 后到内容：不覆盖，留冲突待裁决
      const conflict: QualificationConflict = {
        id: `QC-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
        welder, certNo, method, grade, validFrom, validTo,
        baseVersion, winnerVersion: current.version,
        arrivedAt: nowTime(), terminal, status: '待裁决',
      }
      return {
        ...state,
        conflicts: [conflict, ...state.conflicts],
        audit: [auditEntry('资质提交冲突', welder, `录入端 ${terminal} 提交的证书（${certNo}）基于旧版本 v${baseVersion}，现行版本为 v${current.version}；先到版本已生效，后到内容留冲突待裁决`), ...state.audit],
      }
    }

    // 先到生效：旧版本置为已失效，追加新版本
    const version = (current?.version ?? 0) + 1
    const newCert: Qualification = {
      id: `Q-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      welder, certNo, method, grade, validFrom, validTo, version, status: '现行',
    }
    const certs = [
      ...state.qualifications.map((q) => q.welder === welder ? { ...q, status: '已失效' as const } : q),
      newCert,
    ]
    const { plans, events } = recalcPlans(state.plans, state.welds, certs, nowTime())
    return {
      ...state,
      qualifications: certs,
      plans,
      version: state.version + 1,
      audit: [
        ...events,
        auditEntry('资质换证生效', welder, `证书 ${certNo} 按作业日生效（${validFrom} ~ ${validTo}），版本 v${version}；未完成计划已按计划当天日期重算`),
        ...state.audit,
      ],
    }
  }),

  on(A.resolveConflict, (state, { id, decision }) => {
    const conflict = state.conflicts.find((c) => c.id === id)
    if (!conflict || conflict.status !== '待裁决') return state

    if (decision === '驳回') {
      return {
        ...state,
        conflicts: state.conflicts.map((c) => c.id === id ? { ...c, status: '已驳回' as const } : c),
        audit: [auditEntry('资质冲突驳回', conflict.welder, `冲突证书 ${conflict.certNo} 已驳回，现行 v${conflict.winnerVersion} 保持不变`), ...state.audit],
      }
    }

    // 采纳：以冲突内容派生新版本生效，随后重算未完成计划
    const current = state.qualifications
      .filter((q) => q.welder === conflict.welder && q.status === '现行')
      .sort((a, b) => b.version - a.version)[0]
    const version = (current?.version ?? 0) + 1
    const newCert: Qualification = {
      id: `Q-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      welder: conflict.welder, certNo: conflict.certNo, method: conflict.method, grade: conflict.grade,
      validFrom: conflict.validFrom, validTo: conflict.validTo, version, status: '现行',
    }
    const certs = [
      ...state.qualifications.map((q) => q.welder === conflict.welder ? { ...q, status: '已失效' as const } : q),
      newCert,
    ]
    const { plans, events } = recalcPlans(state.plans, state.welds, certs, nowTime())
    return {
      ...state,
      qualifications: certs,
      plans,
      version: state.version + 1,
      conflicts: state.conflicts.map((c) => c.id === id ? { ...c, status: '已采纳' as const } : c),
      audit: [
        ...events,
        auditEntry('资质冲突采纳', conflict.welder, `冲突证书 ${conflict.certNo} 采纳为 v${version}（${conflict.validFrom} ~ ${conflict.validTo}），未完成计划已重算`),
        ...state.audit,
      ],
    }
  }),

  // ── 计划完成：冻结当天资质依据 ──────────────────────────────────
  on(A.completePlan, (state, { id }) => {
    const plan = state.plans.find((p) => p.id === id)
    if (!plan || plan.state === '已完成') return state
    const basis = buildBasis(plan, state.welds, state.qualifications)
    return {
      ...state,
      version: state.version + 1,
      plans: state.plans.map((p) => p.id === id ? { ...p, state: '已完成' as const, basis, completedAt: nowTime(), invalid: false, invalidWeldIds: [] } : p),
      audit: [auditEntry('检测计划完成', id, `结论已保留资质依据：${basis.map((b) => `${b.weldId}→${b.certNo}(v${state.qualifications.find((q) => q.id === b.certId)?.version ?? '?'})`).join('；')}，后续换证不追溯改写`), ...state.audit],
    }
  }),

  // ── 追溯包：按包号幂等导出，失败后按包号恢复 ────────────────────
  on(A.exportPackage, (state, { packageNo, simulateFailure }) => {
    const no = packageNo ?? packageNoFor(state.welds.map((w) => w.id), state.plans.map((p) => p.id), REFERENCE_DATE)
    const existing = state.packages.find((p) => p.packageNo === no)

    if (existing) {
      if (existing.status === '失败') {
        const snap = buildPackageSnapshot(state.welds, state.plans, state.audit.length)
        const recovered: TracePackage = { ...existing, status: '已恢复', attempts: existing.attempts + 1, error: undefined, recordCount: snap.recordCount, snapshotHash: snap.hash }
        return {
          ...state,
          packages: state.packages.map((p) => p.packageNo === no ? recovered : p),
          audit: [auditEntry('追溯包恢复', no, `失败后按包号恢复成功，复核记录 ${snap.recordCount} 条，哈希 ${snap.hash}`), ...state.audit],
        }
      }
      // 重复导出：包号已存在，不新增记录
      return {
        ...state,
        audit: [auditEntry('追溯包导出', no, `包号已存在（${existing.status}，${existing.recordCount} 条），重复导出未多出记录`), ...state.audit],
      }
    }

    if (simulateFailure) {
      const failed: TracePackage = {
        packageNo: no, createdAt: nowTime(), createdBy: '当前审核人',
        status: '失败', scope: { weldIds: state.welds.map((id) => id.id), planIds: state.plans.map((p) => p.id) },
        recordCount: 0, attempts: 1, error: '写入追溯包时哈希校验失败（模拟）', snapshotHash: '',
      }
      return {
        ...state,
        packages: [failed, ...state.packages],
        audit: [auditEntry('追溯包导出失败', no, '导出失败，记录为失败包；可按包号恢复，恢复不改变包号'), ...state.audit],
      }
    }

    const snap = buildPackageSnapshot(state.welds, state.plans, state.audit.length)
    const pkg: TracePackage = {
      packageNo: no, createdAt: nowTime(), createdBy: '当前审核人',
      status: '已生成', scope: { weldIds: state.welds.map((w) => w.id), planIds: state.plans.map((p) => p.id) },
      recordCount: snap.recordCount, attempts: 1, snapshotHash: snap.hash,
    }
    return {
      ...state,
      packages: [pkg, ...state.packages],
      audit: [auditEntry('追溯包导出', no, `生成成功，含焊缝、计划、缺陷、审计共 ${snap.recordCount} 条记录，哈希 ${snap.hash}`), ...state.audit],
    }
  }),

  on(A.recoverPackage, (state, { packageNo }) => {
    const existing = state.packages.find((p) => p.packageNo === packageNo)
    if (!existing) {
      return { ...state, audit: [auditEntry('追溯包恢复', packageNo, '未找到该包号，无法恢复；请核对包号后重试'), ...state.audit] }
    }
    if (existing.status !== '失败') {
      return { ...state, audit: [auditEntry('追溯包恢复', packageNo, `包状态为 ${existing.status}，无需恢复；重复操作未新增记录`), ...state.audit] }
    }
    const snap = buildPackageSnapshot(state.welds, state.plans, state.audit.length)
    return {
      ...state,
      packages: state.packages.map((p) => p.packageNo === packageNo ? { ...p, status: '已恢复' as const, attempts: p.attempts + 1, error: undefined, recordCount: snap.recordCount, snapshotHash: snap.hash } : p),
      audit: [auditEntry('追溯包恢复', packageNo, `按包号恢复成功，复核记录 ${snap.recordCount} 条，哈希 ${snap.hash}`), ...state.audit],
    }
  }),
)

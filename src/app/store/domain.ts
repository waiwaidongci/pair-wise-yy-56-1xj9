import type { InspectionPlan, PlanBasis, PlanInvalidWeld, Qualification, Weld } from '../types'

/** 演示基准作业日（与环境日期一致）：资质是否现行以这一天为准 */
export const REFERENCE_DATE = '2026-10-03'

export function dayDiff(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime()
}

/**
 * 按作业日取证书：同一焊工的全部版本中，覆盖该作业日（validFrom <= day <= validTo）
 * 且版本最高的一张。计划当天只看当天有效的证书，与证书是否已换证失效无关。
 */
export function certForDate(certs: Qualification[], welder: string, day: string): Qualification | undefined {
  return certs
    .filter((c) => c.welder === welder && dayDiff(day, c.validFrom) >= 0 && dayDiff(c.validTo, day) >= 0)
    .sort((a, b) => b.version - a.version)[0]
}

/** 焊工当前现行证书（版本最高且状态为现行） */
export function currentCert(certs: Qualification[], welder: string): Qualification | undefined {
  return certs
    .filter((c) => c.welder === welder && c.status === '现行')
    .sort((a, b) => b.version - a.version)[0]
}

export interface RecalcResult {
  invalid: boolean
  invalidWeldIds: PlanInvalidWeld[]
}

/**
 * 资质重算：未完成计划按计划日期逐焊缝核对当天有效证书。
 * 计划焊缝名册保留，仅把当天无有效证书的焊缝暂停（记入 invalidWeldIds），
 * 换证后重算可自动恢复；已完成计划不参与，结论依据冻结。
 */
export function recalculatePlan(plan: InspectionPlan, welds: Weld[], certs: Qualification[]): RecalcResult {
  const invalidWeldIds: PlanInvalidWeld[] = []
  for (const weldId of plan.weldIds) {
    const weld = welds.find((w) => w.id === weldId)
    if (!weld) continue
    const cert = certForDate(certs, weld.welder, plan.date)
    if (!cert) {
      invalidWeldIds.push({
        weldId,
        welder: weld.welder,
        reason: `计划当天 ${plan.date} 无有效证书（现行证书 ${currentCert(certs, weld.welder)?.validTo ?? '无'} 到期或未覆盖）`,
      })
    }
  }
  return { invalid: invalidWeldIds.length > 0, invalidWeldIds }
}

/** 完成计划时冻结依据：每条焊缝在计划日期当天使用的证书版本，后续换证不得改写 */
export function buildBasis(plan: InspectionPlan, welds: Weld[], certs: Qualification[]): PlanBasis[] {
  const basis: PlanBasis[] = []
  for (const weldId of plan.weldIds) {
    const weld = welds.find((w) => w.id === weldId)
    const cert = weld && certForDate(certs, weld.welder, plan.date)
    if (weld && cert) {
      basis.push({ weldId, welder: weld.welder, certId: cert.id, certNo: cert.certNo, validFrom: cert.validFrom, validTo: cert.validTo })
    }
  }
  return basis
}

/** 计划是否可完成：全部计划焊缝在计划当天均有有效证书 */
export function canComplete(plan: InspectionPlan, welds: Weld[], certs: Qualification[]): boolean {
  return plan.weldIds.every((id) => {
    const weld = welds.find((w) => w.id === id)
    return !!weld && !!certForDate(certs, weld.welder, plan.date)
  })
}

function hash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h.toString(36).toUpperCase().padStart(8, '0')
}

/** 追溯包号：由导出范围确定性派生，同范围重复导出得到同一包号（幂等键） */
export function packageNoFor(weldIds: string[], planIds: string[], day: string): string {
  const scope = [...weldIds, ...planIds].slice().sort().join('|')
  return `ZP-${day.replace(/-/g, '')}-${hash(scope)}`
}

export interface PackageSnapshot {
  hash: string
  recordCount: number
}

/** 追溯包内容快照：焊缝 + 计划 + 缺陷 + 审计事件，记录数确定性可复算 */
export function buildPackageSnapshot(welds: Weld[], plans: InspectionPlan[], auditCount: number): PackageSnapshot {
  const defects = welds.reduce((n, w) => n + w.defects.length, 0)
  const recordCount = welds.length + plans.length + defects + auditCount
  const hashSource = welds.map((w) => w.id).join(',') + '#' + plans.map((p) => p.id).join(',') + '#' + recordCount
  return { hash: hash(hashSource), recordCount }
}

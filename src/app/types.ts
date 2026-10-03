export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
  /** 资质重算后标记：计划当天存在无有效证书的焊缝 */
  invalid?: boolean
  /** 重算结果：计划当天无有效证书、被暂停的焊缝 */
  invalidWeldIds?: PlanInvalidWeld[]
  recalculatedAt?: string
  /** 完成时冻结的资质依据，后续换证不得追溯改写 */
  basis?: PlanBasis[]
  completedAt?: string
}

export interface PlanInvalidWeld {
  weldId: string
  welder: string
  reason: string
}

export interface PlanBasis {
  weldId: string
  welder: string
  certId: string
  certNo: string
  validFrom: string
  validTo: string
}

/** 焊工资质证书：同一焊工按版本连续，作业日只看当天有效的版本 */
export interface Qualification {
  id: string
  welder: string
  certNo: string
  method: string
  grade: string
  validFrom: string
  validTo: string
  /** 同一焊工内递增，从 1 开始；换证时旧版本置为已失效 */
  version: number
  status: '现行' | '已失效'
}

/** 资质提交冲突：两个录入端同基版本提交时，先到生效，后到留冲突 */
export interface QualificationConflict {
  id: string
  welder: string
  certNo: string
  method: string
  grade: string
  validFrom: string
  validTo: string
  /** 提交时依据的版本（乐观锁） */
  baseVersion: number
  /** 生效方版本 */
  winnerVersion: number
  arrivedAt: string
  terminal: string
  status: '待裁决' | '已采纳' | '已驳回'
}

export interface TracePackage {
  /** 包号：导出幂等键，重复导出不新增记录，失败后按包号恢复 */
  packageNo: string
  createdAt: string
  createdBy: string
  status: '已生成' | '失败' | '已恢复'
  scope: { weldIds: string[]; planIds: string[] }
  recordCount: number
  attempts: number
  error?: string
  snapshotHash: string
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

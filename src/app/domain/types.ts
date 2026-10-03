/**
 * 按作业日生效的焊工资质版本领域模型
 * --------------------------------
 * 核心约束：
 *  - 资质是「带生效日的版本链」，不是焊工身上的一个布尔标记；
 *  - 检测计划在执行日只看当天有效的证书版本；
 *  - 资质更新只令「未完成」计划失效重算，已完成结论永久保留当时依据；
 *  - 双端同时录入只放行先到版本，后到内容进冲突区不覆盖。
 */

/** 资质证书版本：同一个焊工可以有多条，按 effectiveFrom 形成版本链 */
export interface QualificationVersion {
  id: string
  welderId: string
  /** 证书编号，换证后编号可能变化 */
  certNo: string
  standard: string
  /** 允许的焊接方法，如 ['SMAW']；'*' 表示覆盖全部方法 */
  methods: string[]
  /** 作业日生效起点（含），YYYY-MM-DD */
  effectiveFrom: string
  /** 作业日失效终点（含，到期日当天仍可作业），YYYY-MM-DD；null 表示长期有效 */
  effectiveTo: string | null
  /** 录入端标识，用于双端并发冲突取证 */
  source: string
  /** 服务端单调序号，先到者小；并发裁决依据 */
  seq: number
  status: '生效' | '冲突搁置' | '作废'
}

/** 冲突记录：后到的同焊工新证书原文留存 */
export interface QualificationConflict {
  id: string
  welderId: string
  /** 后到版本内容快照（原文留存，不进有效版本链） */
  incoming: QualificationVersion
  /** 先到、已生效的版本 id */
  winnerId: string
  reason: string
  status: '待裁决' | '采纳' | '驳回'
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
}

export interface Welder {
  id: string
  name: string
  /** 现场临时焊工可能只留姓名，没有工号 */
  employeeNo?: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welderId: string
  welderName: string
  inspectionRatio: number
  requiredRatio: number
  status: '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'
  method: string
  report: string
}

/** 单条焊缝在计划日的资质判定依据（快照的原材料） */
export interface PlanBasisEntry {
  weldId: string
  welderId: string
  method: string
  /** 计划作业日当天命中的资质版本；null 即当天无有效证书 */
  qualificationId: string | null
  certNo: string | null
  valid: boolean
  reason: string
}

export type PlanState = '待执行' | '执行中' | '已完成'
/** 资质更新后未完成计划的生命周期标记 */
export type PlanLifecycle = '有效' | '已失效待重排'

export interface InspectionPlan {
  id: string
  /** 作业日，YYYY-MM-DD —— 资质按此日取版本 */
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: PlanState
  lifecycle: PlanLifecycle
  /** 最近一次计算/重算时间 */
  calculatedAt: string
  /** 已完成计划：完成时的判定依据永久保留 */
  basis?: PlanBasisEntry[]
  /** 已完成计划：完成时的资质版本链版本号（seq 上界），用于证明「原依据」 */
  basisQualSeq?: number
  /** 失效原因（哪本证书更新导致的） */
  invalidReason?: string
}

/** 追溯包：按包号恢复、重复导出幂等 */
export interface TracePackage {
  id: string
  createdAt: string
  createdBy: string
  /** 导出时纳入的计划 id 及结论依据 */
  planIds: string[]
  /** 包内容指纹：同一请求重复导出必须得到完全相同的记录集 */
  fingerprint: string
  recordCount: number
  status: '已导出' | '导出失败' | '已恢复'
  /** 失败/恢复流水 */
  attempts: TraceAttempt[]
  /** 幂等键：同一 (业务范围 + 时间点) 的重复请求命中同一包 */
  idempotencyKey: string
}

export interface TraceAttempt {
  at: string
  result: '成功' | '失败' | '恢复'
  detail: string
}

/** 资质更新事件：触发未完成计划失效重算的原因链 */
export interface QualificationChangeEvent {
  id: string
  at: string
  welderId: string
  qualificationId: string
  certNo: string
  source: string
  seq: number
  /** 换证时被置废的旧证书 id（补录/新增为空） */
  supersededQualificationId?: string
  /** 本次更新导致失效的计划 id */
  invalidatedPlanIds: string[]
}

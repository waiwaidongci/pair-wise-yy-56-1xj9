import { createAction, props } from '@ngrx/store'
import type { InspectionPlan, Qualification, QualificationConflict, TracePackage, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[]; qualifications: Qualification[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 录入端提交焊工新证书；baseVersion 为提交时依据的现行版本（乐观锁） */
export const submitQualification = createAction(
  '[Qualification] Submit',
  props<{ welder: string; certNo: string; method: string; grade: string; validFrom: string; validTo: string; baseVersion: number; terminal: string }>(),
)
/** 对后到的冲突内容裁决：采纳（生成新版本）或驳回 */
export const resolveConflict = createAction('[Qualification] Resolve Conflict', props<{ id: QualificationConflict['id']; decision: '采纳' | '驳回' }>())

/** 完成检测计划：冻结当天证书依据，结论不再随换证改写 */
export const completePlan = createAction('[Inspection] Complete Plan', props<{ id: string }>())

/** 导出质量追溯包；同一包号重复导出不新增记录，失败后按包号恢复 */
export const exportPackage = createAction('[Trace Package] Export', props<{ packageNo?: string; simulateFailure?: boolean }>())
/** 按包号恢复失败的追溯包 */
export const recoverPackage = createAction('[Trace Package] Recover', props<{ packageNo: string }>())

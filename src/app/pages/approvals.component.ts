import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { TableModule } from 'primeng/table'
import { InputTextModule } from 'primeng/inputtext'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,FormsModule,ButtonModule,TimelineModule,TagModule,TableModule,InputTextModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" (onClick)="export(false)" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>
      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。任何后续修改必须从当前版本派生新修订，不覆盖原始检测记录。</p></section>
      <section class="card mt-4"><h2 class="panel-title">质量追溯包（按包号幂等导出 · 失败后按包号恢复）</h2><div class="pkg-toolbar"><input pInputText [(ngModel)]="recoverNo" placeholder="输入包号恢复，如 ZP-20261003-XXXXXXXX" class="pkg-input" /><p-button label="导出追溯包" icon="pi pi-file-export" (onClick)="export(false)" /><p-button label="模拟导出失败" icon="pi pi-exclamation-triangle" severity="warn" (onClick)="export(true)" /><p-button label="按包号恢复" icon="pi pi-replay" severity="secondary" (onClick)="recover()" /></div><p-table [value]="state.packages" dataKey="packageNo" class="mt-3"><ng-template #emptymessage><tr><td colspan="7" class="muted">尚未导出追溯包。重复导出同一范围只返回同一包号，不会多出记录。</td></tr></ng-template><ng-template #header><tr><th>包号</th><th>生成时间</th><th>记录数</th><th>哈希</th><th>尝试</th><th>状态</th><th>操作</th></tr></ng-template><ng-template #body let-p><tr><td><b>{{p.packageNo}}</b></td><td>{{p.createdAt}}</td><td>{{p.recordCount}} 条</td><td>{{p.snapshotHash || '—'}}</td><td>{{p.attempts}} 次</td><td><p-tag [value]="p.status" [severity]="p.status === '已生成' ? 'success' : p.status === '已恢复' ? 'info' : 'danger'" /></td><td><p-button label="恢复" size="small" [disabled]="p.status !== '失败'" (onClick)="recover(p.packageNo)" /><p-button label="重新导出" size="small" text (onClick)="reExport(p.packageNo)" /></td></tr></ng-template></p-table><p class="muted mt-2">导出以包号为幂等键：同一包号重复导出不新增记录；失败包保留原包号，恢复后状态置为「已恢复」，记录数按当前台账复核重算。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.pkg-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pkg-input{min-width:320px}.mt-4{margin-top:16px}.mt-3{margin-top:12px}.mt-2{margin-top:8px}.muted{color:#7a8798;font-size:13px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  recoverNo = ''
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
  export(simulateFailure: boolean) { this.store.dispatch(A.exportPackage({ simulateFailure })) }
  recover(packageNo?: string) {
    const no = packageNo ?? this.recoverNo.trim()
    if (no) { this.store.dispatch(A.recoverPackage({ packageNo: no })) }
  }
  reExport(packageNo: string) { this.store.dispatch(A.exportPackage({ packageNo })) }
}

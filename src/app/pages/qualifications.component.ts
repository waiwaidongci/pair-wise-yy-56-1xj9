import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { WeldState } from '../store/weld.reducer'
import { currentCert } from '../store/domain'
import * as A from '../store/weld.actions'
import type { Qualification } from '../types'

interface CertForm { welder: string; certNo: string; method: string; grade: string; validFrom: string; validTo: string }

@Component({
  selector:'app-qualifications', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">焊工资质版本管理</p><h1>资质按作业日生效</h1><p>焊缝台账只留焊工姓名，资格按计划当天匹配证书版本。换证后未完成计划立即按计划日期重算，已完成结论保留原依据。</p></div><p-button label="新录证书" icon="pi pi-plus" (onClick)="openDialog()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">焊工证书版本链</h2><p-table [value]="welders" dataKey="welder"><ng-template #header><tr><th>焊工</th><th>现行证书</th><th>版本</th><th>有效期</th><th>状态</th></tr></ng-template><ng-template #body let-w><tr><td><b>{{w.welder}}</b><small class="block">{{w.method}} · {{w.grade}}</small></td><td>{{w.certNo}}</td><td>v{{w.version}}</td><td>{{w.validFrom}} ~ {{w.validTo}}</td><td><p-tag [value]="w.status" [severity]="w.status === '现行' ? 'success' : 'info'" /></td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">版本规则</h2><div class="rule"><p>① 同一焊工换证时旧版本置为已失效，作业日（计划日期）当天只看当天有效的版本。</p><p>② 资质一更新，未完成计划立即重算：计划当天无有效证书的焊缝暂停执行，计划标记失效。</p><p>③ 计划完成时冻结资质依据（证书编号、版本、有效期），后续换证不追溯改写已完成结论。</p><p>④ 两个录入端基于同一版本同时提交：先到版本生效，后到内容留冲突，不覆盖、不丢失。</p></div></aside></div>
      <section class="card mt-4"><h2 class="panel-title">提交冲突队列（先到生效 · 后到留冲突）</h2><p-table [value]="state.conflicts" dataKey="id"><ng-template #emptymessage><tr><td colspan="6" class="muted">暂无冲突。可在新录证书时点击「模拟两端同时提交」演示并发场景。</td></tr></ng-template><ng-template #header><tr><th>冲突编号</th><th>焊工</th><th>提交内容</th><th>依据版本</th><th>到达时间 / 终端</th><th>状态</th><th>裁决</th></tr></ng-template><ng-template #body let-c><tr><td>{{c.id}}</td><td><b>{{c.welder}}</b></td><td>{{c.certNo}}<small class="block">{{c.method}} · {{c.grade}} · {{c.validFrom}} ~ {{c.validTo}}</small></td><td>v{{c.baseVersion}}<small class="block">现行 v{{c.winnerVersion}} 已生效</small></td><td>{{c.arrivedAt}}<small class="block">{{c.terminal}}</small></td><td><p-tag [value]="c.status" [severity]="c.status === '待裁决' ? 'warn' : c.status === '已采纳' ? 'success' : 'danger'" /></td><td><p-button label="采纳" size="small" class="mr-2" [disabled]="c.status !== '待裁决'" (onClick)="resolve(c.id,'采纳')" /><p-button label="驳回" size="small" severity="danger" text [disabled]="c.status !== '待裁决'" (onClick)="resolve(c.id,'驳回')" /></td></tr></ng-template></p-table></section>
      <p-dialog header="新录焊工资质证书" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊工姓名（台账只留姓名）</label><select [(ngModel)]="form.welder"><option *ngFor="let w of welderNames" [value]="w">{{w}}</option></select><label>证书编号</label><input pInputText [(ngModel)]="form.certNo" /><label>焊接方法 / 资质项目</label><div class="grid-2col"><input pInputText [(ngModel)]="form.method" placeholder="如 SMAW" /><input pInputText [(ngModel)]="form.grade" placeholder="如 角焊缝 · 平焊" /></div><label>有效期起 / 止</label><div class="grid-2col"><input pInputText type="date" [(ngModel)]="form.validFrom" /><input pInputText type="date" [(ngModel)]="form.validTo" /></div><p class="muted">提交时携带现行版本 v{{ baseVersion }} 作为乐观锁依据：与服务端一致才生效，否则后到内容进入冲突队列。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交证书（录入端 A）" icon="pi pi-send" (onClick)="submit('录入端-A')" /><p-button label="模拟录入端 B 同时提交" icon="pi pi-users" severity="help" (onClick)="submitBoth()" /></ng-template></p-dialog>
    </main>
  `,
  styles: ['.block{display:block;color:#7a8798;margin-top:3px}.rule p{margin:8px 0;font-size:13px;line-height:1.7}.form{display:grid;gap:9px}.form input,.form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.grid-2col{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mt-4{margin-top:16px}.mr-2{margin-right:8px}.muted{color:#7a8798;font-size:13px}'],
})
export class QualificationsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  dialog = false
  form: CertForm = { welder:'孙鹏', certNo:'GB/T 9448', method:'SMAW', grade:'角焊缝 · 立焊', validFrom:'2026-10-02', validTo:'2027-10-01' }
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }

  get welderNames(): string[] {
    return Array.from(new Set(this.state.welds.map((w) => w.welder)))
  }
  /** 证书版本链：每个焊工按版本倒序展示 */
  get welders(): (Qualification & { welder: string })[] {
    return this.state.qualifications.slice().sort((a, b) => a.welder.localeCompare(b.welder, 'zh') || b.version - a.version)
  }
  get baseVersion(): number {
    return currentCert(this.state.qualifications, this.form.welder)?.version ?? 0
  }

  openDialog() { this.dialog = true }

  submit(terminal: string) {
    const baseVersion = this.baseVersion
    this.store.dispatch(A.submitQualification({ ...this.form, baseVersion, terminal }))
    this.dialog = false
  }
  /** 两个录入端基于同一版本同时提交：A 先到生效，B 后到留冲突 */
  submitBoth() {
    const baseVersion = this.baseVersion
    const payload = { ...this.form, baseVersion }
    this.store.dispatch(A.submitQualification({ ...payload, terminal:'录入端-A' }))
    this.store.dispatch(A.submitQualification({ ...payload, terminal:'录入端-B', certNo: payload.certNo + '（补录）' }))
    this.dialog = false
  }
  resolve(id: string, decision: '采纳' | '驳回') { this.store.dispatch(A.resolveConflict({ id, decision })) }
}

import { inject, Injectable } from '@angular/core'
import { Apollo, gql } from 'apollo-angular'
import { map } from 'rxjs'
import type { InspectionPlan, Qualification, Weld } from '../types'

const WELDS_QUERY = gql`query Welds { welds { id drawing component joint method welder qualification qualificationValid inspectionRatio requiredRatio status x y repairs defects { id position type length level method report } } qualifications { id welder certNo method grade validFrom validTo version status } plans { id date method weldIds inspector state invalid invalidWeldIds { weldId welder reason } recalculatedAt basis { weldId welder certId certNo validFrom validTo } completedAt } }`

@Injectable({ providedIn: 'root' })
export class WeldGraphqlService {
  private readonly apollo = inject(Apollo)
  load() {
    return this.apollo.watchQuery<{ welds: Weld[]; plans: InspectionPlan[]; qualifications: Qualification[] }>({ query: WELDS_QUERY, fetchPolicy: 'cache-first' }).valueChanges.pipe(map((result) => result.data))
  }
}

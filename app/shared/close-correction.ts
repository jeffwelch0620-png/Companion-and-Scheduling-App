import type { Member, RecordOf } from './types';

export function correctionPerformer(close:RecordOf<'close'>){return close.data.correction?.personId??close.ownerId;}
export function eligibleCorrectionHelper(close:RecordOf<'close'>,person:Member){
  return person.locationId===close.locationId&&person.area===close.area&&person.position!=='Dishwasher'&&person.qualifications.includes(close.data.standard.position)&&person.id!==close.data.managerId&&person.id!==close.data.verifierId;
}

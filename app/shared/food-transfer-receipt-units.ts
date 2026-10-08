import {packAmount} from './food-model';
import type {TransferDispatch} from './food-transfer';
import type {TransferItemMatch} from './food-transfer-match';
import {requireThat} from './validation';

export type ReceiptQuantitySource={basis:'destination';item:TransferItemMatch['item'];matchAt:string;destinationUnitsPerDispatchUnit:number;accepted:number;rejected:number;missing:number};
const quantity=(v:unknown)=>{requireThat((typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1000000,'Enter each delivery quantity from zero to 1,000,000.');return Number(v)};
export function receiptUnitQuantities(input:Record<string,unknown>,dispatch:TransferDispatch,match?:TransferItemMatch|null){
 const basis=input.quantityBasis??'dispatch';requireThat(basis==='dispatch'||basis==='destination','Choose original dispatch or checked destination units.');
 const entered={accepted:quantity(input.accepted),rejected:quantity(input.rejected),missing:quantity(input.missing)};
 if(basis==='dispatch')return {...entered,quantitySource:undefined};
 requireThat(match,'A current reviewed destination item match is required for destination units.',409);
 const original=packAmount(dispatch.item.pack),destination=packAmount(match.item.pack),ratio=match.destinationUnitsPerDispatchUnit;
 requireThat(original&&destination&&original.family===destination.family&&Number.isFinite(ratio)&&ratio>0&&ratio===original.value/destination.value,'The saved destination pack conversion needs review.',409);
 const normalized={accepted:entered.accepted/ratio,rejected:entered.rejected/ratio,missing:entered.missing/ratio};
 for(const key of ['accepted','rejected','missing'] as const)requireThat(Number.isFinite(normalized[key])&&normalized[key]>=0&&normalized[key]<=1000000&&(entered[key]===0||normalized[key]>0),'Converted quantities are outside the supported range. Review the original units.');
 const quantitySource:ReceiptQuantitySource={basis:'destination',item:structuredClone(match.item),matchAt:match.at,destinationUnitsPerDispatchUnit:ratio,...entered};
 return {...normalized,quantitySource};
}

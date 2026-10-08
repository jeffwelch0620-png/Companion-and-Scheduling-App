import {object,requireThat,text} from './validation';
export type CateringMenuLine={item:string;quantity:number;unit:string;reference:string;notes:string};
export function cateringMenuLines(input:unknown):CateringMenuLine[]{
 requireThat(Array.isArray(input)&&input.length<=40,'Record at most 40 menu lines.');
 return input.map((value,i)=>{const row=object(value),n=i+1,q=row.quantity;
  requireThat(typeof q==='number'&&Number.isFinite(q)&&q>0&&q<=100000&&Math.abs(q*1000-Math.round(q*1000))<0.000001,`Menu line ${n}: enter a quantity above zero, at most 100,000, with up to three decimal places.`);
  return {item:text(row.item,`Menu line ${n} item`,200),quantity:Math.round(q*1000)/1000,unit:text(row.unit,`Menu line ${n} unit`,40),reference:text(row.reference??'',`Menu line ${n} reference`,500,true),notes:text(row.notes??'',`Menu line ${n} notes`,500,true)};
 });
}

// Owner-confirmed Back Window references. Container capacity counts portion cups;
// the 3.25 oz label is the cup size, not a claim about dressing volume or yield.
export const backWindowItems = [
 {id:'ranch',title:'Ranch',cupSizeOz:3.25,referenceContainer:'deep-half',referencePans:2,referenceParCups:100},
 {id:'honey-mustard',title:'Honey mustard',cupSizeOz:3.25,referenceContainer:'deep-half',referencePans:1,referenceParCups:50},
 {id:'brown-sugar',title:'Brown sugar',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
 {id:'french',title:'French',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
 {id:'italian',title:'Italian',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
 {id:'thousand-island',title:'Thousand Island',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
 {id:'coleslaw',title:'Coleslaw',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
 {id:'tartar',title:'Tartar',cupSizeOz:3.25,referenceContainer:'sixth',referencePans:1,referenceParCups:15},
] as const;
export type BackWindowItemId=typeof backWindowItems[number]['id'];
export type BackWindowContainer='deep-half'|'sixth';
export const backWindowContainerCups:Readonly<Record<BackWindowContainer,number>>={'deep-half':50,sixth:15};
type Review={status:'needs-review';reasons:string[]};
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;

export type BackWindowCountInput={container:BackWindowContainer;fullPans:number|null;partialPanFraction:number|null};
/** Partial fraction describes one additional pan, after any full pans. A known
 * absence of an additional partial pan must be entered as zero, not null. */
export function estimateBackWindowCups(input:BackWindowCountInput):Review|{status:'ready';usableCups:number;estimated:true;container:BackWindowContainer}{
 const reasons:string[]=[];
 if(!Object.hasOwn(backWindowContainerCups,input.container))reasons.push('Choose a recognized portion-cup storage pan.');
 if(!nonnegative(input.fullPans)||!Number.isSafeInteger(input.fullPans))reasons.push('Enter the number of full pans, including zero.');
 if(!nonnegative(input.partialPanFraction)||input.partialPanFraction>1)reasons.push('Enter the additional partial pan fraction from zero to one.');
 if(reasons.length)return {status:'needs-review',reasons};
 const usableCups=(input.fullPans!+input.partialPanFraction!)*backWindowContainerCups[input.container];
 if(!Number.isFinite(usableCups)||usableCups>Number.MAX_SAFE_INTEGER)return {status:'needs-review',reasons:['The estimated cup count is too large. Review the pan count.']};
 return {status:'ready',usableCups,estimated:true,container:input.container};
}

export type BackWindowPrepInput={itemId:BackWindowItemId;forecastUsageCups:number|null;bufferCups:number|null;usableCups:number|null;minimumPracticalBatchCups?:number|null};
export type BackWindowPrepResult=Review|{status:'ready';itemId:BackWindowItemId;cupSizeOz:3.25;referenceParCups:number;forecastUsageCups:number;bufferCups:number;usableCups:number;neededCups:number;recommendedCups:number;minimumPracticalBatchCups:number|null};
/** Forecast usage must cover the period until the next portioning opportunity.
 * Reference pars are displayed for context and never used as automatic targets.
 * This pure recommendation neither completes prep nor posts inventory. */
export function planBackWindowPrep(input:BackWindowPrepInput):BackWindowPrepResult{
 const item=backWindowItems.find(i=>i.id===input.itemId),reasons:string[]=[];
 if(!item)reasons.push('Choose a recognized Back Window item.');
 if(!nonnegative(input.forecastUsageCups))reasons.push('Enter forecast cup usage until the next prep, including zero.');
 if(!nonnegative(input.bufferCups))reasons.push('Enter an explicit buffer in cups, including zero.');
 if(!nonnegative(input.usableCups))reasons.push('Enter usable portion cups on hand, including zero.');
 const minimum=input.minimumPracticalBatchCups;
 if(minimum!==undefined&&(!nonnegative(minimum)||!Number.isSafeInteger(minimum)||minimum<=0))reasons.push('A configured minimum practical batch must be an explicit positive whole number of cups.');
 if(reasons.length)return {status:'needs-review',reasons};
 const target=input.forecastUsageCups!+input.bufferCups!;
 if(!Number.isSafeInteger(Math.ceil(target)))return {status:'needs-review',reasons:['Forecast usage and buffer total is too large. Review the quantities.']};
 const neededCups=Math.ceil(Math.max(0,target-input.usableCups!));
 const recommendedCups=neededCups>0&&minimum!==undefined?Math.max(neededCups,minimum!):neededCups;
 return {status:'ready',itemId:item!.id,cupSizeOz:item!.cupSizeOz,referenceParCups:item!.referenceParCups,forecastUsageCups:input.forecastUsageCups!,bufferCups:input.bufferCups!,usableCups:input.usableCups!,neededCups,recommendedCups,minimumPracticalBatchCups:minimum??null};
}

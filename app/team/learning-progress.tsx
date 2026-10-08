export function LearningProgress({count,total,label='practiced'}:{count:number;total:number;label?:string}) {
 return <div className="learning-progress"><div><strong>{count} <span>/ {total}</span></strong><span>{label}</span></div><progress max={Math.max(total,1)} value={count} aria-label={`${count} of ${total} ${label}`}/></div>;
}

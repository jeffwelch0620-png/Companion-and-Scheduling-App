'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { WorkspaceIcon } from './workspace-icon';

export function ActionMenu({label,children}:{label:string;children:ReactNode}) {
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(e:PointerEvent)=>{if(ref.current?.open&&e.target instanceof Node&&!ref.current.contains(e.target))ref.current.open=false};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 return <details className="compact-actions" ref={ref} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false}} onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}} onClick={e=>{if((e.target as HTMLElement).closest('button')&&ref.current)ref.current.open=false}}><summary aria-label={label}><WorkspaceIcon name="More"/></summary><div>{children}</div></details>;
}

'use client';

/* eslint-disable @next/next/no-img-element */
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Scene, SceneNode} from '../../lib/visual-remix';
import {hitTest, resizeRotatedBox, dragNode, REMIX_FONTS, type HandleType} from '../../lib/visual-remix-canvas';

type Props = {
  scene: Scene; committedScene: Scene; committedPngUrl: string | null; selectedId: string;
  resetKey: string; ready: boolean; pending: boolean;
  onSelect: (id: string) => void;
  onCommit: (scene: Scene, id: string) => void;
  onCancel: (id: string) => void; onStage: (id: string) => string;
  onCenterNode: (axis: 'x' | 'y') => void;
};
type Gesture = {id:string; pointer:number; node:SceneNode; scene:Scene; x:number; y:number; handle:HandleType | 'drag'; moved:boolean; staged:boolean};
type TextEdit = {id:string; node:Extract<SceneNode,{type:'text'}>; scene:Scene; value:string; composing:boolean; blurred:boolean};
const handles = ['nw','n','ne','e','se','s','sw','w'] as const;

// Only interaction bounds are drawn here. Committed typography/raster output stays
// in the authoritative Konva PNG; there is no second text layout engine.
export function EditableCanvas(props:Props) {
  const [zoom,setZoom]=useState<'fit'|'100%'>('fit');
  const [transient,setTransient]=useState<SceneNode|null>(null);
  const [editing,setEditing]=useState<TextEdit|null>(null);
  const [scale,setScale]=useState(1);
  const container=useRef<HTMLDivElement>(null), textarea=useRef<HTMLTextAreaElement>(null);
  const gesture=useRef<Gesture|null>(null), transientRef=useRef<SceneNode|null>(null), text=useRef<TextEdit|null>(null);
  const latest=useRef(props);
  const enabled=props.ready && !props.pending;
  const node=transient ?? props.scene.nodes.find(n=>n.id===props.selectedId);
  function point(clientX:number,clientY:number) {
    const r=container.current!.getBoundingClientRect();
    return {x:(clientX-r.left)/r.width*1080,y:(clientY-r.top)/r.height*1440};
  }
  function show(n:SceneNode|null){transientRef.current=n;setTransient(n);}
  function finishText(cancel=false){
    const t=text.current;if(!t || (!cancel && t.composing))return;
    text.current=null;setEditing(null);
    if(cancel || t.value===t.node.text)latest.current.onCancel(t.id);
    else latest.current.onCommit({...t.scene,nodes:t.scene.nodes.map(n=>n.id===t.node.id?{...n,text:t.value} as SceneNode:n)},t.id);
  }
  function start(clientX:number,clientY:number,pointer:number,handle:HandleType|'drag'='drag'){
    if(!enabled || gesture.current || text.current)return false;
    const p=point(clientX,clientY),n=handle==='drag'?hitTest(p.x,p.y,props.scene.nodes):node;
    if(!n){props.onSelect('');return false;}
    props.onSelect(n.id);
    const id=crypto.randomUUID();
    gesture.current={id,pointer,node:structuredClone(n),scene:structuredClone(props.scene),x:p.x,y:p.y,handle,moved:false,staged:false};
    show(n);return true;
  }
  const actions=useRef<{point:typeof point;show:typeof show;finishText:typeof finishText}|null>(null);
  useLayoutEffect(()=>{latest.current=props;actions.current={point,show,finishText};});
  const isEditing=!!editing;
  useEffect(()=>{
    const element=container.current!;
    const observer=new ResizeObserver(()=>setScale(element.getBoundingClientRect().width/1080));
    observer.observe(element);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(isEditing)textarea.current?.focus();
  },[isEditing]); // Focus once, never interrupt IME/caret on each input.
  useEffect(()=>{
    // Controller lifecycle changes (reopen/history/commit/revoke) own authority.
    // Drop transient UI without discarding a newer controller ticket.
    gesture.current=null;text.current=null;transientRef.current=null;
    // Authority changed outside this component; reset its transient interaction state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTransient(null);setEditing(null);
  },[props.resetKey]);
  useEffect(()=>{
    const g=gesture.current;
    if(g && g.node.id!==props.selectedId){gesture.current=null;actions.current!.show(null);latest.current.onCancel(g.id);}
    if(text.current && text.current.node.id!==props.selectedId)actions.current!.finishText(true);
  },[props.selectedId]);
  useEffect(()=>{
    function cancel(){
      const g=gesture.current;gesture.current=null;actions.current!.show(null);
      if(g)latest.current.onCancel(g.id);
    }
    function move(e:PointerEvent){
      const g=gesture.current;if(!g || e.pointerId!==g.pointer)return;
      e.preventDefault();const p=actions.current!.point(e.clientX,e.clientY);
      if(Math.hypot(p.x-g.x,p.y-g.y)>1)g.moved=true;
      if(!g.moved)return;
      if(!g.staged){if(!latest.current.onStage(g.id)){gesture.current=null;actions.current!.show(null);return;}g.staged=true;}
      const patch=g.handle==='drag'?dragNode(g.node,p.x-g.x,p.y-g.y):resizeRotatedBox(g.handle,g.node,p.x,p.y);
      actions.current!.show({...g.node,...patch});
    }
    function up(e:PointerEvent){
      const g=gesture.current;if(!g || e.pointerId!==g.pointer)return;
      const n=transientRef.current;gesture.current=null;actions.current!.show(null);
      if(g.moved && n && JSON.stringify(n)!==JSON.stringify(g.node))latest.current.onCommit({...g.scene,nodes:g.scene.nodes.map(old=>old.id===n.id?n:old)},g.id);
      else latest.current.onCancel(g.id);
    }
    function pointerCancel(e:PointerEvent){if(gesture.current?.pointer===e.pointerId)cancel();}
    function key(e:KeyboardEvent){
      if(e.key!=='Escape' || e.isComposing)return;
      if(text.current){if(!text.current.composing){e.preventDefault();actions.current!.finishText(true);}}
      else if(gesture.current){e.preventDefault();cancel();}
    }
    function blur(){cancel();if(text.current){text.current.blurred=true;if(!text.current.composing)actions.current!.finishText();}}
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',pointerCancel);window.addEventListener('keydown',key);window.addEventListener('blur',blur);
    return ()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',pointerCancel);window.removeEventListener('keydown',key);window.removeEventListener('blur',blur);};
  },[]);
  return <div className="w-full min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs" data-testid="canvas-toolbar">
      <div className="flex gap-1">{(['fit','100%'] as const).map(z=><button key={z} type="button" aria-pressed={zoom===z} className="rounded border px-3 py-1.5" disabled={!!editing||!!transient} onClick={()=>setZoom(z)}>{z==='fit'?'Fit':z}</button>)}</div>
      <span className="text-zinc-500">Click to select · double-click text to edit</span>
    </div>
    <div className={zoom==='100%'?'max-h-[75vh] w-full overflow-auto rounded-xl bg-zinc-100 p-2':'flex w-full justify-center'}>
      <div ref={container} data-testid="editable-canvas-container" className="relative shrink-0 select-none bg-white shadow-sm"
        style={{width:zoom==='100%'?1080:'min(100%, 56.25vh)',aspectRatio:'3 / 4',overflow:'visible',background:props.scene.background}}>
        {props.committedPngUrl?<img src={props.committedPngUrl} alt="Applied image" draggable={false} className="block h-full w-full pointer-events-none"/>:<div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Your applied scene appears here.</div>}
        <svg data-testid="editable-canvas" viewBox="0 0 1080 1440" className="absolute inset-0 h-full w-full" style={{touchAction:'none',overflow:'visible'}}
          onPointerDown={e=>{if(e.button!==0 || text.current)return;e.preventDefault();if(start(e.clientX,e.clientY,e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);}}
          onDoubleClick={e=>{
            if(!enabled || text.current)return;const p=point(e.clientX,e.clientY),n=hitTest(p.x,p.y,props.scene.nodes);
            if(n?.type!=='text')return;props.onSelect(n.id);const id=crypto.randomUUID();if(!props.onStage(id))return;
            const t={id,node:n,scene:structuredClone(props.scene),value:n.text,composing:false,blurred:false};text.current=t;setEditing({...t});
          }}>
          {node && !editing && <g transform={`translate(${node.x} ${node.y}) rotate(${node.rotation})`}>
            <rect width={node.width} height={node.height} fill={transient?'#2563eb12':'none'} stroke="#2563eb" strokeWidth={1.5/scale} pointerEvents="none"/>
            {handles.map(h=>{
              const x=h.includes('w')?0:h.includes('e')?node.width:node.width/2;
              const y=h.includes('n')?0:h.includes('s')?node.height:node.height/2;
              const size=9/scale;
              return <rect key={h} data-testid={`resize-${h}`} x={x-size/2} y={y-size/2} width={size} height={size} fill="white" stroke="#2563eb" strokeWidth={1/scale} style={{cursor:`${h}-resize`}}
                onPointerDown={e=>{e.stopPropagation();e.preventDefault();if(e.button===0 && start(e.clientX,e.clientY,e.pointerId,h))e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);}}/>;
            })}
          </g>}
        </svg>
        {editing && <div style={{position:'absolute',left:editing.node.x*scale,top:editing.node.y*scale,width:editing.node.width*scale,transform:`rotate(${editing.node.rotation}deg)`,transformOrigin:'0 0'}} onPointerDown={e=>e.stopPropagation()}>
          <textarea ref={textarea} aria-label="Edit canvas text" value={editing.value} maxLength={20000}
            style={{display:'block',width:'100%',minHeight:editing.node.height*scale,fontFamily:REMIX_FONTS[editing.node.font],fontSize:editing.node.fontSize*scale,fontWeight:editing.node.fontWeight,lineHeight:editing.node.lineHeight,textAlign:editing.node.align,color:editing.node.fill,padding:0,resize:'none',outline:'2px solid #2563eb',background:'white'}}
            onChange={e=>{if(text.current){text.current.value=e.target.value;setEditing({...text.current});}}}
            onCompositionStart={()=>{if(text.current){text.current.composing=true;setEditing({...text.current});}}}
            onCompositionEnd={e=>{if(text.current){text.current.value=e.currentTarget.value;text.current.composing=false;if(text.current.blurred)finishText();else setEditing({...text.current});}}}
            onKeyDown={e=>{if(e.nativeEvent.isComposing||text.current?.composing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finishText(true);}else if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();finishText();}}}
            onBlur={()=>{if(text.current){text.current.blurred=true;if(!text.current.composing)finishText();}}}/>
          <div className="mt-1 flex gap-1 text-xs">{['Done','Cancel'] .map(label=><button key={label} type="button" className="rounded border bg-white px-2 py-1" disabled={editing.composing} onMouseDown={e=>e.preventDefault()} onClick={()=>finishText(label==='Cancel')}>{label}</button>)}</div>
        </div>}
      </div>
    </div>
  </div>;
}

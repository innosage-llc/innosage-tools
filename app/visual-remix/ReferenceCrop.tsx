"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cropRaster, type RasterCrop } from "@/lib/visual-remix-assets";
import type { RasterAsset } from "@/lib/visual-remix";

// Selection and preview are local only. Explicit approval passes a newly encoded
// tight PNG, never a reference URL or the full reference's bytes, to the editor.
export function ReferenceCrop({ source, url, descriptor, disabled, approve }: {
  source: Blob; url: string; descriptor: RasterAsset; disabled: boolean;
  approve: (blob: Blob, crop: RasterCrop, kind: string) => Promise<void>;
}) {
  const [crop, setCrop] = useState<RasterCrop>({ x: 0, y: 0, width: Math.min(96,descriptor.width), height: Math.min(96,descriptor.height) });
  const [kind, setKind] = useState("portrait");
  const [preview, setPreview] = useState<{blob:Blob;url:string;crop:RasterCrop} | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const origin = useRef<{x:number;y:number} | null>(null), pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if(preview) URL.revokeObjectURL(preview.url); }, [preview]);
  function update(value: RasterCrop) { pending.current?.abort(); setBusy(false);setCrop(value);setPreview(null);setError(""); }
  function point(event:PointerEvent<HTMLDivElement>) {
    const bounds=event.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(descriptor.width,Math.round((event.clientX-bounds.left)*descriptor.width/bounds.width))),y:Math.max(0,Math.min(descriptor.height,Math.round((event.clientY-bounds.top)*descriptor.height/bounds.height)))};
  }
  async function prepare() {
    pending.current?.abort();const abort=new AbortController();pending.current=abort;setBusy(true);setError("");
    try { const blob=await cropRaster(source,crop,abort.signal);abort.signal.throwIfAborted();setPreview({blob,url:URL.createObjectURL(blob),crop:{...crop}}); }
    catch(e) {if(!abort.signal.aborted)setError(e instanceof Error ? e.message : "Crop failed");}
    finally {if(pending.current===abort)setBusy(false);}
  }
  return <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3">
    <h3 className="font-semibold">Extract a photo or logo from the reference</h3>
    <p>Drag a tight rectangle, or enter original-image pixel coordinates. Preview, then explicitly approve only those pixels. Keep text editable; do not crop the whole design.</p>
    <div role="group" aria-label="Select reference crop" className="relative max-w-64 touch-none select-none overflow-hidden border border-zinc-300"
      onPointerDown={e=>{if(disabled||busy)return;e.currentTarget.setPointerCapture(e.pointerId);origin.current=point(e);update({...origin.current,width:1,height:1});}}
      onPointerMove={e=>{if(!origin.current)return;const end=point(e),start=origin.current;update({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.max(1,Math.abs(end.x-start.x)),height:Math.max(1,Math.abs(end.y-start.y))});}}
      onPointerUp={()=>{origin.current=null;}} onPointerCancel={()=>{origin.current=null;}}>
      <img src={url} alt="Reference crop selection" draggable={false} className="block w-full" />
      <div aria-hidden="true" className="pointer-events-none absolute border-2 border-orange-600 bg-orange-400/20" style={{left:`${crop.x/descriptor.width*100}%`,top:`${crop.y/descriptor.height*100}%`,width:`${crop.width/descriptor.width*100}%`,height:`${crop.height/descriptor.height*100}%`}} />
    </div>
    <div className="grid grid-cols-2 gap-2">{(["x","y","width","height"] as const).map(key=><label key={key}>Crop {key}<input aria-label={`Crop ${key}`} className="w-full rounded border p-1" type="number" step="1" min={key==="x"||key==="y"?0:1} max={key==="x"||key==="width"?descriptor.width:descriptor.height} disabled={disabled||busy} value={crop[key]} onChange={e=>update({...crop,[key]:Number(e.target.value)})}/></label>)}</div>
    <label className="block">Asset purpose<select aria-label="Crop purpose" className="ml-2 rounded border p-1" value={kind} onChange={e=>setKind(e.target.value)}><option value="portrait">Portrait</option><option value="logo">Logo</option><option value="detail">Other detail</option></select></label>
    <button type="button" className="rounded border px-3 py-2" disabled={disabled||busy} onClick={()=>void prepare()}>Preview crop</button>
    {error&&<p role="alert" className="text-red-800">{error}. Choose a rectangle inside the image.</p>}
    {preview&&<div className="space-y-2"><img src={preview.url} alt="Crop pixels to approve" className="max-h-40 max-w-full border bg-zinc-100 object-contain"/><p>{preview.crop.width}×{preview.crop.height} PNG. Only this crop will be embedded when used in a saved Scene. Pixels stay in this browser.</p><button type="button" className="rounded border border-zinc-900 px-3 py-2 font-semibold" disabled={disabled||busy} onClick={()=>void approve(preview.blob,preview.crop,kind)}>Approve crop and preview placement</button></div>}
  </div>;
}

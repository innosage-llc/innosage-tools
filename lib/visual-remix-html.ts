import { parseScene, REMIX_LIMITS, type Scene } from './visual-remix.ts';
import { LocalAssets, cropRaster } from './visual-remix-assets.ts';
import { REMIX_FONTS } from './visual-remix-renderer.ts';

const escape = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\r/g,'&#13;');
async function dataURL(blob: Blob, signal: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); signal.throwIfAborted();
  let binary = '';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:'+blob.type+';base64,'+btoa(binary);
}

// Local document only. No project identity, provenance, captions, unused assets,
// reference Blob, executable markup, network dependency or destination upload.
export async function exportSceneHTML(input: Scene, assets: LocalAssets, signal: AbortSignal): Promise<string> {
  const scene=parseScene(input), layers:string[]=[];
  for(const node of scene.nodes){
    signal.throwIfAborted();
    let style='position:absolute;left:'+node.x+'px;top:'+node.y+'px;width:'+node.width+'px;height:'+node.height+'px;transform:rotate('+node.rotation+'deg);transform-origin:0 0;opacity:'+node.opacity+';';
    const id=' data-layer-id="'+escape(node.id)+'"';
    if(node.type==='text'){
      style+='font-family:'+REMIX_FONTS[node.font]+';font-size:'+node.fontSize+'px;font-weight:'+node.fontWeight+';line-height:'+node.lineHeight+';text-align:'+node.align+';color:'+node.fill+';white-space:pre-wrap;overflow-wrap:anywhere;word-break:'+(node.wrap==='char'?'break-all':'normal')+';overflow:hidden;';
      layers.push('<div'+id+' style="'+escape(style)+'">'+escape(node.text)+'</div>');
    }else if(node.type==='rect'||node.type==='ellipse'){
      style+='background:'+node.fill+';border-radius:'+(node.type==='ellipse'?'50%':node.cornerRadius+'px')+';';
      layers.push('<div'+id+' style="'+escape(style)+'"></div>');
    }else if(node.type==='image'){
      const descriptor=scene.assets.find(asset=>asset.id===node.assetId)!;
      const original=assets.blob(descriptor), crop=node.crop;
      // A CSS crop would embed hidden source pixels. Materialize only the
      // intended crop, and reject fractional bounds rather than resample silently.
      const full=crop.x===0&&crop.y===0&&crop.width===descriptor.width&&crop.height===descriptor.height;
      if(!full && ![crop.x,crop.y,crop.width,crop.height].every(Number.isSafeInteger))throw new Error('HTML_FRACTIONAL_CROP_UNSUPPORTED: '+node.id);
      const image=full?new Blob([original],{type:descriptor.mime}):await cropRaster(original,crop,signal);
      layers.push('<img'+id+' alt="" src="'+await dataURL(image,signal)+'" style="'+escape(style+'display:block;object-fit:fill;image-orientation:none;')+'">');
    }else{
      throw new Error('HTML_UNSUPPORTED_LAYER');
    }
    if(layers.reduce((size,layer)=>size+layer.length,0)>REMIX_LIMITS.projectBytes)throw new Error('HTML_EXPORT_TOO_LARGE');
  }
  signal.throwIfAborted();
  const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; font-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><meta name="description" content="Offline layered HTML. Local fonts and wrapping may differ across browsers. Stitch native layer editing is unverified."><title>Visual Remix layered HTML</title><style>html,body{margin:0;padding:0;width:1080px;height:1440px}*{box-sizing:border-box}#scene{position:relative;width:1080px;height:1440px;overflow:hidden;background:'+scene.background+'}</style></head><body><main id="scene" aria-label="Exported Scene">'+layers.join('')+'</main></body></html>';
  if(new TextEncoder().encode(html).byteLength>REMIX_LIMITS.projectBytes)throw new Error('HTML_EXPORT_TOO_LARGE');
  return html;
}

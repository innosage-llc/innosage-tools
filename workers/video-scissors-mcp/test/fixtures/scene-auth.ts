import { SceneMailbox } from '../../src/scene/mailbox';
// Offline fixture only. No deployed entrypoint imports this dispatch switch.
import legacy from '../../src/index';
import candidate from '../../src/scene/candidate-entry';
import { sceneMcpHandler } from '../../src/scene/mcp';
import { sceneAuthContextReply } from '../../src/scene/diagnostics';
// This isolated Miniflare fixture controls time for the actual provider and
// mailbox together. No deployed entrypoint accepts this header or clock.
const realNow = Date.now;
let offset = 0;
let consentHeld=false;
let leaseHeld=false;
let releaseLease:(()=>void)|null=null;
let releaseConsent:(()=>void)|null=null;
Date.now = () => realNow() + offset;
export default { fetch(request: Request, env: Env, ctx: ExecutionContext) {
  offset = Number(request.headers.get('x-fixture-time-offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 86_400_000) throw new Error('FIXTURE_TIME');
  const path=new URL(request.url).pathname;
  if(path==='/__fixture/auth-context')return sceneAuthContextReply(new URL('/scene/mcp',request.url).href);
  if(path==='/__fixture/lease-held')return Response.json({held:leaseHeld});
  if(path==='/__fixture/release-lease'){releaseLease?.();return Response.json({ok:true});}
  if(path==='/__fixture/consent-held')return Response.json({held:consentHeld});
  if(path==='/__fixture/release-consent'){releaseConsent?.();return Response.json({ok:true});}
  if(path==='/__fixture/reclaim')return new SceneMailbox(env.DB,Date.now,false,false,true).reclaimRetired().then(()=>Response.json({ok:true}));
  let current=request.headers.get('x-fixture-hold-consent')==='true'?{...env,OAUTH_KV:new Proxy(env.OAUTH_KV,{get(target,property){
    if(property==='get')return async(key:string,options?:unknown)=>{
      const value:unknown=await Reflect.apply(target.get,target,[key,options]);
      if(key.startsWith('transaction:') && value!==null){consentHeld=true;releaseConsent=()=>{consentHeld=false;};while(consentHeld)await new Promise<void>(resolve=>setTimeout(resolve,5));releaseConsent=null;}
      return value;
    };
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }})}:env;
  if(request.headers.get('x-fixture-hold-lease')==='true'){
    const statement=(original:D1PreparedStatement):D1PreparedStatement=>new Proxy(original,{get(target,property){
      if(property==='bind')return (...values:unknown[])=>statement(target.bind(...values));
      if(property==='first')return async(...args:unknown[])=>{
        const value:unknown=await Reflect.apply(target.first,target,args);
        if(value!==null){leaseHeld=true;releaseLease=()=>{leaseHeld=false;};while(leaseHeld)await new Promise<void>(resolve=>setTimeout(resolve,5));releaseLease=null;}
        return value;
      };
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }});
    current={...current,DB:new Proxy(env.DB,{get(target,property){
      if(property==='withSession')return (...args:unknown[])=>new Proxy(Reflect.apply(target.withSession,target,args) as D1DatabaseSession,{get(session,key){
        if(key==='prepare')return(sql:string)=>sql.includes('SELECT s.expires,s.expiry_policy')?statement(session.prepare(sql)):session.prepare(sql);
        const value=Reflect.get(session,key,session);return typeof value==='function'?value.bind(session):value;
      }});
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }})};
  }
  if (request.headers.get('x-fixture-old') === 'true') return legacy.fetch(request, env, ctx);
  if (request.headers.get('x-fixture-lease-race') === 'true') return sceneMcpHandler(env.DB,{purpose:'visual-remix',shareId:'expired-share',projectId:'race-project',generation:'race-generation',epoch:1},new URL('/scene/mcp',request.url).href).fetch(request);
  return candidate.fetch(request, { ...current, SCENE_BUILD_REVISION:'a'.repeat(40), SCENE_UNTIL_REVOKED_ENABLED:request.headers.get('x-fixture-until-revoked')==='true'?'true':'false', SCENE_REMOTE_ENABLED: request.headers.get('x-fixture-disabled') === 'true' ? 'false' : 'true' }, ctx);
} };

export { VideoScissorsBridgeDO } from '../../src/VideoScissorsBridgeDO';

// LOCAL ONLY setup wrapper. Never imported by src/index.ts or deploy config.
import worker from '../src/index';
import bridgeWorker from '../src/index-do';
export { VideoScissorsBridgeDO } from '../src/index-do';
import migration from '../migrations/0001.sql';
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/__fixture/init' && request.method === 'POST') {
      await env.DB.exec(migration.replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
      return new Response(null, { status: 204 });
    }
    return (('VIDEO_BRIDGE' in env) ? bridgeWorker : worker).fetch(request,env,ctx);
  },
} satisfies ExportedHandler<Env>;

// LOCAL ONLY: observe native D1 results, never substitute database outcomes.
import worker from '../src/index';
import { mcpHandler } from '../src/mcp';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const counts = { statements: 0, rowsRead: 0, rowsWritten: 0, projectReads: 0 };
    const db = env.DB;
    const observe = (target: D1Database | D1DatabaseSession): typeof target => new Proxy(target, {
      get(target, key) {
        if (key === 'withSession') return (...args: Parameters<D1Database['withSession']>) => observe(db.withSession(...args));
        if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const statement = (target: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(target, {
      get(target, key) {
        if (key === 'bind') return (...values: unknown[]) => statement(target.bind(...values), sql);
        if (key === 'first' || key === 'all' || key === 'run') return async (column?: string) => {
          counts.statements++;
          // first() discards D1 metadata. all() runs the identical native SQL and
          // lets this test retain its real meta before projecting the first row.
          const result = key === 'run' ? await target.run() : await target.all<Record<string, unknown>>();
          counts.rowsRead += result.meta.rows_read;
          counts.rowsWritten += result.meta.rows_written;
          if (sql.startsWith('SELECT p.metadata,p.expires FROM projects')) {
            counts.projectReads++;
            // Deterministically commit revoke after the authority read but before
            // the callback resumes. Direct test setup SQL is excluded from counts.
            if (counts.projectReads === 1 && request.headers.get('x-fixture-revoke') === 'after-read') {
              await db.prepare('UPDATE projects SET revoked=1,epoch=epoch+1 WHERE id=?')
                .bind(request.headers.get('x-fixture-project')).run();
            }
          }
          if (key !== 'first') return result;
          const row = result.results[0];
          return row ? (column ? row[column] : row) : null;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const observed = observe(db) as D1Database;
    let response: Response;
    if (new URL(request.url).pathname === '/__batch1/mcp') {
      const props = JSON.parse(request.headers.get('x-fixture-props') ?? '{}');
      const scopes = JSON.parse(request.headers.get('x-fixture-scopes') ?? '[]');
      response = await mcpHandler(observed, props, 'https://localhost').fetch(
        new Request('https://localhost/mcp', request),
        { authInfo: { token: 'synthetic', clientId: 'synthetic', scopes } });
    } else {
      response = await worker.fetch(request, { ...env, DB: observed }, ctx);
    }
    // MCP may execute while its finite response stream is consumed. Finish the
    // synthetic response before serializing counters, otherwise reads look zero.
    const body = await response.text();
    const headers = new Headers(response.headers);
    headers.set('x-fixture-counts', JSON.stringify(counts));
    return new Response(body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;

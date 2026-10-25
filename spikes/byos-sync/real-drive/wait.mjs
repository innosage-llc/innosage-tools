// Playwright waitForFunction polls synchronously: an async predicate returns a
// truthy Promise before its result. Await page.evaluate in the host instead.
export async function until(page,predicate,arg,{timeout=30000}={}){
 const start=Date.now();
 while(Date.now()-start<timeout){if(await page.evaluate(predicate,arg))return;await new Promise(r=>setTimeout(r,50));}
 const error=new Error('Bounded browser condition not reached');error.name='TimeoutError';throw error;
}

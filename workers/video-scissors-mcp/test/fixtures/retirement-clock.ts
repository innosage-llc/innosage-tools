// Node-side test bundler only. Substitute the database clock literal, never
// admission/revocation/deletion predicates or any deployed runtime setting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plugin } from 'esbuild';
export const retirementClock:Plugin={name:'local-retirement-clock',setup(builder){
 builder.onLoad({filter:/src[/\\]scene[/\\]retirement\.ts$/},args=>{
  const source=readFileSync(args.path,'utf8'),clock="CAST(unixepoch('now')*1000 AS INTEGER)";
  assert.equal(source.split(clock).length-1,1);
  return {contents:source.replace(clock,'(SELECT now FROM fixture_clock)'),loader:'ts',resolveDir:dirname(args.path)};
 });
}};

// Defined before implementation. Every row must bind to an executable assertion.
export const fixtures = [
  ['F01', 'journal-first ACK and durable reopen'],
  ['F02', 'two-device different-page native propagation'],
  ['F03', 'same-page fork: Master Wins, complete local/cloud recovery'],
  ['F04', 'journal-only conflict editing while remote advances; other pages sync'],
  ['F05', 'duplicate/stale/self signals do not change intent'],
  ['F06', 'Use cloud retires only explicitly discarded session'],
  ['F07', 'Keep local normal native write and verified retirement'],
  ['F08', 'manual merge keeps conflict source bodies until verification'],
  ['F09', 'remote advance during resolution retains losing draft'],
  ['F10', 'network/access/fault schedules preserve durable intent'],
  ['F11', 'native IndexedDB renderer crash at durable/push/cleanup boundaries'],
  ['F12', 'same-workspace clean tab refreshes'],
  ['F13', 'dirty tab retains editor body with warning'],
  ['F14', 'both-dirty race, leadership handoff and session recovery'],
  ['F15', 'workspace isolation, duplicates and unavailable BroadcastChannel'],
  ['F16', '30 same-time and hidden-list checkpoint native blocker replay'],
  ['F17', '10/1000-page synthetic calls/bytes/latency and foreground cost'],
].map(([id, scenario]) => ({ id, scenario, status: 'NOT_RUN',
  replay: id==='F04'?'node native-overlay/run.mjs --fixture=F04 && node native-overlay/ui-browser.mjs && node native-overlay/ui-browser.mjs --no-wake':
    id==='F10'?'node native-overlay/faults.mjs':
    id==='F11'?'node native-overlay/browser.mjs && node native-overlay/crash-browser.mjs':
    id==='F14'?'node native-overlay/browser.mjs && node native-overlay/ui-browser.mjs && node native-overlay/leader-browser.mjs':
    id==='F15'?'node native-overlay/browser.mjs':
    ['F12','F13'].includes(id)?'node native-overlay/browser.mjs && node native-overlay/ui-browser.mjs':
    id==='F16'?'node native-overlay/run.mjs --fixture=F16 && node native-overlay/checkpoint.mjs':
    id==='F17'?'node native-overlay/measure.mjs && node native-overlay/measure-overlay.mjs':
    `node native-overlay/run.mjs --fixture=${id}`
 }));
export const bodies = Object.freeze({
  A: '# Original\n\nA — baseline.',
  B: '# Local\n\nB — offline device A acknowledged intent.',
  C: '# Cloud\n\nC — independent device B intent.',
  D: '# Local continued\n\nD — B extended during review.',
  E: '# Cloud continued\n\nE — C extended during review.',
  M: '# Manual merge\n\nB — offline device A acknowledged intent.\nC — independent device B intent.\nM — explicit combined version.',
});

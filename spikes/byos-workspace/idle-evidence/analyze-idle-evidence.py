"""Derive metrics from sanitized browser evidence; no browser/network access."""
import json,sys,csv,collections
from pathlib import Path
p=Path(sys.argv[1]); data=json.loads(p.read_text()); snap=data['timed']; events=snap['events']; origin=snap['timeOriginMs']
by_id={x['id']:x for x in data['fixture']}; rows=[]
for id,m in by_id.items():
 es=[e for e in events if e.get('id')==id]; inputs=[e for e in es if e['type']=='input']; last=inputs[-1] if inputs else None
 gen=last['generation'] if last else None
 def first(kind):
  return next((e['atMs'] for e in es if e['type']==kind and e.get('generation')==gen),None)
 i=last['atMs'] if last else None; d=first('durable'); v=first('verified'); eligible=i+5000 if i is not None else None
 dispatch=next((e['atMs'] for e in events if e['type']=='sync-start' and any(x['id']==id and x['generation']==gen for x in e.get('batch',[]))),None)
 rows.append({'title':m['title'],'id':id,'generation':gen,'inputEpochMs':origin+i if i is not None else None,'inputToDurableMs':d-i if d is not None else None,'eligibilityEpochMs':origin+eligible if eligible is not None else None,'eligibilityToBatchDispatchMs':dispatch-eligible if dispatch is not None else None,'verifiedEpochMs':origin+v if v is not None else None,'inputToVerifiedMs':v-i if v is not None else None})
z=next(x for x in rows if x['title']=='AZ142 Z'); run=snap['run']; tr=snap.get('transport') or {}
current={x['id']:x for x in run['pages']}
complete=(len(rows)==26 and len(current)==26 and run.get('ready') is True and run['state']=='safe-to-close' and not run.get('reason') and not run.get('flight') and not tr.get('halted') and not tr.get('active') and all(x['generation'] and x['verifiedEpochMs'] is not None and x['inputEpochMs'] is not None and current.get(x['id'],{}).get('generation')==x['generation'] and current[x['id']].get('saved')==x['generation'] and current[x['id']].get('verified')==x['generation'] and not current[x['id']].get('saving') for x in rows))
latest_complete=max((max(x['inputEpochMs'],x['verifiedEpochMs']) for x in rows),default=None) if complete else None
ready_events=[e['atMs']+origin for e in events if complete and e['type']=='safe-to-close' and e['atMs']+origin>=latest_complete]
ready=ready_events[-1] if ready_events else None
summary={'state':snap['run']['state'],'reason':snap['run']['reason'],'pagesWithInput':sum(x['inputEpochMs'] is not None for x in rows),'pagesVerified':sum(x['verifiedEpochMs'] is not None for x in rows),'zLastInputEpochMs':z['inputEpochMs'],'safeToCloseEpochMs':ready,'zToSafeCloseMs':ready-z['inputEpochMs'] if ready is not None and z['inputEpochMs'] is not None else None,'syncs':snap['run']['syncs'],'verifies':snap['run']['verifies'],'requests':tr.get('requests'),'bytesUp':tr.get('bytesUp'),'bytesDown':tr.get('bytesDown'),'transportHalted':tr.get('halted'),'transportActive':tr.get('active'),'singleSampleOnly':True}
halt_events=[e['atMs']+origin for e in events if e['type']=='halt']
input_epochs=sorted(x['inputEpochMs'] for x in rows if x['inputEpochMs'] is not None)
cadence=[b-a for a,b in zip(input_epochs,input_epochs[1:])]
local_other=[x['inputToDurableMs'] for x in rows if x['title']!='AZ142 Z' and x['inputToDurableMs'] is not None]
request_rows=tr.get('rows',[])
summary.update(firstInputEpochMs=input_epochs[0] if input_epochs else None,zInputToDurableMs=z['inputToDurableMs'],haltEpochMs=halt_events[0] if halt_events else None,zToHaltMs=halt_events[0]-z['inputEpochMs'] if halt_events and z['inputEpochMs'] is not None and halt_events[0]>=z['inputEpochMs'] else None,inputCadenceRangeMs=[min(cadence),max(cadence)] if cadence else None,aToYLocalACKRangeMs=[min(local_other),max(local_other)] if local_other else None,requestStatuses=dict(collections.Counter(str(r['status']) for r in request_rows)),requestMethods=dict(collections.Counter(r['method'] for r in request_rows)),lastRequestEndedEpochMs=max((r.get('endedAt',0) for r in request_rows),default=None),requestsStartedAfterHalt=sum(r['startedAt']>halt_events[0] for r in request_rows) if halt_events else None)
p.with_suffix('.summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with p.with_suffix('.pages.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
print(json.dumps(summary,indent=2))

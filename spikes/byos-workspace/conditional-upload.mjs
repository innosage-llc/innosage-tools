import {sameRecord,protocolError} from './prepared-wal.mjs';
import {classifyUploadError,retryDelay,UPLOAD_RETRY_POLICY} from './upload-retry.mjs';

/** A single coordinator; IO methods are single attempts, never native retry loops. */
export async function conditionalUpload({row,io,canDispatch,budget,onState=()=>{},clock,policy=UPLOAD_RETRY_POLICY,recordsEqual=sameRecord}) {
  const emit=(state,extra={})=>onState({state,page:row.target?.id,generation:row.generation,...extra});
  const waitForRetry=async(attempt,error)=>{
    const delay=retryDelay({attempt,retryAfter:error.retryAfter,nowMs:clock.now(),wallNowMs:clock.wallNow?.()??Date.now(),remainingMs:budget.remainingMs(),random:clock.random?.()??0.5,policy});
    if(delay.stop){emit('failed',{attempt,stopReason:delay.stop});throw protocolError(delay.stop,{cause:error});}
    emit('backoff',{attempt,nextAttempt:delay.nextAttempt,nextRetryAt:delay.nextAtMs,delayMs:delay.delayMs});
    await clock.sleep(delay.delayMs);
  };
  const readWithBudget=async()=>{
    for(let attempt=1;attempt<=policy.maxAttempts;attempt++){
      budget.assertCanRequest();
      try{return await io.readPage(row.fileId);}
      catch(error){
        const category=classifyUploadError({...error,write:false});
        if(!category.retry){emit(category.state,{attempt,category:category.category,stopReason:error.code??error.message});throw error;}
        await waitForRetry(attempt,error);
      }
    }
    throw protocolError('READ_ATTEMPT_BUDGET_EXHAUSTED');
  };
  const checkObserved=observed=>{
    if(recordsEqual(observed.record,row.target))return 'applied';
    if(recordsEqual(observed.record,row.base)&&observed.etag===row.expectedEtag)return 'baseline';
    throw protocolError('UPLOAD_CONFLICT',{row,observed});
  };
  const unresolved=(cause,attempt)=>{
    const category=classifyUploadError({...cause,write:false});
    emit(['auth-required','pending'].includes(category.state)?category.state:'failed',{attempt,uncertain:true,stopReason:'WRITE_OUTCOME_UNRESOLVED'});
    return protocolError('WRITE_OUTCOME_UNRESOLVED',{row,cause});
  };
  let uncertain=false;
  for(let attempt=1;attempt<=policy.maxAttempts;attempt++){
    budget.assertCanRequest();
    // This final check and invocation have no intervening asynchronous wait.
    if(!canDispatch(row)){
      emit('pending',{attempt,stopReason:uncertain?'SUPERSEDED_WITH_UNCERTAIN_WRITE':'SUPERSEDED_BEFORE_DISPATCH'});
      throw protocolError(uncertain?'SUPERSEDED_WITH_UNCERTAIN_WRITE':'SUPERSEDED_BEFORE_DISPATCH',{row});
    }
    emit('uploading',{attempt});
    let error;
    const beforeDispatch=()=>{
      budget.assertCanRequest();
      if(!canDispatch(row)){const code=uncertain?'SUPERSEDED_WITH_UNCERTAIN_WRITE':'SUPERSEDED_BEFORE_DISPATCH';emit('pending',{attempt,stopReason:code});throw protocolError(code,{row});}
    };
    // Observers can reenter synchronously. IO must repeat this guard at its
    // physical fetch boundary if it performs any preparation or callback first.
    beforeDispatch();
    try{await io.writePage(row.fileId,row.expectedEtag,structuredClone(row.target),{beforeDispatch});}
    catch(cause){error=cause;}
    if(error){
      if(error.code?.startsWith('SUPERSEDED_'))throw error;
      const category=classifyUploadError({...error,write:true});
      // Authentication/permission/configuration failures do not generate blind
      // read/write traffic. The WAL and local journal remain protected.
      if(!category.retry&&!category.reconcile){
        emit(category.state,{attempt,category:category.category,stopReason:error.code??error.message});throw error;
      }
      uncertain=true;emit(category.state,{attempt,category:category.category,uncertain:true});
      const errorAt=clock.now();
      // Final attempts still get bounded reconciliation, even though another
      // PUT is forbidden. Retry-After applies to the read as well as the PUT.
      const delay=category.retry?retryDelay({attempt,retryAfter:error.retryAfter,nowMs:errorAt,wallNowMs:clock.wallNow?.()??Date.now(),remainingMs:budget.remainingMs(),random:clock.random?.()??0.5,policy:{...policy,maxAttempts:policy.maxAttempts+1}}):null;
      if(delay?.stop){emit('failed',{attempt,uncertain:true,stopReason:delay.stop});throw protocolError(delay.stop,{row,cause:error});}
      if(delay?.serverDelayMs){emit('backoff',{attempt,purpose:'reconcile',delayMs:delay.serverDelayMs,nextRetryAt:errorAt+delay.serverDelayMs});await clock.sleep(delay.serverDelayMs);}
      let observed;
      try{observed=await readWithBudget();}
      catch(cause){throw unresolved(cause,attempt);}
      let outcome;
      try{outcome=checkObserved(observed);}
      catch(cause){emit('conflict',{attempt,stopReason:'UPLOAD_CONFLICT'});throw cause;}
      if(outcome==='applied'){
        emit(canDispatch(row)?'verified':'pending',{attempt,confirmedGeneration:row.generation,reconciled:true});
        return {row,observed,attempts:attempt,reconciled:true};
      }
      if(!category.retry){emit('conflict',{attempt,stopReason:'CONDITIONAL_WRITE_REJECTED'});throw protocolError('CONDITIONAL_WRITE_REJECTED',{row,observed});}
      if(attempt>=policy.maxAttempts){emit('failed',{attempt,uncertain:true,stopReason:'ATTEMPT_BUDGET_EXHAUSTED'});throw protocolError('ATTEMPT_BUDGET_EXHAUSTED',{row});}
      const remainingDelay=Math.max(0,delay.delayMs-(clock.now()-errorAt));
      if(remainingDelay>=budget.remainingMs()){emit('failed',{attempt,uncertain:true,stopReason:'TIME_BUDGET_EXHAUSTED'});throw protocolError('TIME_BUDGET_EXHAUSTED',{row});}
      if(remainingDelay){emit('backoff',{attempt,nextAttempt:attempt+1,delayMs:remainingDelay,nextRetryAt:clock.now()+remainingDelay});await clock.sleep(remainingDelay);}
      continue;
    }
    // A successful HTTP response is not a verified complete page generation.
    let observed;
    try{observed=await readWithBudget();}
    catch(cause){throw unresolved(cause,attempt);}
    let outcome;
    try{outcome=checkObserved(observed);}
    catch(cause){emit('conflict',{attempt,stopReason:'UPLOAD_CONFLICT'});throw cause;}
    if(outcome==='applied'){
      emit(canDispatch(row)?'verified':'pending',{attempt,confirmedGeneration:row.generation});
      return {row,observed,attempts:attempt,reconciled:false};
    }
    uncertain=true;
    emit('retrying',{attempt,category:'successful-response-unconfirmed',uncertain:true});
    await waitForRetry(attempt,protocolError('SUCCESS_RESPONSE_UNCONFIRMED'));
  }
  throw protocolError('ATTEMPT_BUDGET_EXHAUSTED');
}

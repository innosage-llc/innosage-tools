// Local-only queue around the existing protected save. No cloud or idle clocks.
export class LocalAutosave {
 constructor({dirty,save,error=()=>{}}){Object.assign(this,{dirty,save,error});this.flights=new Map();}
 flush(id){
  if(this.flights.has(id))return this.flights.get(id);
  const flight=Promise.resolve().then(async()=>{while(this.dirty(id))await this.save(id);});
  this.flights.set(id,flight);
  void flight.finally(()=>{if(this.flights.get(id)===flight)this.flights.delete(id);}).catch(()=>{});
  return flight;
 }
 input(id){void this.flush(id).catch(error=>this.error(error,id));}
}

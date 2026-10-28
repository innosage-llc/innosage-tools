export const fixture = Object.freeze([
  {id:'w142_project',title:'Project',parentId:null,order:0,markdown:'# Project\n\n- scope\n'},
  {id:'w142_notes',title:'Meeting Notes',parentId:'w142_project',order:0,markdown:'# Meeting Notes\n\n[Agenda](https://example.invalid/agenda)\n'},
  {id:'w142_agenda',title:'Agenda',parentId:'w142_notes',order:0,markdown:'# Agenda\n\n```js\nconst answer = 42;\n```\n'}
]);

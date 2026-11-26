const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../automation-settings/index.html'), 'utf8');

function pageHarness({gate = Promise.resolve({ allowed: true }), schedules = [], recipients = [], failSchedules = 0, failRecipients = 0} = {}) {
  const elements = new Map();
  const make = id => {
    if (!elements.has(id)) elements.set(id, {id, disabled: false, textContent: '', innerHTML: '', checked: false,
      value: '', dataset: {}, children: [], attrs: {}, setAttribute(k,v){this.attrs[k]=v}, getAttribute(k){return this.attrs[k]},
      append(x){this.children.push(x)}, querySelector(){return null}, querySelectorAll(){return []}, addEventListener(){}});
    return elements.get(id);
  };
  const ids = [...source.matchAll(/id="([^"]+)"/g)].map(m => m[1]); ids.forEach(make);
  const calls = [];
  make('schedules-list').setAttribute('aria-busy','true');
  const document = {getElementById: make, createElement: () => make(`option-${Math.random()}`),
    querySelectorAll: () => [], querySelector: () => null};
  function from(table) {
    const q = {select(){return q}, order(){return q}, eq(){return q}, maybeSingle: async()=>({data:{is_active:true},error:null}),
      update(){return q}, delete(){return q}, insert(){calls.push(['insert',table]);return Promise.resolve({error:null})},
      upsert(){calls.push(['upsert',table]);return Promise.resolve({error:null})},
      then(resolve,reject){ calls.push(['select',table]); let error=null, data=[];
        if(table==='automation_schedules' && failSchedules-- > 0) error={code:'TEMP_SCHED'};
        else if(table==='automation_schedules') data=schedules;
        return Promise.resolve({data,error}).then(resolve,reject); }};
    return q;
  }
  const zamClient = {from, rpc: async(name,payload)=>{calls.push(['rpc',name,payload]); if(name.startsWith('list_') && failRecipients-- > 0)return {data:null,error:{code:'TEMP_RECIP'}};return {data:name.startsWith('list_')?recipients:null,error:null}}};
  const context = {document, zamClient, currentUser:{role:'Owner'}, ZamAPI:{getBranches:async()=>[{id:'b1',name:'Branch'}]},
    ZamReportRecipientSettings:{render:({status,accounts})=>status?`<p>${status}</p>`:`<p>${(accounts||[]).length} recipients</p>`,buildPayload:()=>({recipients:[],p_primary_profile_id:''})},
    console:{error(){}}, confirm:()=>true, setTimeout(){}, Promise};
  context.automationPermissionGate = gate;
  const start = source.indexOf('const REPORT_TYPE_LABELS=');
  const end = source.indexOf('</script><script>', start);
  const inline = start >= 0 && end > start ? [null, source.slice(start, end)] : null;
  assert.ok(inline, 'main page script must be extractable');
  vm.runInNewContext(inline[1], context, {timeout:1000});
  return {elements, calls, context};
}

test('automation inline script parses and successful gate loads schedules and authorized recipient candidates', async () => {
  const {elements,calls} = pageHarness({schedules:[{id:'s1',report_type:'checklist_summary',is_active:true,send_time:'21:00',shift_type:null}],recipients:[{profile_id:'p1',role:'Owner',can_be_primary:true}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(x=>x[0]==='select' && x[1]==='automation_schedules'));
  assert.ok(calls.some(x=>x[0]==='rpc' && x[1]==='list_daily_report_email_recipient_candidates'));
  assert.equal(elements.get('active-count').textContent,1);
  assert.equal(elements.get('recipient-list').getAttribute('aria-busy'),'false');
  assert.equal(elements.get('save-recipients').disabled,false);
  assert.equal(elements.get('automation-kpi-recipients').textContent,0, 'eligible but unconfigured accounts are not saved recipients');
});

test('schedule and recipient failures render errors and retry handlers recover', async () => {
  const {elements} = pageHarness({failSchedules:1,failRecipients:1,schedules:[],recipients:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(elements.get('schedules-list').innerHTML,/TEMP_SCHED/);
  assert.match(elements.get('recipient-save-status').textContent,/TEMP_RECIP/);
  await elements.get('retry-schedules').onclick();
  await elements.get('retry-recipients').onclick();
  assert.match(elements.get('schedules-list').innerHTML,/لا توجد مواعيد محفوظة/);
  assert.equal(elements.get('recipient-list').getAttribute('aria-busy'),'false');
  assert.equal(elements.get('recipient-save-status').textContent,'', 'a successful retry clears the earlier error');
});

test('recipient KPI counts saved selections, not every eligible candidate', async () => {
  const recipients=[{profile_id:'owner',role:'Owner',is_selected:true,is_configured:true,can_be_primary:true},{profile_id:'selected',role:'Manager',is_selected:true,is_configured:true},{profile_id:'candidate',role:'Manager',is_selected:false,is_configured:true}];
  const {elements}=pageHarness({recipients});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('automation-kpi-recipients').textContent,2);
});

test('saving recipient choices calls the guarded RPC and refreshes the list', async () => {
  const recipients=[{profile_id:'owner',role:'Owner',is_selected:true,is_configured:true,can_be_primary:true}];
  const {elements,calls}=pageHarness({recipients});
  await new Promise(resolve=>setImmediate(resolve));
  await elements.get('save-recipients').onclick();
  assert.ok(calls.some(x=>x[0]==='rpc' && x[1]==='save_daily_report_email_recipients'));
  assert.equal(calls.filter(x=>x[1]==='list_daily_report_email_recipient_candidates').length,2);
  assert.match(elements.get('recipient-save-status').textContent,/تم حفظ/);
});

test('denied or stalled authorization does not start data loads and timeout clears loading state', async () => {
  let resolveGate;
  const gate = new Promise(resolve=>{resolveGate=resolve});
  const {elements,calls} = pageHarness({gate});
  let timeoutCallback;
  const timeoutScript = source.match(/setTimeout\(\(\) => \{([\s\S]*?)\n\}, 8000\);/);
  assert.ok(timeoutScript);
  const document = {getElementById:()=>elements.get('schedules-list'),createElement:()=>({setAttribute(k,v){this[k]=v}}),querySelector:()=>({prepend(){}})};
  vm.runInNewContext(`setTimeout(() => {${timeoutScript[1]}\n}, 8000);`,{document,automationAuthorized:false,setTimeout:fn=>{timeoutCallback=fn}});
  timeoutCallback();
  assert.equal(elements.get('schedules-list').getAttribute('aria-busy'),'false');
  resolveGate({allowed:false,error:{code:'NO_ACCESS'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,0);
});

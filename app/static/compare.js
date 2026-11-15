
const byId = id => document.getElementById(id);
const form = byId('form'), status = byId('status'), results = byId('results');
const labels = ['Sunlight','Darkness','Earth visible','Sunlight + Earth visible'];
const sites = window.LWP_SITES.byId;
const demoStart = '2026-12-14T20:00', demoEnd = '2026-12-15T02:00';
for (const [id, site] of [['A','site04'],['B','site11']]) {
  const [lat, lon] = sites[site];
  const field = document.createElement('fieldset');
  field.innerHTML = '<legend>Scenario '+id+'</legend>'+
    '<label>Latitude (°)<input required name="lat" type="number" min="-90" max="90" step="any" value="'+lat+'"></label>'+
    '<label>Longitude (° east)<input required name="lon" type="number" min="-180" max="180" step="any" value="'+lon+'"></label>'+
    '<label>Start date and time (UTC)<input required name="start" type="datetime-local" step="60" value="'+demoStart+'"></label>'+
    '<label>End date and time (UTC)<input required name="end" type="datetime-local" step="60" value="'+demoEnd+'"></label>';
  byId('inputs').append(field);
}
const candidateNames = {
  site04: 'Site 04 · Shackleton Rim',
  site11: 'Site 11 · de Gerlache Rim 1'
};
function presetFor(lat, lon) {
  if (lat.trim() === '' || lon.trim() === '') return '';
  return Object.keys(sites).find(key => sites[key][0] === Number(lat) && sites[key][1] === Number(lon)) || '';
}
function syncPreset(field) {
  field.querySelector('select').value = presetFor(field.querySelector('[name=lat]').value, field.querySelector('[name=lon]').value);
}
for (const field of form.querySelectorAll('fieldset')) {
  const label = document.createElement('label');
  label.innerHTML = 'Site preset <select>' + window.LWP_SITES.optionsHtml() + '</select>';
  const select = label.querySelector('select');
  const lat = field.querySelector('[name=lat]');
  const lon = field.querySelector('[name=lon]');
  field.querySelector('legend').after(label);
  syncPreset(field);
  select.onchange = () => {
    if (select.value) [lat.value, lon.value] = sites[select.value];
    edited('Site selection updated.');
  };
  for (const input of [lat, lon]) input.addEventListener('input', () => { select.value = ''; });
}
const [fieldA,fieldB]=form.querySelectorAll('fieldset');
function edited(message) {
  status.classList.remove('decision');results.replaceChildren();
  status.textContent=message+' Select Run comparison to recalculate.';
}
byId('copy').onclick=()=>{
  for(const input of fieldA.querySelectorAll('input')) fieldB.querySelector('[name='+input.name+']').value=input.value;
  fieldB.querySelector('select').value=fieldA.querySelector('select').value;
  edited('Copied A into B.');
};
// datetime-local is a wall-clock field; here its values are explicitly UTC.
const DAY = 86400000, MINUTE = 60000;
const utcField = ms => new Date(ms).toISOString().slice(0,16);
const insideModel = ms => ms >= Date.UTC(1901,0,1) && ms < Date.UTC(2050,0,1);
const timeField = el => el.name === 'start' || el.name === 'end';
function restore(el, value) {
  if (timeField(el) && /^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00';
  el.value = value;
}
function applyDelay() {
  const start = fieldA.querySelector('[name=start]').valueAsNumber;
  const duration = byId('delay-duration').valueAsNumber * 60;
  const delay = byId('delay-hours').valueAsNumber * 60;
  const times = [start, start + duration*MINUTE, start + delay*MINUTE, start + (duration+delay)*MINUTE];
  if (!Number.isInteger(duration) || duration < 1 || duration > 60*1440 ||
      !Number.isInteger(delay) || delay < 0 || !times.every(insideModel)) {
    status.classList.remove('decision');
    status.textContent='Choose a valid UTC start, a 1-minute to 60-day duration, and a nonnegative delay. Both windows must be within 1901–2049.';
    results.replaceChildren();
    return;
  }
  for (const name of ['lat','lon']) fieldB.querySelector('[name='+name+']').value=fieldA.querySelector('[name='+name+']').value;
  fieldB.querySelector('select').value=fieldA.querySelector('select').value;
  for (const [i, field] of [fieldA,fieldB].entries()) {
    field.querySelector('[name=start]').value=utcField(times[2*i]);
    field.querySelector('[name=end]').value=utcField(times[2*i+1]);
  }
  edited('Scenario A is the planned window; Scenario B is the delayed window.');
  form.requestSubmit();
}
byId('apply-delay').onclick=applyDelay;
byId('shackleton-example').onclick=()=>{
  fieldA.querySelector('select').value='site04';
  [fieldA.querySelector('[name=lat]').value, fieldA.querySelector('[name=lon]').value] = sites.site04;
  fieldA.querySelector('[name=start]').value='2026-12-14T20:00';
  byId('delay-duration').value='6';
  byId('delay-hours').value='72';
  applyDelay();
};
byId('shift').onclick=()=>{
  const days=byId('shift-days').valueAsNumber;
  const dates=[...fieldB.querySelectorAll('input[type=datetime-local]')];
  const shifted=dates.map(input=>input.valueAsNumber+days*86400000);
  if(!Number.isInteger(days)||shifted.some(t=>!Number.isFinite(t)||t<Date.UTC(1901,0,1)||t>=Date.UTC(2050,0,1))){
    status.textContent='Enter a whole number of days that keeps both B dates within 1901–2049.';
    return;
  }
  dates.forEach((input,i)=>input.value=utcField(shifted[i]));
  edited('Shifted both B dates by '+days+' days.');
};
async function scenario(field) {
  const query = new URLSearchParams({profile:'true'});
  for(const input of field.querySelectorAll('input')) {
    query.set(input.name, timeField(input) ? input.value+'Z' : input.value);
  }
  const start = Date.parse(query.get('start')), end = Date.parse(query.get('end'));
  if(!insideModel(start) || !insideModel(end) || end <= start || end-start > 60*DAY) throw Error('Each end must follow its start, within 60 days and within 1901–2049 UTC.');
  const response = await fetch('./surface-windows?'+query);
  const body = await response.json();
  if(!response.ok) throw Error(typeof body.detail === 'string' ? body.detail : 'Check coordinates and dates.');
  return {start,end,profile:body.profile,rows:body.rows.map(row=>row.map(pair=>pair.map(Date.parse)))};
}
let shortWindows = false;
const hours = ms => {
  if (!shortWindows) return (ms/3600000).toFixed(1)+' h';
  const minutes = Math.round(ms/MINUTE);
  return `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min`;
};
const utc = ms => new Date(ms).toISOString().slice(0,16).replace('T',' ')+' UTC';
function chart(data,card) {
  const p=data.profile, w=480, h=210, x=i=>42+i*420/(p.length-1);
  const y=v=>12+(scale-v)*180/(2*scale);
  const box=document.createElement('div');
  box.innerHTML='<h3>Elevation above the smooth horizon</h3><svg viewBox="0 0 480 210" style="width:100%" role="img" aria-label="Sun and Earth elevations in degrees"></svg><p>Sun (solid) · Earth (dashed) · Dashed horizontal line: 0° horizon</p><output></output>';
  const svg=box.querySelector('svg');
  svg.innerHTML=[scale,0,-scale].map(v=>'<line x1="42" x2="462" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#8190a5" class="'+(v===0?'horizon':'grid-line')+'" stroke-dasharray="'+(v===0?'4 4':'none')+'"/><text x="0" y="'+(y(v)+4)+'" fill="white" font-size="12">'+v+'°</text>').join('');
  [1,2].forEach((j)=>svg.insertAdjacentHTML('beforeend','<polyline fill="none" stroke="'+(j===1?'#ffce76':'#8fe1d6')+'" stroke-width="2" points="'+p.map((r,i)=>x(i)+','+y(r[j])).join(' ')+'"/>'));
  svg.insertAdjacentHTML('beforeend','<line class="cursor" y1="12" y2="192" stroke="white"/>');
  cursors.push(i=>{
    const line=svg.querySelector('.cursor');
    line.setAttribute('x1',x(i));line.setAttribute('x2',x(i));
    box.querySelector('output').textContent=utc(Date.parse(p[i][0]))+' · Sun '+p[i][1].toFixed(2)+'° · Earth '+p[i][2].toFixed(2)+'°';
  });
  card.append(box);
}
let scale=90, cursors=[];
function overlapBreakdown(data) {
  const total = index => data.rows[index].reduce((sum, [start, end]) => sum + end - start, 0);
  const windowMs = data.end - data.start;
  const sunlight = total(0), earthVisible = total(2), overlap = total(3);
  const parts = [
    ['Earth below or at the horizon, Sun above', sunlight - overlap],
    ['Sun below or at the horizon, Earth above', earthVisible - overlap],
    ['Neither above the horizon', windowMs - sunlight - earthVisible + overlap],
  ];
  return parts.filter(([, ms]) => ms > 0);
}
const visibilityStates = ['Neither above', 'Sun only', 'Earth only', 'Both above'];
function visibilitySegments({start, end, rows}) {
  const changes = new Map();
  const toggle = (time, bit) => changes.set(time, (changes.get(time) || 0) ^ bit);
  for (const [row, bit] of [[rows[0], 1], [rows[2], 2]]) {
    for (const [a, b] of row) {
      const left = Math.max(a, start), right = Math.min(b, end);
      if (right > left) { toggle(left, bit); toggle(right, bit); }
    }
  }
  const segments = [];
  let left = start, state = 0;
  for (const right of [...new Set([...changes.keys(), end])].sort((a, b) => a - b)) {
    if (right > left) {
      const previous = segments.at(-1);
      if (previous && previous.state === state) previous.end = right;
      else segments.push({start: left, end: right, state});
    }
    state ^= changes.get(right) || 0;
    left = right;
  }
  return segments;
}
function visibilityTimeline(data) {
  const box = document.createElement('div');
  box.className = 'visibility-timeline';
  const title = document.createElement('h3');
  title.textContent = 'Visibility timeline';
  const track = document.createElement('div');
  track.className = 'visibility-track';
  track.setAttribute('aria-hidden', 'true');
  const key = document.createElement('ul');
  key.className = 'visibility-key';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'View visibility intervals (UTC)';
  const list = document.createElement('ul');
  const states = new Set();
  for (const segment of visibilitySegments(data)) {
    const {start, end, state} = segment;
    const label = visibilityStates[state];
    states.add(state);
    const band = document.createElement('span');
    band.className = 'visibility-state-' + state;
    band.style.left = 100 * (start - data.start) / (data.end - data.start) + '%';
    band.style.width = 100 * (end - start) / (data.end - data.start) + '%';
    const time = utc(start) + ' → ' + utc(end);
    band.title = label + ': ' + time;
    track.append(band);
    const item = document.createElement('li');
    item.textContent = label + ': ' + time + ' · ' + hours(end - start);
    list.append(item);
  }
  for (const state of [...states].sort((a, b) => b - a)) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'visibility-state-' + state;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, visibilityStates[state]);
    key.append(item);
  }
  details.append(summary, list);
  box.append(title, track, key, details);
  return box;
}
function render(data,id) {
  const card=document.createElement('section');
  card.innerHTML='<h2>Scenario '+id+'</h2><p>'+utc(data.start)+' → '+utc(data.end)+'</p><table><thead><tr><th scope="col">Condition</th><th scope="col">Total</th></tr></thead><tbody></tbody></table>';
  data.rows.forEach((row,i)=>{
    const tr=card.querySelector('tbody').insertRow();
    const title=document.createElement('th');title.scope='row';title.textContent=labels[i];tr.append(title);
    const cell=tr.insertCell();cell.textContent=hours(row.reduce((sum,[a,b])=>sum+b-a,0));
    const bar=document.createElement('div');bar.className='track';bar.setAttribute('aria-hidden','true');
    row.forEach(([a,b])=>{
      const span=document.createElement('span');
      span.style.left=100*(a-data.start)/(data.end-data.start)+'%';
      span.style.width=100*(b-a)/(data.end-data.start)+'%';bar.append(span);
    });cell.append(bar);
  });
  const best=data.rows[3].reduce((best,w)=>!best||w[1]-w[0]>best[1]-best[0]?w:best,null);
  const p=document.createElement('p');p.textContent=best?'Longest overlap: '+hours(best[1]-best[0])+' · '+utc(best[0])+' → '+utc(best[1]):'No overlap in this range.';
  const coordinates=document.createElement('p');
  const [lat,lon]=snapshot()[id==='A'?0:1];
  const candidate = candidateNames[presetFor(lat,lon)];
  coordinates.textContent=(candidate ? candidate+' · ' : '')+'Latitude '+lat+'° · Longitude '+lon+'° (east-positive)';
  card.insertBefore(coordinates,card.querySelector('table'));
  card.append(p);
  const breakdown = document.createElement('p');
  const parts = overlapBreakdown(data);
  breakdown.textContent = parts.length
    ? 'Time outside overlap: ' + parts.map(([label, ms]) => label + ' (' + hours(ms) + ')').join(' · ')
    : 'The Sun and Earth stay above the modeled horizon for the whole window.';
  card.append(breakdown);
  card.append(visibilityTimeline(data));
  chart(data,card);
  const details=document.createElement('details');
  const summary=document.createElement('summary');
  summary.textContent='View interval totals';
  details.append(summary,card.querySelector('table'));
  card.append(details);
  results.append(card);
}
const fieldsForShare=[...form.querySelectorAll('fieldset')];
const shareNames=['lat','lon','start','end'];
function snapshot(){
  return fieldsForShare.map(field=>shareNames.map(name=>field.querySelector('[name='+name+']').value));
}
function resultActions(inputs,a,b,delta){
  const actions=document.createElement('div');
  actions.className='compare-actions';
  actions.style.gridColumn='1 / -1';
  const link=new URL(location.href);
  link.search='';
  link.hash='';
  inputs.forEach((values,i)=>values.forEach((value,j)=>link.searchParams.set((i?'b_':'a_')+shareNames[j],value)));
  const copy=document.createElement('button');
  copy.textContent='Copy comparison link';
  const feedback=document.createElement('span');
  feedback.setAttribute('role','status');
  copy.onclick=async()=>{
    try {await navigator.clipboard.writeText(link.href);feedback.textContent=location.hostname==='127.0.0.1'||location.hostname==='localhost'?'Link copied. This local link only works on this device.':'Link copied.';}
    catch {const field=document.createElement('input');field.readOnly=true;field.value=link.href;field.setAttribute('aria-label','Comparison link');feedback.replaceChildren(field);field.select();}
  };
  const download=document.createElement('button');
  download.textContent='Export comparison CSV';
  download.onclick=()=>{
    const rows=[['scenario','latitude_deg','longitude_deg_east','start_utc','end_utc','condition','hours']];
    [a,b].forEach((data,i)=>data.rows.forEach((row,j)=>{
      rows.push([i?'B':'A',...inputs[i].slice(0,2),new Date(data.start).toISOString(),new Date(data.end).toISOString(),labels[j],(row.reduce((sum,[s,e])=>sum+e-s,0)/3600000).toFixed(3)]);
    }));
    rows.push(['B - A','','','','','Modeled overlap difference',(delta/3600000).toFixed(3)]);
    const url=URL.createObjectURL(new Blob([rows.map(row=>row.join(',')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='lunar-comparison.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const reopen=document.createElement('a');reopen.href=link.href;reopen.target='_blank';reopen.rel='noopener';reopen.textContent='Open comparison in new tab';
  actions.append(copy,download,reopen,feedback);
  results.prepend(actions);
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const inputs=snapshot();results.replaceChildren();status.textContent='Calculating both scenarios…';
  const controls=[...form.querySelectorAll('button,input,select')]; controls.forEach(el=>el.disabled=true);
  try {
    const [a,b]=await Promise.all([...form.querySelectorAll('fieldset')].map(scenario));
    scale=Math.max(5,Math.ceil(Math.max(...[...a.profile,...b.profile].flatMap(r=>[Math.abs(r[1]),Math.abs(r[2])]))/5)*5);
    cursors=[];
    shortWindows = Math.max(a.end-a.start,b.end-b.start) <= DAY;
    render(a,'A');render(b,'B');
    const label=document.createElement('label');
    label.textContent='Move through both timelines · same relative progress';
    const slider=document.createElement('input');
    slider.type='range';slider.min=0;slider.max=a.profile.length-1;slider.value=0;
    slider.oninput=()=>cursors.forEach(fn=>fn(Number(slider.value)));
    label.append(slider);label.style.gridColumn='1 / -1';results.prepend(label);slider.oninput();
    const total = d=>d.rows[3].reduce((sum,[s,e])=>sum+e-s,0);
    const delta=total(b)-total(a);
    resultActions(inputs,a,b,delta);
    byId('scenario-editor').open=false;
    const totals=document.createElement('p');
    totals.className='overlap-totals';
    totals.textContent='Scenario A: '+hours(total(a))+' · Scenario B: '+hours(total(b));
    status.classList.add('decision');
    const metric=document.createElement('strong');
    metric.textContent=(delta>0?'+':delta<0?'−':'')+hours(Math.abs(delta));
    status.replaceChildren(metric, document.createTextNode(
      ' difference (B − A) in time when both the Sun and Earth are above the horizon.'
    ), totals);
  } catch(error){status.classList.remove('decision');status.textContent=error.message;} finally{controls.forEach(el=>el.disabled=false);}
});

if (new URLSearchParams(location.search).get('example') === 'athena') {
  const fields = [...form.querySelectorAll('fieldset')];
  const dates = [['2026-11-14','2026-11-18'], ['2026-11-17','2026-11-21']];
  fields.forEach((field, i) => {
    field.querySelector('select').value = 'im2';
    field.querySelector('[name=lat]').value = '-84.7906';
    field.querySelector('[name=lon]').value = '29.1957';
    restore(field.querySelector('[name=start]'), dates[i][0]);
    restore(field.querySelector('[name=end]'), dates[i][1]);
  });
  form.requestSubmit();
}

// Preserve scenario inputs locally; computed results are always recalculated.
try {
  const key='lunar-comparison-v1';
  const inputs=[...form.querySelectorAll('fieldset input,fieldset select')];
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(!new URLSearchParams(location.search).has('example') && Array.isArray(saved) && saved.length===inputs.length) {
    inputs.forEach((el,i)=>{if(typeof saved[i]==='string')restore(el,saved[i]);});
    [fieldA, fieldB].forEach(syncPreset);
  }
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(inputs.map(el=>el.value)));}catch{}};
  form.addEventListener('change',save);
  form.addEventListener('submit',save);
} catch {}

const shared=new URLSearchParams(location.search);
if(!shared.has('example') && ['a_','b_'].every(prefix=>shareNames.every(name=>shared.has(prefix+name)))){
  fieldsForShare.forEach((field,i)=>{
    shareNames.forEach(name=>restore(field.querySelector('[name='+name+']'), shared.get((i?'b_':'a_')+name)));
    syncPreset(field);
  });
  if(form.checkValidity()) form.requestSubmit();
  else {
    byId('scenario-editor').open=true;
    status.textContent='This comparison link contains invalid inputs. Correct the highlighted fields and run the comparison again.';
    form.reportValidity();
  }
} else if (!shared.has('example') && ['a_','b_'].some(prefix=>shareNames.some(name=>shared.has(prefix+name)))) {
  byId('scenario-editor').open=true;
  status.textContent='This comparison link is incomplete. Copy the full link or enter both scenarios below.';
}

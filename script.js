// Simple monthly kakeibo manager
const STORAGE_KEY = 'kakeibo_monthly';
let monthlyRecords = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

// DOM
const fixedList = document.getElementById('fixedList');
const varList = document.getElementById('varList');
const monthLabel = document.getElementById('monthLabel');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const addFixedBtn = document.getElementById('addFixed');
const addVarBtn = document.getElementById('addVar');
const sumTotalEl = document.getElementById('sumTotal');
const sumRikuEl = document.getElementById('sumRiku');
const sumSayaEl = document.getElementById('sumSaya');
const saveMonthBtn = document.getElementById('saveMonth');
const recordsEl = document.getElementById('records');
const chartCanvas = document.getElementById('chart');
let chartInstance = null;
const resetBtn = document.getElementById('resetAll');
// when true, renderInputArea will not persist a new month record into storage
let suppressAutoCreate = false;
// chart window variables
let chartStartIndex = null; // start index in savedKeys (ascending)
const MAX_VISIBLE_MONTHS = 12;
// mark whether we've sized the chart wrapper to match records bottom once
let initialChartSized = false;

if(resetBtn){
  resetBtn.addEventListener('click', ()=>{
    if(!confirm('全ての保存データを削除します。よろしいですか？')) return;
    monthlyRecords = {};
    saveStorage();
    suppressAutoCreate = true;
    renderInputArea();
    renderRecords();
    renderChart();
    suppressAutoCreate = false;
  });
}

// Default required items (with default amounts)
const defaultFixed = [
  {name:'家賃', amount:85260},
  {name:'駐車場', amount:13000},
  {name:'wifi', amount:4960},
  {name:'NHK', amount:2200}
];
const defaultVar = [
  {name:'水道'}, {name:'ガス'}, {name:'電気'}
];

// current month (first day)
let currentMonth = new Date();
currentMonth.setDate(1);

function saveStorage(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(monthlyRecords));
}

function formatYen(n){ return Number(n||0).toLocaleString(); }

function monthKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}

function monthLabelText(d){
  return `${d.getFullYear()}年${d.getMonth()+1}月`;
}

function generateId(){ return 'id'+(Date.now().toString(36))+Math.floor(Math.random()*1000); }

// render input area for currentMonth
function renderInputArea(){
  const key = monthKey(currentMonth);
  monthLabel.textContent = monthLabelText(currentMonth);

  let record = monthlyRecords[key];
  if(!record){
    // initialize with default rows
    record = { items: [], rikuPaid:false, sayaPaid:false, removedDefaults: [] };
    defaultFixed.forEach(it => record.items.push({id:generateId(), name:it.name, fixed:true, checked:true, amount: it.amount || 0, riku: Math.round((it.amount||0)/2), saya: Math.round((it.amount||0)/2)}));
    defaultVar.forEach(it => record.items.push({id:generateId(), name:it.name, fixed:false, checked:true, amount:0, riku:0, saya:0}));
    if(!suppressAutoCreate){
      monthlyRecords[key] = record;
    }
  } else {
    // ensure required default items exist (don't duplicate)
    defaultFixed.forEach(it => {
      const found = record.items.find(x => x.name === it.name && x.fixed === true);
      const defKey = `${it.name}|fixed`;
      if(!found && !(record.removedDefaults && record.removedDefaults.includes(defKey))){
        record.items.unshift({id:generateId(), name:it.name, fixed:true, checked:true, amount: it.amount || 0, riku: Math.round((it.amount||0)/2), saya: Math.round((it.amount||0)/2)});
      }
    });
    defaultVar.forEach(it => {
      const found = record.items.find(x => x.name === it.name && x.fixed === false);
      const defKey = `${it.name}|var`;
      if(!found && !(record.removedDefaults && record.removedDefaults.includes(defKey))){
        record.items.push({id:generateId(), name:it.name, fixed:false, checked:true, amount:0, riku:0, saya:0});
      }
    });
    monthlyRecords[key] = record;
  }

  // clear lists and add column headers
  const headerHtml = '<div style="display:flex; gap:8px; font-weight:bold; padding:6px 0; align-items:center;">'
    + '<div style="width:48px"></div>'
    + '<div style="width:40%">項目</div>'
    + '<div style="width:15%">全額</div>'
    + '<div style="width:15%">りく</div>'
    + '<div style="width:15%">さや</div>'
    + '<div style="width:5%">操作</div>'
    + '</div>';
  fixedList.innerHTML = headerHtml;
  varList.innerHTML = headerHtml;
  // ensure visual area shows a box even if no items
  fixedList.style.minHeight = '100px';
  varList.style.minHeight = '100px';

  // render rows
  record.items.forEach(item => {
    addRowToDOM(item);
  });

  recalcTotals();
}

function addRowToDOM(item){
  const container = item.fixed ? fixedList : varList;
  const row = document.createElement('div');
  row.className = 'itemRow';
  row.dataset.id = item.id;
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.alignItems = 'center';
  row.style.padding = '2px 0';

  row.innerHTML = `
    <div class="chk-cell"><input type="checkbox" ${item.checked? 'checked':''} class="itemChk" /></div>
    <input class="itemName" value="${escapeHtml(item.name)}" style="width:40%; padding:6px;" />
    <input class="itemAmt" type="number" value="${item.amount||0}" style="width:15%; padding:6px;" />
    <input class="itemRiku" type="number" value="${item.riku||0}" placeholder="りく" style="width:15%; padding:6px;" />
    <input class="itemSaya" type="number" value="${item.saya||0}" placeholder="さや" style="width:15%; padding:6px;" />
    <button class="delRow" title="削除" style="width:34px; height:34px;">✖</button>
  `;

  // events
  const chk = row.querySelector('.itemChk');
  const amtInput = row.querySelector('.itemAmt');
  const rikuInput = row.querySelector('.itemRiku');
  const sayaInput = row.querySelector('.itemSaya');
  const nameInput = row.querySelector('.itemName');
  const delBtn = row.querySelector('.delRow');

  chk.addEventListener('change', recalcTotals);
  // when riku/saya change, update total = riku + saya
  rikuInput.addEventListener('input', ()=>{
    const rVal = parseFloat(rikuInput.value) || 0;
    const sVal = parseFloat(sayaInput.value) || 0;
    amtInput.value = (rVal + sVal) || 0;
    recalcTotals();
  });
  sayaInput.addEventListener('input', ()=>{
    const rVal = parseFloat(rikuInput.value) || 0;
    const sVal = parseFloat(sayaInput.value) || 0;
    amtInput.value = (rVal + sVal) || 0;
    recalcTotals();
  });
  // when user clears riku/saya and blurs, set to 0
  rikuInput.addEventListener('blur', ()=>{ if(rikuInput.value === '') rikuInput.value = 0; recalcTotals(); });
  sayaInput.addEventListener('blur', ()=>{ if(sayaInput.value === '') sayaInput.value = 0; recalcTotals(); });
  nameInput.addEventListener('input', ()=>{});

  // 削除ボタン（確認なしで即削除）
  delBtn.addEventListener('click', ()=>{ 
    // mark removed defaults so they are not re-added
    const key = monthKey(currentMonth);
    const record = monthlyRecords[key] || {items:[]};
    const itemObj = record.items.find(i=>i.id === row.dataset.id);
    if(itemObj){
      // if this is a default name, record removal by name+type
      const isDefaultFixed = defaultFixed.some(d=>d.name === itemObj.name);
      const isDefaultVar = defaultVar.some(d=>d.name === itemObj.name);
      if(isDefaultFixed){ record.removedDefaults = record.removedDefaults || []; if(!record.removedDefaults.includes(`${itemObj.name}|fixed`)) record.removedDefaults.push(`${itemObj.name}|fixed`); }
      if(isDefaultVar){ record.removedDefaults = record.removedDefaults || []; if(!record.removedDefaults.includes(`${itemObj.name}|var`)) record.removedDefaults.push(`${itemObj.name}|var`); }
    }
    deleteRowById(row.dataset.id);
  });

  // 自動分割: 金額入力時にりく/さやへ半分を自動入力する。ただし手入力で値がある場合は上書きしない。
  row.dataset.prevAmount = item.amount || 0;
  row.dataset.prevHalf = Math.round((item.amount || 0) / 2);
  amtInput.addEventListener('input', ()=>{
    const val = parseFloat(amtInput.value) || 0;
    const half = Math.round(val / 2);
    const prevHalf = parseFloat(row.dataset.prevHalf) || 0;
    const rVal = parseFloat(rikuInput.value) || 0;
    const sVal = parseFloat(sayaInput.value) || 0;
    if((rVal === 0 && sVal === 0) || (rVal === prevHalf && sVal === prevHalf)){
      rikuInput.value = half;
      sayaInput.value = half;
    }
    row.dataset.prevAmount = val;
    row.dataset.prevHalf = half;
    recalcTotals();
  });
  // append row to the container so it appears in the DOM
  container.appendChild(row);
}

function recalcTotals(){
  const key = monthKey(currentMonth);
  // If there's already a record for this month, use it.
  // If not, only create/assign a new record into monthlyRecords when auto-creation is allowed.
  const existing = Object.prototype.hasOwnProperty.call(monthlyRecords, key);
  const record = existing ? monthlyRecords[key] : {items:[]};
  const rows = Array.from(document.querySelectorAll('#fixedList .itemRow, #varList .itemRow'));
  const items = rows.map(r=>({
    id: r.dataset.id || generateId(),
    name: r.querySelector('.itemName').value,
    fixed: r.parentElement.id === 'fixedList',
    checked: r.querySelector('.itemChk').checked,
    amount: parseFloat(r.querySelector('.itemAmt').value) || 0,
    riku: parseFloat(r.querySelector('.itemRiku').value) || 0,
    saya: parseFloat(r.querySelector('.itemSaya').value) || 0
  }));
  // update record items (not saved yet)
  record.items = items;
  // Only persist into monthlyRecords if a record already existed, or auto-creation is allowed.
  if(existing || !suppressAutoCreate){
    monthlyRecords[key] = record;
  }

  let total = 0, rTotal = 0, sTotal = 0;
  items.forEach(it=>{
    if(it.checked){ total += it.amount; rTotal += it.riku; sTotal += it.saya; }
  });
  sumTotalEl.textContent = formatYen(total);
  sumRikuEl.textContent = formatYen(rTotal);
  sumSayaEl.textContent = formatYen(sTotal);
}

function addNewRow(fixed){
  const key = monthKey(currentMonth);
  const record = monthlyRecords[key] || {items:[]};
  const it = {id: generateId(), name:'新しい項目', fixed:!!fixed, checked:true, amount:0, riku:0, saya:0};
  record.items.push(it);
  monthlyRecords[key] = record;
  saveStorage();
  renderInputArea();
}

function deleteRowById(id){
  const key = monthKey(currentMonth);
  const record = monthlyRecords[key];
  if(!record) return;
  record.items = record.items.filter(i => i.id !== id);
  monthlyRecords[key] = record;
  saveStorage();
  renderInputArea();
}

function saveMonth(){
  // read current DOM rows and compute totals, persist
  const key = monthKey(currentMonth);
  // ensure DOM values are reflected in totals (but this may not auto-create the month)
  recalcTotals();

  // Build record from DOM if not present (so initial save works even when suppressAutoCreate was used)
  let record = monthlyRecords[key];
  if(!record){
    const rows = Array.from(document.querySelectorAll('#fixedList .itemRow, #varList .itemRow'));
    const items = rows.map(r=>({
      id: r.dataset.id || generateId(),
      name: r.querySelector('.itemName').value,
      fixed: r.parentElement.id === 'fixedList',
      checked: r.querySelector('.itemChk').checked,
      amount: parseFloat(r.querySelector('.itemAmt').value) || 0,
      riku: parseFloat(r.querySelector('.itemRiku').value) || 0,
      saya: parseFloat(r.querySelector('.itemSaya').value) || 0
    }));
    record = { items: items, rikuPaid:false, sayaPaid:false, removedDefaults: [] };
  }

  // Prevent skipping months: allow new save only if there are no saved months yet,
  // or if saving an edit/earlier month, or if saving exactly the month after the latest saved month.
  const savedKeys = Object.keys(monthlyRecords).filter(k=> monthlyRecords[k] && monthlyRecords[k].summary).sort();
  if(savedKeys.length > 0){
    const latest = savedKeys[savedKeys.length-1];
    // helper to get next month key
    const toDate = (k) => { const [y,m] = k.split('-').map(x=>parseInt(x,10)); return new Date(y,m-1,1); };
    const nextOfLatest = monthKey(new Date(toDate(latest).getFullYear(), toDate(latest).getMonth()+1, 1));
    if(key > latest && key !== nextOfLatest){
      alert('前月が保存されていないため、1か月飛ばしての新規保存はできません。まず前月を保存してください。');
      return;
    }
  }

  // compute totals and save
  let total = 0, rTotal = 0, sTotal = 0;
  record.items.forEach(it => { if(it.checked){ total += it.amount; rTotal += it.riku; sTotal += it.saya; }});
  record.summary = { total, rTotal, sTotal, savedAt: new Date().toISOString() };
  monthlyRecords[key] = record;
  saveStorage();
  renderRecords();
  renderChart();
  alert('保存しました: ' + key);
}

function renderRecords(){
  // show only months that have been explicitly saved (have a summary)
  const keys = Object.keys(monthlyRecords).filter(k=> monthlyRecords[k] && monthlyRecords[k].summary).sort().reverse();
  if(keys.length===0){ recordsEl.innerHTML = '<p>保存された実績はありません。</p>'; return; }
  let html = '<table style="width:100%; border-collapse:collapse;" border="1">';
  html += '<tr><th>月</th><th>合計</th><th>りく</th><th>さや</th><th>りく済</th><th>さや済</th><th>操作</th></tr>';
  keys.forEach(k=>{
    const r = monthlyRecords[k];
    const total = r.summary ? r.summary.total : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.amount:0),0) : 0);
    const rTotal = r.summary ? r.summary.rTotal : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.riku:0),0) : 0);
    const sTotal = r.summary ? r.summary.sTotal : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.saya:0),0) : 0);
    const rPaid = r.rikuPaid? 'checked':'';
    const sPaid = r.sayaPaid? 'checked':'';
    html += `<tr data-key="${k}"><td>${k}</td><td>¥${formatYen(total)}</td><td>¥${formatYen(rTotal)}</td><td>¥${formatYen(sTotal)}</td>`+
            `<td><input type="checkbox" class="rPaid" data-key="${k}" ${r.rikuPaid? 'checked':''}></td>`+
            `<td><input type="checkbox" class="sPaid" data-key="${k}" ${r.sayaPaid? 'checked':''}></td>`+
            `<td><button class="loadBtn" data-key="${k}">編集</button> <button class="delBtn" data-key="${k}">削除</button></td></tr>`;
  });
  html += '</table>';
  recordsEl.innerHTML = html;

  // attach events
  Array.from(recordsEl.querySelectorAll('.loadBtn')).forEach(b=> b.addEventListener('click', e=>{
    const k = b.dataset.key; loadMonthTo(k);
  }));
  Array.from(recordsEl.querySelectorAll('.delBtn')).forEach(b=> b.addEventListener('click', e=>{
    const k = b.dataset.key; if(confirm('削除しますか？')){ delete monthlyRecords[k]; saveStorage(); renderRecords(); renderChart(); }
  }));
  Array.from(recordsEl.querySelectorAll('.rPaid')).forEach(ch=> ch.addEventListener('change', e=>{
    const k = ch.dataset.key; monthlyRecords[k].rikuPaid = ch.checked; saveStorage();
  }));
  Array.from(recordsEl.querySelectorAll('.sPaid')).forEach(ch=> ch.addEventListener('change', e=>{
    const k = ch.dataset.key; monthlyRecords[k].sayaPaid = ch.checked; saveStorage();
  }));

  // adjust records area height to fit until window bottom; enable scrolling only if content taller than available space
  try{
    const table = recordsEl.querySelector('table');
    if(table){
        const recordsArea = recordsEl.parentElement; // the section wrapper
        const top = recordsArea.getBoundingClientRect().top;
        const available = window.innerHeight - top - 24; // space from top of records area to window bottom
        const cap = Math.round(window.innerHeight * 0.75); // cap height to 75% of viewport so records scrolls earlier
        const desired = Math.max(300, Math.min(available, cap)); // at least 300px
        const tableH = table.getBoundingClientRect().height;
        if(tableH > desired){
          recordsEl.style.maxHeight = desired + 'px';
          recordsEl.style.overflow = 'auto';
        } else {
          recordsEl.style.maxHeight = '';
          recordsEl.style.overflow = '';
        }
    }
  }catch(err){ console.warn('failed to adjust records height', err); }
}

// adjust on resize so records area stays within window
window.addEventListener('resize', ()=>{
  // if records are currently rendered, recompute height
  if(recordsEl && recordsEl.querySelector('table')){
    try{ const evt = new Event('adjustRecords'); renderRecords(); }catch(e){}
  }
  // recompute chart sizing on resize
  try{ renderChart(); }catch(e){}
});

function loadMonthTo(key){
  const [y,m] = key.split('-').map(x=>parseInt(x,10));
  currentMonth = new Date(y, m-1, 1);
  renderInputArea();
}

function renderChart(){
  // use only saved months (those with summary) for the chart (ascending)
  const savedKeys = Object.keys(monthlyRecords).filter(k=> monthlyRecords[k] && monthlyRecords[k].summary).sort();
  // no saved months -> show placeholder
  if(!savedKeys || savedKeys.length === 0){
    const chartNoDataEl = document.getElementById('chartNoData');
    if(chartInstance){ chartInstance.destroy(); chartInstance = null; }
    if(chartNoDataEl) chartNoDataEl.style.display = 'block';
    chartCanvas.style.display = 'none';
    // clear controls
    const cs = document.getElementById('chartStart'); if(cs) cs.innerHTML = '';
    return;
  }

  // populate controls and determine window start
  populateChartControls(savedKeys);
  if(chartStartIndex === null){
    chartStartIndex = Math.max(0, savedKeys.length - MAX_VISIBLE_MONTHS);
  }
  // clamp start index to valid range
  chartStartIndex = Math.max(0, Math.min(chartStartIndex, Math.max(0, savedKeys.length - 1)));
  const start = chartStartIndex;
  const keys = savedKeys.slice(start, start + MAX_VISIBLE_MONTHS);
  const labels = [];
  const totals = [];
  const perPerson = [];
  keys.forEach(k=>{
    const r = monthlyRecords[k];
    const total = r.summary ? r.summary.total : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.amount:0),0) : 0);
    const rTotal = r.summary ? r.summary.rTotal : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.riku:0),0) : 0);
    const sTotal = r.summary ? r.summary.sTotal : (r.items ? r.items.reduce((a,b)=>a+(b.checked?b.saya:0),0) : 0);
    labels.push(k);
    totals.push(Math.round(total));
    const avg = Math.round((rTotal + sTotal) / 2);
    perPerson.push(avg);
  });

  // toggle no-data message when there are no saved months
  const chartNoDataEl = document.getElementById('chartNoData');
  if(keys.length === 0){
    if(chartInstance){ chartInstance.destroy(); chartInstance = null; }
    if(chartNoDataEl) chartNoDataEl.style.display = 'block';
    chartCanvas.style.display = 'none';
    return;
  } else {
    if(chartNoDataEl) chartNoDataEl.style.display = 'none';
    chartCanvas.style.display = '';
  }

  try{
    const ctx = chartCanvas.getContext('2d');
    if(chartInstance) chartInstance.destroy();
    // determine sizing: px per point horizontally
    const chartWrapper = document.querySelector('.chart-wrapper');
    const scrollWrapper = chartWrapper ? chartWrapper.querySelector('.chart-scroll') : null;
    const wrapperWidth = chartWrapper ? chartWrapper.clientWidth : 800;
    const pxPer = 100; // per-month horizontal size (controls horizontal spacing)
    const maxVisibleMonths = 12;

    // desired canvas width: months * pxPer when many months, otherwise fill wrapper
      if(!initialChartSized){
        const recordsArea = document.getElementById('records-area');
        const inputArea = document.getElementById('input-area');
        if(recordsArea && inputArea && chartWrapper){
          try{
            const recBottom = Math.round(recordsArea.getBoundingClientRect().bottom);
            const inputBottom = Math.round(inputArea.getBoundingClientRect().bottom);
            const desired = recBottom - inputBottom - 20; // small gap
            if(desired > 300){ chartWrapper.style.height = desired + 'px'; }
          }catch(e){}
        }
        initialChartSized = true;
      }
      const desiredWidth = (labels.length > maxVisibleMonths) ? Math.round(labels.length * pxPer) : wrapperWidth;
    chartCanvas.width = desiredWidth;
    chartCanvas.style.width = desiredWidth + 'px';

    // set canvas height to match wrapper height so chart isn't vertically compressed
    const wrapperHeight = chartWrapper ? chartWrapper.clientHeight : 380;
    // keep a small padding and a reasonable minimum so labels remain visible
    const canvasHeight = Math.max(300, wrapperHeight - 40);
    chartCanvas.height = canvasHeight;
    chartCanvas.style.height = canvasHeight + 'px';

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label:'合計支出', data:totals, borderColor:'rgba(54,162,235,1)', backgroundColor:'rgba(54,162,235,0.1)', tension:0.2, fill:false },
          { label:'一人当たり', data:perPerson, borderColor:'rgba(75,192,192,1)', backgroundColor:'rgba(75,192,192,0.1)', tension:0.2, fill:false }
        ]
      },
      options: {
        responsive:false,
        maintainAspectRatio:false,
        plugins:{
          legend:{ position:'top' }
        },
        scales: {
          x: {
            display: true,
            ticks: {
              display: true,
              color:'#333',
              font:{size:12},
              maxRotation:0,
              autoSkip:true,
              padding:8,
              // ensure labels use the dataset labels (force display)
              callback: function(value, index, ticks){
                try{ return this.chart.data.labels[index] || value; }catch(e){ return value; }
              }
            },
            grid:{ display:false },
            title: { display:false }
          },
          y: { ticks:{ color:'#333', font:{size:12} }, grid:{ color:'#eee' } }
        },
        layout: { padding: { bottom: 100 } }
      }
    });
    // ensure horizontal overflow shown on scroll wrapper and prevent vertical scrolling
    if(scrollWrapper){
      // prevent vertical scrolling inside chart scroll wrapper and match wrapper height
      scrollWrapper.style.overflowY = 'hidden';
      scrollWrapper.style.height = (chartWrapper ? chartWrapper.clientHeight : 380) + 'px';

      // For many months: keep the visible window equal to chartWrapper width and
      // make the canvas wider so horizontal scroll appears (user can slide months)
      if(labels.length > maxVisibleMonths){
        const visibleWidth = Math.round(pxPer * maxVisibleMonths);
        const useWidth = (wrapperWidth > visibleWidth) ? visibleWidth : wrapperWidth;
        scrollWrapper.style.width = useWidth + 'px';
        scrollWrapper.style.overflowX = 'auto';
        // canvas already set to desiredWidth (months * pxPer)
      } else {
        // fill available width and hide horizontal overflow
        scrollWrapper.style.width = '100%';
        scrollWrapper.style.overflowX = 'hidden';
        chartCanvas.style.width = wrapperWidth + 'px';
        chartCanvas.width = wrapperWidth;
      }
    }
  }catch(err){ console.error('chart err', err); }
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// populate chart window controls (start select + prev/next)
let chartControlsInitialized = false;
function populateChartControls(savedKeys){
  const chartStart = document.getElementById('chartStart');
  const prev = document.getElementById('chartPrev');
  const next = document.getElementById('chartNext');
  if(!chartStart) return;
  // build options
  chartStart.innerHTML = '';
  for(let i=0;i<savedKeys.length;i++){
    const opt = document.createElement('option'); opt.value = String(i); opt.textContent = savedKeys[i];
    chartStart.appendChild(opt);
  }
  // set selected to current start index (clamped)
  const selIndex = Math.max(0, Math.min(chartStartIndex===null?Math.max(0, savedKeys.length - MAX_VISIBLE_MONTHS):chartStartIndex, savedKeys.length-1));
  chartStart.selectedIndex = selIndex;

  if(!chartControlsInitialized){
    if(prev) prev.addEventListener('click', ()=>{ chartStartIndex = Math.max(0, (chartStartIndex===null?0:chartStartIndex) - 1); renderChart(); });
    if(next) next.addEventListener('click', ()=>{ const len = Object.keys(monthlyRecords).filter(k=> monthlyRecords[k] && monthlyRecords[k].summary).length; chartStartIndex = Math.min(len-1, (chartStartIndex===null?0:chartStartIndex) + 1); renderChart(); });
    chartStart.addEventListener('change', ()=>{ chartStartIndex = parseInt(chartStart.value||'0',10); renderChart(); });
    chartControlsInitialized = true;
  }
}

// events
prevMonthBtn.addEventListener('click', ()=>{ currentMonth.setMonth(currentMonth.getMonth()-1); renderInputArea(); });
nextMonthBtn.addEventListener('click', ()=>{ currentMonth.setMonth(currentMonth.getMonth()+1); renderInputArea(); });
addFixedBtn.addEventListener('click', ()=> addNewRow(true));
addVarBtn.addEventListener('click', ()=> addNewRow(false));
saveMonthBtn.addEventListener('click', saveMonth);

// initial render
// Avoid auto-creating a month record on first load: temporarily suppress auto-create
suppressAutoCreate = true;
renderInputArea();
suppressAutoCreate = false;
renderRecords();
renderChart();
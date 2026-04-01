// ================================================================
//  CONSTANTS & PALETTE
// ================================================================
const DAYS = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
const SUBJ_COLORS = [
  '#38bdf8','#34d399','#fbbf24','#f87171',
  '#a78bfa','#2dd4bf','#fb923c','#f472b6',
  '#818cf8','#4ade80','#e879f9','#67e8f9'
];
const WIZ_STEPS = ['Szkoła','Budynki','Klasy','Przedmioty','Nauczyciele','Sale','Godziny','NI / Grupy'];
const LS = {
  STATE:    'pl_state',
  SCHED:    'pl_sched',
  THEME:    'pl_theme',
  WIZ:      'pl_wiz',      // autozapis kreatora
  CONSENT:  'pl_consent',  // akceptacja informacji o localStorage
};

// ================================================================
//  STATE
// ================================================================
let appState = null; // {name, year, hours[], classes[], subjects[], teachers[], rooms[]}
let schedData = {};  // {classKey: {dayIdx: {hourIdx: lessonObj}}}
// lessonObj: {subjectId, teacherId, roomId, groups[], note}
let _demoMode = false;
let _currentView = 'class';
let _dragData = null; // {classKey,dayIdx,hourIdx}

// modal state
let _mCtx = null; // {mode:'add'|'edit', classKey, dayIdx, hourIdx}

// ================================================================
//  STORAGE
// ================================================================
function loadAll() {
  try { appState = JSON.parse(localStorage.getItem(LS.STATE)||'null'); } catch(e){appState=null;}
  try { schedData = JSON.parse(localStorage.getItem(LS.SCHED)||'{}'); } catch(e){schedData={};}
  if(appState) { migrateAppState(); if(!appState.constraints) appState.constraints = {}; }
}

function migrateAppState() {
  // Zapewnij że wszystkie pola tablicowe istnieją
  if(!appState.buildings)   appState.buildings = [];
  if(!appState.teachers)    appState.teachers  = [];
  if(!appState.subjects)    appState.subjects  = [];
  if(!appState.classes)     appState.classes   = [];
  if(!appState.hours)       appState.hours     = [];
  // Migracja rooms: stary format to string, nowy to {id, name, buildingId}
  if(appState.rooms && appState.rooms.length && typeof appState.rooms[0] === 'string') {
    appState.rooms = appState.rooms.map((r,i) => ({id:'room'+i, name:r, buildingId:null}));
  }
  if(!appState.rooms) appState.rooms = [];
  // Zapewnij że każda sala ma id
  appState.rooms.forEach((r,i) => { if(!r.id) r.id = 'room'+Date.now()+i; });
  if(!appState.duties) appState.duties = [];
  // Zapewnij że każda klasa ma tablice groups i homeRooms
  sortByName(appState.classes).forEach(c => {
    if(!c.groups)    c.groups    = [];
    if(!c.homeRooms) c.homeRooms = [];
  });
  // Zapewnij że każdy nauczyciel ma subjects, assignments i nowe pola
  sortTeachers(appState.teachers).forEach(t => {
    if(!t.subjects)           t.subjects           = [];
    if(!t.assignments)        t.assignments        = [];
    if(!t.individualTeaching) t.individualTeaching = [];
    (t.individualTeaching||[]).forEach(i => { if(i.students===undefined) i.students=1; });
    if(t.hoursTotal === undefined) t.hoursTotal = 0;
    if(t.hoursExtra === undefined) t.hoursExtra = 0;
    if(t.employment  === undefined) t.employment  = 'full'; // 'full'|'half'|'other'
    if(t.employmentFraction === undefined) t.employmentFraction = 1.0;
  });
  // Zapewnij że każdy budynek ma floors
  appState.buildings.forEach(b => {
    if(!b.floors) b.floors = [];
  });
  // Zapewnij że każda sala ma type, capacity, locationStr
  // Nowe pola szkoły
  if(!appState.schoolYear)   appState.schoolYear   = appState.year||'';
  if(!appState.activeSem)    appState.activeSem     = 1;
  if(!appState.schoolWindow) appState.schoolWindow  = {mon:[null,null],tue:[null,null],wed:[null,null],thu:[null,null],fri:[null,null]};
  // Nowe pola klas
  (appState.classes||[]).forEach(c => {
    if(!c.optionalSubjects) c.optionalSubjects = [];
    // Migruj grupy z string[] na object[]
    if(Array.isArray(c.groups)) {
      c.groups = c.groups.map(g =>
        typeof g === 'string'
          ? {id:'grp'+Math.random().toString(36).slice(2,9), name:g, type:'group', studentCount:0, teacherId:null, subjects:[]}
          : {...g, subjects: g.subjects||[]}
      );
    }
    if(!c.studentCount)     c.studentCount = 0;
    (c.optionalSubjects||[]).forEach(o => { if(!o.mergeWith) o.mergeWith = []; });
  });
  (appState.subjects||[]).forEach(s => {
    if(s.level    === undefined) s.level    = '';
    if(s.duration === undefined) s.duration = 'year';
    if(!s.classes) s.classes = [];
  });
  appState.rooms.forEach(r => {
    if(!r.type)     r.type     = 'full';
    if(r.capacity === undefined) r.capacity = 0;
    if(!r.locationStr) r.locationStr = '';
    if(!r.custodians) r.custodians = r.custodianId ? [r.custodianId] : [];
    if(!r.preferredSubjects) r.preferredSubjects = [];
  });
  // Zapewnij że każde miejsce dyżuru ma nowy format tablicowy
  appState.duties.forEach(d => {
    if(!d.places) d.places = {};
    ['mon','tue','wed','thu','fri'].forEach(k => {
      const raw = d.places[k];
      if(!Array.isArray(raw)) {
        d.places[k] = raw ? [{place: raw, teacherId:''}] : [];
      }
    });
  });
}
function persistAll() {
  if(_demoMode) return;
  localStorage.setItem(LS.STATE, JSON.stringify(appState));
  localStorage.setItem(LS.SCHED, JSON.stringify(schedData));
}

// ── Undo/Redo ──
const _undoStack = [];
const _redoStack = [];
const _MAX_HIST = 50;
let _undoBatch = null; // batch changes from a single operation

function undoBatchStart() {
  if(_undoBatch !== null) return;
  _undoBatch = {}; // {key: oldValue|null}
}

function undoBatchEnd() {
  if(!_undoBatch) return;
  if(Object.keys(_undoBatch).length > 0) {
    _undoStack.push(_undoBatch);
    if(_undoStack.length > _MAX_HIST) _undoStack.shift();
    _redoStack.length = 0;
  }
  _undoBatch = null;
  undoUpdateBtns();
}

function undoRecordChange(key, oldVal) {
  if(!_undoBatch) return;
  if(!(key in _undoBatch)) _undoBatch[key] = oldVal;
}

function undoExec() {
  if(!_undoStack.length) return;
  const batch = _undoStack.pop();
  const redoBatch = {};
  for(const key in batch) {
    redoBatch[key] = schedData[key] !== undefined ? JSON.parse(JSON.stringify(schedData[key])) : undefined;
    if(batch[key] === undefined || batch[key] === null) {
      delete schedData[key];
    } else {
      schedData[key] = batch[key];
    }
  }
  _redoStack.push(redoBatch);
  invalidateSlotIndex();
  persistAll();
  renderCurrentView();
  detectAndShowConflicts();
  undoUpdateBtns();
}

function redoExec() {
  if(!_redoStack.length) return;
  const batch = _redoStack.pop();
  const undoBatch = {};
  for(const key in batch) {
    undoBatch[key] = schedData[key] !== undefined ? JSON.parse(JSON.stringify(schedData[key])) : undefined;
    if(batch[key] === undefined || batch[key] === null) {
      delete schedData[key];
    } else {
      schedData[key] = batch[key];
    }
  }
  _undoStack.push(undoBatch);
  invalidateSlotIndex();
  persistAll();
  renderCurrentView();
  detectAndShowConflicts();
  undoUpdateBtns();
}

function undoUpdateBtns() {
  document.querySelectorAll('.undo-btn').forEach(btn => btn.disabled = !_undoStack.length);
  document.querySelectorAll('.redo-btn').forEach(btn => btn.disabled = !_redoStack.length);
}

function initUndoKeys() {
  document.addEventListener('keydown', e => {
    if((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      const tag = (e.target.tagName||'').toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select'||e.target.isContentEditable) return;
      e.preventDefault();
      undoExec();
    }
    if((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      const tag = (e.target.tagName||'').toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select'||e.target.isContentEditable) return;
      e.preventDefault();
      redoExec();
    }
  });
}

// ================================================================
//  INIT
// ================================================================
function init() {
  loadAll();
  applyTheme();
  initConsent();
  initUndoKeys();
  if(appState) {
    migrateEdgePosition();
    showApp();
  } else {
    showWelcome();
  }
}

// Migracja: przenosi position='edge' z optionalSubjects do edgePosition na grupach
function migrateEdgePosition() {
  if(!appState) return;
  (appState.classes||[]).forEach(cls => {
    (cls.optionalSubjects||[]).filter(o=>o.position==='edge').forEach(o => {
      // Znajdź grupę tej klasy której nauczyciel prowadzi ten przedmiot
      const tch = (appState.teachers||[]).find(t=>
        (t.assignments||[]).some(a=>a.classId===cls.id&&a.subjectId===o.subjId)
      );
      if(tch) {
        const grp = (cls.groups||[]).find(g=>
          (g.type==='group'||g.type==='small') && (!g.teacherId||g.teacherId===tch.id)
        );
        if(grp) grp.edgePosition = true;
      }
    });
  });
}

function showWelcome() {
  document.getElementById('welcomeScreen').classList.add('show');
  wlInit(); // wypełnij kartę Kontynuuj i ustaw motyw
}

function updateTopbarInfo() {
  const el = document.getElementById('topbarSchoolInfo');
  if(!el || !appState) return;
  el.innerHTML = appState.schoolYear||appState.year
    ? `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(appState.name||'')}</span>
       <span style="color:var(--accent)">${escapeHtml(appState.schoolYear||appState.year||'')} · Sem.${appState.activeSem||1}</span>`
    : '';
}

function showApp() {
  document.getElementById('welcomeScreen').classList.remove('show');
  document.getElementById('wizardOverlay').classList.remove('show');
  const app = document.getElementById('appRoot');
  app.classList.add('show');
  populateSelects();
  populateRoomBuildingFilter();
  renderCurrentView();
  detectAndShowConflicts();
}

// ================================================================
//  WELCOME ACTIONS
// ================================================================

function wlSetTheme(t) {
  // Ten sam mechanizm co applyTheme/toggleTheme
  document.body.classList.toggle('light', t==='light');
  localStorage.setItem(LS.THEME, t);
  // Odśwież przycisk w appRoot
  const appBtn = document.getElementById('themeBtn');
  if(appBtn) appBtn.textContent = t==='light' ? '🌙' : '☀️';
  // Odśwież przyciski na welcome screen
  document.querySelectorAll('.wl-theme-btn').forEach(b=>b.classList.remove('active'));
  const wlBtn = document.getElementById(t==='dark'?'wlThemeDark':'wlThemeLight');
  if(wlBtn) wlBtn.classList.add('active');
}

function wlInit() {
  // Przywróć motyw używając tego samego klucza co applyTheme
  const saved = localStorage.getItem(LS.THEME)||'dark';
  wlSetTheme(saved);

  // Sprawdź czy istnieje zapisany plan
  try {
    const raw = localStorage.getItem('pl_state');
    if(raw) {
      const st = JSON.parse(raw);
      const sec = document.getElementById('wlContinueSection');
      const title = document.getElementById('wlContinueTitle');
      const meta  = document.getElementById('wlContinueMeta');
      const div   = document.getElementById('wlDivider');
      if(sec && st && st.name) {
        title.textContent = st.name + (st.year ? ' · ' + st.year : '');
        const cls  = (st.classes||[]).length;
        const tch  = (st.teachers||[]).length;
        const rooms= (st.rooms||[]).length;
        meta.textContent = `${cls} klas · ${tch} nauczycieli · ${rooms} sal`;
        sec.style.display = '';
        if(div) div.style.display = '';
      }
    }
  } catch(e) {}

  // Sprawdź autozapis kreatora
  try {
    const w = JSON.parse(localStorage.getItem(LS.WIZ)||'null');
    const rezCard = document.getElementById('wlResumeCard');
    const rezDesc = document.getElementById('wlResumeDesc');
    if(w && rezCard) {
      const STEPS = ['Szkoła','Budynki','Klasy','Przedmioty','Nauczyciele','Sale','Godziny'];
      const stepName = STEPS[w.step]||'';
      rezCard.style.display='';
      if(rezDesc) rezDesc.textContent = 'Krok '+(w.step+1)+': '+stepName+(w.data?.name?' — '+w.data.name:'');
    }
  } catch(e) {}
}

function wlResume() {
  document.getElementById('welcomeScreen').classList.remove('show');
  startWizard(true);
}

function wlStartNew() {
  document.getElementById('welcomeScreen').classList.remove('show');
  startWizard();
}

function wlContinue() {
  loadAll();
  if(appState) showApp();
}

function wlImport() {
  document.getElementById('importFileInput').click();
}

function wlDemo() {
  _demoMode = true;
  appState = buildDemoState();
  schedData = buildDemoSched();
  document.getElementById('welcomeScreen').classList.remove('show');
  showApp();
  notify('Tryb demo — zmiany nie są zapisywane');
}

function openSettings() {
  document.getElementById('welcomeScreen').classList.add('show');
  document.getElementById('appRoot').classList.remove('show');
  wlInit(); // odśwież stan karty Kontynuuj
}

// ================================================================
//  WIZARD
// ================================================================
let wStep = 0;
let wData = { name:'', year:'', buildings:[], classes:[], subjects:[], teachers:[], rooms:[], hours:[], niStudents:[] };

function startWizard(resume=false) {
  if(resume) {
    // Przywróć zapisany stan
    try {
      const saved = JSON.parse(localStorage.getItem(LS.WIZ)||'null');
      if(saved) { wStep=saved.step||0; wData=saved.data; }
    } catch(_) { wStep=0; }
  } else {
    wStep = 0;
    wData = { name:'', year:'', buildings:[], classes:[], subjects:[], teachers:[], rooms:[], hours:[], niStudents:[] };
    localStorage.removeItem(LS.WIZ);
  }
  document.getElementById('wizardOverlay').classList.add('show');
  renderWizStep();
}

function wizSave() {
  try {
    localStorage.setItem(LS.WIZ, JSON.stringify({step:wStep, data:wData, ts:Date.now()}));
    const el = document.getElementById('wizAutoSaveInfo');
    if(el) {
      const now = new Date();
      el.textContent = '💾 Autozapis ' + now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    }
  } catch(_) {}
}

function renderWizStepsIndicator() {
  const el = document.getElementById('wizSteps');
  el.innerHTML = WIZ_STEPS.map((s,i) => `
    <div class="ws ${i===wStep?'active':i<wStep?'done':''}">
      <div class="ws-num">${i<wStep?'✓':i+1}</div>
      <div class="ws-label">${s}</div>
      ${i<WIZ_STEPS.length-1?'<div class="ws-line"></div>':''}
    </div>
  `).join('');
}

function renderWizStep() {
  renderWizStepsIndicator();
  // Przycisk pomocy w headerze kreatora
  const autoSaveEl = document.getElementById('wizAutoSaveInfo');
  if(autoSaveEl) {
    autoSaveEl.innerHTML = `<button onclick="openWizHelp(${0}+wStep)"
      style="background:none;border:1px solid var(--border);border-radius:6px;
             padding:2px 8px;font-size:.7rem;cursor:pointer;color:var(--text-m)">
      ❓ Pomoc
    </button>`;
  }
  const body = document.getElementById('wizBody');
  switch(wStep) {
    case 0: body.innerHTML = wizStep0(); break;
    case 1: body.innerHTML = wizStep1(); break;
    case 2: body.innerHTML = wizStep2(); break;
    case 3: body.innerHTML = wizStep3(); break;
    case 4: body.innerHTML = wizStep4(); break;
    case 5: body.innerHTML = wizStep5(); break;
    case 6: body.innerHTML = wizStep6(); break;
    case 7: body.innerHTML = wizStep7(); break;
  }
}

// Step 0: School info
function wizStep0() {
  return `<div class="wcard">
    <div class="wcard-title">Informacje o szkole</div>
    <div class="wfield"><label>Nazwa szkoły</label>
      <input class="winput" id="wName" value="${escapeHtml(wData.name)}" placeholder="np. Szkoła Podstawowa nr 1"></div>
    <div class="wfield"><label>Rok szkolny</label>
      <input class="winput" id="wYear" value="${escapeHtml(wData.year||currentSchoolYear())}" placeholder="2025/2026"></div>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 1: Buildings / Locations
function wizStep1() {
  const BCOLORS = ['#38bdf8','#34d399','#fbbf24','#f87171','#a78bfa','#2dd4bf','#fb923c','#f472b6'];
  const rows = wData.buildings.map((b,i) => {
    const swatches = BCOLORS.map(c =>
      `<div class="color-swatch ${b.color===c?'sel':''}" style="background:${c};width:16px;height:16px" onclick="wSetBldColor(${i},'${c}')"></div>`
    ).join('');
    const floors = (b.floors||[]);
    const floorsHtml = floors.map((fl,fi) => `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0;padding-left:12px">
        <span style="font-size:.72rem;font-weight:700;flex:1">🏢 ${escapeHtml(fl.label)}</span>
        <span style="font-size:.68rem;color:var(--text-m)">${fl.segments.map(s=>escapeHtml(s.label)).join(', ')||'brak segmentów'}</span>
        <input class="winput" id="wSegInp_${i}_${fi}" placeholder="+ Segment" style="width:130px;padding:3px 6px;font-size:.72rem"
          onkeydown="if(event.key==='Enter')wAddSegment(${i},${fi})">
        <button class="tag-add-btn" style="padding:3px 8px;font-size:.68rem" onclick="wAddSegment(${i},${fi})">+</button>
        ${fl.segments.map((s,si)=>`<span class="tag" style="font-size:.68rem;padding:2px 6px">${s.label}
          <span class="tag-del" onclick="wRemoveSegment(${i},${fi},${si})">×</span></span>`).join('')}
        <span class="tag-del" onclick="wRemoveFloor(${i},${fi})">✕</span>
      </div>`).join('');
    return `<div class="subj-row" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;align-items:center;gap:8px">
        <div class="cdot" style="background:${b.color||'#38bdf8'}"></div>
        <div class="subj-name" style="flex:1">${escapeHtml(b.name)}</div>
        <div style="font-size:.72rem;color:var(--text-m);flex:2">${escapeHtml(b.address||'')}</div>
        <div class="color-pick">${swatches}</div>
        <input class="winput" id="wFloorInp_${i}" placeholder="+ Piętro / skrzydło"
          style="width:150px;padding:3px 6px;font-size:.72rem"
          onkeydown="if(event.key==='Enter')wAddFloor(${i})">
        <button class="tag-add-btn" style="padding:3px 8px;font-size:.68rem" onclick="wAddFloor(${i})">+ Piętro</button>
        <span class="tag-del" onclick="wRemoveBuilding(${i})">×</span>
      </div>
      ${floorsHtml}
    </div>`;
  }).join('');

  return `<div class="wcard">
    <div class="wcard-title">Budynki i lokalizacje zajęć</div>
    <p style="font-size:.82rem;color:var(--text-m);margin-bottom:16px;line-height:1.5">
      Wpisz wszystkie miejsca, w których szkoła realizuje zajęcia. Do każdego budynku możesz od razu
      dodać <strong>piętra</strong> i <strong>segmenty</strong> — będą służyć do przypisywania sal i miejsc dyżurów.
    </p>
    <div class="wfield"><label>Adres / siedziba główna szkoły</label>
      <input class="winput" id="wMainAddress" value="${wData.mainAddress||''}" placeholder="np. ul. Szkolna 1, Warszawa"></div>
    <div class="wrow" style="margin-top:4px">
      <div class="wfield"><label>Nazwa budynku / lokalizacji</label>
        <input class="winput" id="wBldName" placeholder="np. Budynek A, Hala sportowa, Basen"></div>
      <div class="wfield"><label>Adres (opcjonalnie)</label>
        <input class="winput" id="wBldAddress" placeholder="np. ul. Sportowa 5"></div>
    </div>
    <div class="wfield"><label>Uwagi (opcjonalnie)</label>
      <input class="winput" id="wBldNote" placeholder="np. dojazd autobusem, 15 min od szkoły"></div>
    <button class="tag-add-btn" style="width:100%;margin-bottom:12px" onclick="wAddBuilding()">+ Dodaj lokalizację</button>
    ${rows}
    ${!wData.buildings.length ? `<div style="font-size:.78rem;color:var(--text-d);text-align:center;padding:8px 0">
      Brak dodanych lokalizacji — krok opcjonalny, możesz kontynuować.
    </div>` : ''}
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

function wizStep2() {
  const tags = wData.classes.map((c,i) => `
    <div class="tag">
      <span>${escapeHtml(c.name)}${c.groups&&c.groups.length?' (gr: '+c.groups.map(g=>typeof g==='object'?escapeHtml(g.name):escapeHtml(g)).join(', ')+')':''}</span>
      <span class="tag-del" onclick="wRemoveClass(${i})">×</span>
    </div>`).join('');
  return `<div class="wcard">
    <div class="wcard-title">Klasy</div>
    <div class="wrow">
      <div class="wfield"><label>Nazwa klasy</label><input class="winput" id="wClassName" placeholder="np. 1a, 2b, 3c"></div>
      <div class="wfield"><label>Grupy (opcjonalnie, rozdziel przecinkami)</label><input class="winput" id="wClassGroups" placeholder="np. gr1, gr2"></div>
    </div>
    <button class="tag-add-btn" style="width:100%;margin-bottom:10px" onclick="wAddClass()">+ Dodaj klasę</button>
    <div class="tag-list">${tags}</div>
    <p class="import-hint">Możesz też wpisać wiele klas naraz w formacie: <em>1a;1b;2a;2b</em></p>
    <div class="tag-add-row">
      <input class="winput" id="wClassBulk" placeholder="1a;1b;2a;2b — masowe dodawanie">
      <button class="tag-add-btn" onclick="wAddClassBulk()">Importuj</button>
    </div>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 2: Subjects
function wizStep3() {
  const rows = wData.subjects.map((s,i) => {
    const swatches = SUBJ_COLORS.map(c => 
      `<div class="color-swatch ${s.color===c?'sel':''}" style="background:${c}" onclick="wSetSubjColor(${i},'${c}')"></div>`
    ).join('');
    return `<div class="subj-row">
      <div class="cdot" style="background:${s.color}"></div>
      <div class="subj-name">${escapeHtml(s.name)}</div>
      <div class="subj-abbr">${escapeHtml(s.abbr)}</div>
      <div class="color-pick">${swatches}</div>
      <span class="tag-del" onclick="wRemoveSubj(${i})">×</span>
    </div>`;
  }).join('');
  return `<div class="wcard">
    <div class="wcard-title">Przedmioty</div>
    <div class="wrow">
      <div class="wfield"><label>Nazwa przedmiotu</label><input class="winput" id="wSubjName" placeholder="np. Matematyka"></div>
      <div class="wfield"><label>Skrót</label><input class="winput" id="wSubjAbbr" placeholder="np. MAT" maxlength="5"></div>
    </div>
    <button class="tag-add-btn" style="width:100%;margin-bottom:10px" onclick="wAddSubj()">+ Dodaj przedmiot</button>
    ${rows}
    <p class="import-hint">Szybkie dodawanie: <em>Matematyka;Język polski;Historia;Biologia</em></p>
    <div class="tag-add-row">
      <input class="winput" id="wSubjBulk" placeholder="Matematyka;Fizyka;Chemia — masowe dodawanie">
      <button class="tag-add-btn" onclick="wAddSubjBulk()">Importuj</button>
    </div>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 3: Teachers
function wizStep4() {
  const rows = wData.teachers.map((t,i) => `
    <div class="subj-row">
      <div class="subj-name" style="flex:2">${escapeHtml(t.first)} ${escapeHtml(t.last)}</div>
      <div class="subj-abbr" style="font-family:var(--mono)">${escapeHtml(t.abbr)}</div>
      ${t.hoursTotal ? `<span style="font-size:.7rem;color:var(--text-m);font-family:var(--mono)">${t.hoursTotal}${t.hoursExtra?'+'+t.hoursExtra:''} godz.</span>` : ''}
      ${t.employment&&t.employment!=='full' ? `<span style="font-size:.68rem;padding:1px 6px;border-radius:8px;background:var(--orange)22;color:var(--orange)">${t.employment==='half'?'½ etatu':Math.round((t.employmentFraction||1)*100)+'%'}</span>` : ''}
      <span class="tag-del" onclick="wRemoveTeacher(${i})">×</span>
    </div>`).join('');
  return `<div class="wcard">
    <div class="wcard-title">Nauczyciele</div>
    <div class="wrow">
      <div class="wfield"><label>Imię</label><input class="winput" id="wTFirst" placeholder="Anna"></div>
      <div class="wfield"><label>Nazwisko</label><input class="winput" id="wTLast" placeholder="Kowalska" oninput="wAutoAbbr()"></div>
      <div class="wfield"><label>Skrót</label><input class="winput" id="wTAbbr" placeholder="AKow" maxlength="6"></div>
    </div>
    <div class="wrow">
      <div class="wfield"><label>Pensum (godz./tydz.)</label>
        <input class="winput" id="wTHoursTotal" type="number" min="0" max="40" placeholder="np. 18"></div>
      <div class="wfield"><label>Nadgodziny stałe</label>
        <input class="winput" id="wTHoursExtra" type="number" min="0" max="20" placeholder="np. 2"
          title="Godziny ponad pensum wynikające z przydziału rocznego"></div>
    </div>
    <button class="tag-add-btn" style="width:100%;margin-bottom:10px" onclick="wAddTeacher()">+ Dodaj nauczyciela</button>
    ${rows}
    <p class="import-hint">Masowe: <em>Anna;Kowalska;AKow;18;0</em> — imię;nazwisko;skrót;pensum;nadgodz.</p>
    <textarea class="wtextarea" id="wTeacherBulk" placeholder="Anna;Kowalska;AKow;18;0&#10;Jan;Nowak;JNow;18;2&#10;Maria;Wiśniewska;MWis;20;0"></textarea>
    <button class="tag-add-btn" style="width:100%;margin-top:6px" onclick="wAddTeacherBulk()">Importuj z pola</button>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 5: Rooms
function wizStep5() {
  const hasBld = wData.buildings.length > 0;
  const bldOptions = hasBld
    ? '<option value="">— budynek główny / nieokreślony —</option>' +
      wData.buildings.map((b,i)=>`<option value="${i}">${escapeHtml(b.name)}</option>`).join('')
    : '';

  const rows = wData.rooms.map((r,i) => {
    const bld = (r.buildingId !== null && r.buildingId !== undefined && r.buildingId !== '')
      ? wData.buildings[parseInt(r.buildingId)] : null;
    const rt = ROOM_TYPES[r.type]||ROOM_TYPES.full;
    return `<div class="subj-row">
      ${bld ? `<div class="cdot" style="background:${bld.color||'#888'}"></div>` : '<div class="cdot" style="background:var(--border)"></div>'}
      <div class="subj-name">${escapeHtml(r.name)}</div>
      <span style="font-size:.7rem">${rt.icon}</span>
      <div style="font-size:.72rem;color:var(--text-m);flex:2">${bld?escapeHtml(bld.name):''}${r.capacity?' · '+r.capacity+' os.':''}</div>
      <span class="tag-del" onclick="wRemoveRoom(${i})">×</span>
    </div>`;
  }).join('');

  const typeOpts = Object.entries(ROOM_TYPES).map(([k,v])=>
    `<option value="${k}">${v.icon} ${v.label}</option>`).join('');

  return `<div class="wcard">
    <div class="wcard-title">Sale lekcyjne</div>
    <div class="wrow">
      <div class="wfield" style="flex:2"><label>Nazwa sali</label>
        <input class="winput" id="wRoomInput" placeholder="np. 101, Sala gimnastyczna, Basen" onkeydown="if(event.key==='Enter')wAddRoom()"></div>
      <div class="wfield"><label>Typ sali</label>
        <select class="wselect" id="wRoomType">${typeOpts}</select></div>
      <div class="wfield" style="flex:.8"><label>Pojemność</label>
        <input class="winput" id="wRoomCapacity" type="number" min="1" max="60" placeholder="os."></div>
    </div>
    ${hasBld ? `<div class="wrow">
      <div class="wfield"><label>Budynek / lokalizacja</label>
        <select class="wselect" id="wRoomBuilding">${bldOptions}</select></div>
    </div>` : ''}
    <button class="tag-add-btn" style="width:100%;margin-bottom:10px" onclick="wAddRoom()">+ Dodaj salę</button>
    ${rows}
    <p class="import-hint">Masowe (tylko nazwy): <em>101;102;103;Aula</em> — typ i pojemność uzupełnisz w ustawieniach</p>
    <div class="tag-add-row" style="margin-top:6px">
      <input class="winput" id="wRoomBulk" placeholder="101;102;103;Aula">
      <button class="tag-add-btn" onclick="wAddRoomBulk()">Importuj</button>
    </div>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 5: Hours
function wizStep6() {
  const tags = wData.hours.map((h,i) => `
    <div class="tag">
      <span>${h.num}. ${h.start}–${h.end}</span>
      <span class="tag-del" onclick="wRemoveHour(${i})">×</span>
    </div>`).join('');
  return `<div class="wcard">
    <div class="wcard-title">Godziny lekcyjne</div>
    <div class="wrow">
      <div class="wfield"><label>Nr lekcji</label><input class="winput" id="wHNum" type="number" min="1" max="15" placeholder="1" style="width:70px"></div>
      <div class="wfield"><label>Początek</label><input class="winput" id="wHStart" type="time" value="08:00"></div>
      <div class="wfield"><label>Koniec</label><input class="winput" id="wHEnd" type="time" value="08:45"></div>
    </div>
    <button class="tag-add-btn" style="width:100%;margin-bottom:10px" onclick="wAddHour()">+ Dodaj godzinę</button>
    <div class="tag-list">${tags}</div>
    <p class="import-hint">Lub wygeneruj automatycznie:</p>
    <div class="wrow" style="margin-top:6px">
      <div class="wfield"><label>Lekcja 1 od</label><input class="winput" id="wHAutoFrom" type="time" value="08:00"></div>
      <div class="wfield"><label>Czas lekcji (min)</label><input class="winput" id="wHAutoLen" type="number" value="45" min="30" max="90"></div>
      <div class="wfield"><label>Przerwa (min)</label><input class="winput" id="wHAutoBreak" type="number" value="10" min="0" max="30"></div>
      <div class="wfield"><label>Liczba lekcji</label><input class="winput" id="wHAutoCount" type="number" value="8" min="1" max="12"></div>
    </div>
    <button class="tag-add-btn" style="width:100%;margin-top:6px" onclick="wGenerateHours()">⚡ Generuj godziny</button>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizNext()">Dalej →</button>
  </div>`;
}

// Step 7: NI / Grupy
function wizStep7() {
  // Inicjuj niStudents jeśli nie istnieje
  if(!wData.niStudents) wData.niStudents = [];

  const studs = wData.niStudents||[];
  const subjects = wData.subjects||[];
  const teachers = wData.teachers||[];
  const classes  = wData.classes||[];

  const rows = studs.map((s,i) => {
    const cls  = classes.find(c=>c.id===s.classId);
    const hours= (s.subjects||[]).filter(r=>r.mode==='indiv').reduce((h,r)=>h+(r.hours||0),0);
    const niSubjs = (s.subjects||[]).filter(r=>r.mode==='indiv')
      .map(r=>{ const subj=subjects.find(ss=>ss.id===r.subjId); return escapeHtml(subj?.abbr||'?'); }).join(', ');
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
      background:var(--s2);border-radius:7px;border:1px solid var(--border);margin-bottom:5px">
      <span style="font-weight:600;flex:1">👤 ${escapeHtml(s.name)}</span>
      ${cls?`<span style="font-size:.7rem;color:var(--text-m)">${escapeHtml(cls.name)}</span>`:''}
      ${niSubjs?`<span style="font-size:.7rem;color:var(--accent)">${niSubjs}</span>`:''}
      ${hours?`<span style="font-size:.7rem;font-family:var(--mono);color:var(--accent)">${hours}h</span>`:''}
      <button onclick="wNIRemove(${i})"
        style="background:none;border:none;cursor:pointer;color:var(--text-d);font-size:.9rem">×</button>
    </div>`;
  }).join('');

  return `<div class="wcard">
    <div class="wcard-title">Nauczanie indywidualne i grupy do 5 os. <span style="font-weight:400;font-size:.72rem;color:var(--text-m)">(opcjonalne — możesz uzupełnić po stworzeniu planu)</span></div>
    <p style="font-size:.78rem;color:var(--text-m);margin-bottom:14px;line-height:1.5">
      Dodaj uczniów objętych nauczaniem indywidualnym lub uczęszczających na zajęcia w małych grupach.
      Dla każdego ucznia możesz określić które przedmioty realizuje indywidualnie a które z klasą.
    </p>
    ${rows || `<div style="padding:16px;text-align:center;color:var(--text-d);
      border:1px dashed var(--border);border-radius:8px;font-size:.78rem;margin-bottom:12px">
      Brak uczniów NI — możesz dodać ich tutaj lub później w Ustawieniach
    </div>`}
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="winput" id="wNIName" placeholder="Imię Nazwisko ucznia" style="flex:2">
      <select class="wselect" id="wNIClass" style="flex:1">
        <option value="">— klasa —</option>
        ${classes.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <button class="tag-add-btn" onclick="wNIAdd()">+ Dodaj</button>
    </div>
    <p style="font-size:.7rem;color:var(--text-d);margin-top:8px">
      💡 Szczegóły (które przedmioty NI, nauczyciel, godziny) ustaw po stworzeniu planu
      w <strong>Ustawieniach → 👤 NI / Grupy</strong>.
    </p>
  </div>
  <div class="wbtn-row">
    <button class="wbtn wbtn-ghost" onclick="wizPrev()">← Wstecz</button>
    <button class="wbtn wbtn-primary" onclick="wizFinish()">✓ Utwórz plan</button>
  </div>`;
}

function wNIAdd() {
  const name = document.getElementById('wNIName').value.trim();
  const classId = document.getElementById('wNIClass').value || null;
  if(!name) { notify('Podaj imię ucznia'); return; }
  if(!wData.niStudents) wData.niStudents = [];
  wData.niStudents.push({
    id: 'ni_' + Date.now() + Math.random().toString(36).slice(2,6),
    name, classId, form: 'indywidualne', studentCount: 1, subjects: []
  });
  document.getElementById('wNIName').value = '';
  renderWizStep();
}

function wNIRemove(i) {
  if(wData.niStudents) wData.niStudents.splice(i, 1);
  renderWizStep();
}

// Wizard navigation
function wizNext() {
  if(!wizCollectStep()) return;
  wStep = Math.min(wStep+1, WIZ_STEPS.length-1);
  wizSave();
  renderWizStep();
}
function wizPrev() {
  wizCollectStep(); // zbierz dane aktualnego kroku przed cofnięciem
  wStep = Math.max(wStep-1, 0);
  wizSave();
  renderWizStep();
}

function wizCollectStep() {
  switch(wStep) {
    case 0:
      wData.name = document.getElementById('wName').value.trim();
      wData.year = document.getElementById('wYear').value.trim();
      if(!wData.name) { notify('Podaj nazwę szkoły'); return false; }
      break;
    case 1:
      // Budynki — opcjonalne, zbieramy przez wAddBuilding, tu tylko zapisujemy opis głównego
      wData.mainAddress = (document.getElementById('wMainAddress')||{}).value||'';
      break;
    case 2:
      if(!wData.classes.length) { notify('Dodaj co najmniej jedną klasę'); return false; }
      break;
    case 3:
      if(!wData.subjects.length) { notify('Dodaj co najmniej jeden przedmiot'); return false; }
      break;
    case 4:
      if(!wData.teachers.length) { notify('Dodaj co najmniej jednego nauczyciela'); return false; }
      break;
  }
  return true;
}

function wizFinish() {
  if(!wData.hours.length) { notify('Dodaj co najmniej jedną godzinę lekcyjną'); return; }
  // Build appState
  appState = {
    name: wData.name,
    year: wData.year,
    mainAddress: wData.mainAddress||'',
    buildings: wData.buildings.map((b,i)=>({id:'bld'+i, name:b.name, address:b.address, color:b.color||SUBJ_COLORS[i%SUBJ_COLORS.length], note:b.note||'', floors:b.floors||[]})),
    classes: wData.classes.map((c,i)=>({
      id:'cls'+i, name:c.name,
      groups:(c.groups||[]).map((g,gi)=>typeof g==='string'
        ? {id:'grp'+i+'_'+gi, name:g, type:'group', studentCount:0, teacherId:null, subjects:[], linkedWith:[]}
        : g),
      studentCount:c.studentCount||0,
      homeroomTeacherId:null, homeRooms:[],
      optionalSubjects:[]
    })),
    subjects: wData.subjects.map((s,i)=>({
      id:'subj'+i, name:s.name, abbr:s.abbr,
      color:s.color||SUBJ_COLORS[i%SUBJ_COLORS.length],
      duration:'year', classes:[], level:''
    })),
    teachers: wData.teachers.map((t,i)=>({
      id:'tch'+i, first:t.first, last:t.last, abbr:t.abbr,
      hoursTotal:t.hoursTotal||0, hoursExtra:t.hoursExtra||0,
      employment:t.employment||'full',
      employmentFraction:t.employmentFraction||1,
      subjects:[], assignments:[], individualTeaching:[]
    })),
    rooms: wData.rooms.map((r,i)=>({
      id:'room'+i, name:r.name, type:r.type||'full',
      capacity:r.capacity||0, note:r.note||'',
      buildingId:r.buildingId!=null?'bld'+parseInt(r.buildingId):null,
      custodians:[], preferredSubjects:[]
    })),
    hours: wData.hours.sort((a,b)=>a.num-b.num),
  };
  appState.niStudents = wData.niStudents||[];
  schedData = {};
  _demoMode = false;
  localStorage.removeItem(LS.WIZ); // wyczyść autozapis
  persistAll();
  showApp();
  notify('Plan został utworzony!');
}

// Wizard helpers
function wAddClass() {
  const n = document.getElementById('wClassName').value.trim();
  const g = document.getElementById('wClassGroups').value.trim();
  if(!n) return;
  wData.classes.push({name:n, groups: g
    ? g.split(',').map(x=>x.trim()).filter(Boolean).map(gname=>({
        id:'grp'+Date.now()+Math.random().toString(36).slice(2,5),
        name:gname, type:'group', studentCount:0, teacherId:null, subjects:[], linkedWith:[]
      }))
    : []});
  document.getElementById('wClassName').value='';
  document.getElementById('wClassGroups').value='';
  renderWizStep();
}
function wAddClassBulk() {
  const raw = document.getElementById('wClassBulk').value.trim();
  if(!raw) return;
  raw.split(';').forEach(n=>{n=n.trim();if(n&&!wData.classes.find(c=>c.name===n))wData.classes.push({name:n,groups:[]});});
  renderWizStep();
}
function wRemoveClass(i){wData.classes.splice(i,1);renderWizStep();}

function wAddSubj() {
  const n = document.getElementById('wSubjName').value.trim();
  const a = document.getElementById('wSubjAbbr').value.trim()||n.slice(0,3).toUpperCase();
  if(!n) return;
  wData.subjects.push({name:n,abbr:a,color:SUBJ_COLORS[wData.subjects.length%SUBJ_COLORS.length]});
  document.getElementById('wSubjName').value='';
  document.getElementById('wSubjAbbr').value='';
  renderWizStep();
}
function wAddSubjBulk() {
  const raw = document.getElementById('wSubjBulk').value.trim();
  if(!raw) return;
  raw.split(';').forEach(n=>{
    n=n.trim(); if(!n)return;
    if(!wData.subjects.find(s=>s.name===n))
      wData.subjects.push({name:n,abbr:n.slice(0,3).toUpperCase(),color:SUBJ_COLORS[wData.subjects.length%SUBJ_COLORS.length]});
  });
  renderWizStep();
}
function wRemoveSubj(i){wData.subjects.splice(i,1);renderWizStep();}
function wSetSubjColor(i,c){wData.subjects[i].color=c;renderWizStep();}


// ================================================================
//  GENEROWANIE SKRÓTÓW NAUCZYCIELI (jak w SalePlan)
//  Format: pierwsza litera imienia (duża) + 3 pierwsze litery nazwiska
//  Np. Anna Kowalska → AKow, Jan Nowak → JNow
//  Gdy duplikat: AKow → AKow2 → AKow3 itd.
// ================================================================
function buildAbbr(first, last) {
  const f = (first||'').trim();
  const l = (last||'').trim();

  const normalize = s => s
    .replace(/\u0141/g,'L').replace(/\u0142/g,'l')
    .replace(/\u00d3/g,'O').replace(/\u00f3/g,'o')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  // Pierwsze imię
  const fi = (normalize(f.split(/\s+/)[0]||'')[0]||'').toUpperCase();

  // Przedrostki do pominięcia
  const PREFIXES = new Set(['de','van','von','di','le','la','du','den','der','des','el','al','te','ten']);

  // Podziel nazwisko po myślniku lub spacji
  const parts = normalize(l).split(/[-\s]+/).filter(Boolean);

  // Odfiltruj przedrostki — tylko gdy zostają jeszcze jakieś człony
  const meaningful = parts.filter(p => !PREFIXES.has(p.toLowerCase()));
  const useParts = meaningful.length > 0 ? meaningful : parts;

  let ls = '';
  if(!useParts.length) {
    ls = '';
  } else if(useParts.length === 1) {
    // Jedno nazwisko — pierwsze 3 litery z formatowaniem
    ls = useParts[0].slice(0,3);
    ls = ls ? ls[0].toUpperCase() + ls.slice(1).toLowerCase() : '';
  } else {
    // Dwu- lub więcej-członowe — pierwsza litera każdego członu (max 3)
    ls = useParts.slice(0,3).map((p,i) =>
      i===0 ? p[0].toUpperCase() : p[0].toLowerCase()
    ).join('');
  }

  return fi + ls;
}

function uniqueAbbr(first, last, existingAbbrs) {
  const base = buildAbbr(first, last);
  if(!existingAbbrs || !existingAbbrs.includes(base)) return base;
  for(let i=2; i<=99; i++) {
    const candidate = base + i;
    if(!existingAbbrs.includes(candidate)) return candidate;
  }
  return base + Date.now().toString().slice(-3);
}

function wAutoAbbr() {
  const f = (document.getElementById('wTFirst')||{}).value||'';
  const l = (document.getElementById('wTLast')||{}).value||'';
  const el = document.getElementById('wTAbbr');
  if(el && !el._userEdited) {
    const existing = (wData.teachers||[]).map(t=>t.abbr);
    el.value = uniqueAbbr(f, l, existing);
  }
}
function wAddTeacher() {
  const f=document.getElementById('wTFirst').value.trim();
  const l=document.getElementById('wTLast').value.trim();
  const rawAbbr=document.getElementById('wTAbbr').value.trim();
  const existing=(wData.teachers||[]).map(t=>t.abbr);
  const a = rawAbbr || uniqueAbbr(f, l, existing);
  if(!f&&!l) return;
  const hoursTotal=parseInt(document.getElementById('wTHoursTotal')?.value)||0;
  const hoursExtra=parseInt(document.getElementById('wTHoursExtra')?.value)||0;
  wData.teachers.push({first:f,last:l,abbr:a,hoursTotal,hoursExtra});
  document.getElementById('wTFirst').value='';
  document.getElementById('wTLast').value='';
  document.getElementById('wTAbbr').value='';
  document.getElementById('wTHoursTotal').value='';
  document.getElementById('wTHoursExtra').value='';
  renderWizStep();
}
function wAddTeacherBulk() {
  const raw = document.getElementById('wTeacherBulk').value.trim();
  if(!raw) return;
  raw.split('\n').forEach(line=>{
    const [f,l,a,ht,he]=(line||'').split(';').map(x=>x.trim());
    if(f||l) {
      const existing=(wData.teachers||[]).map(t=>t.abbr);
      const computedAbbr = a || uniqueAbbr(f||'', l||'', existing);
      wData.teachers.push({
        first:f||'',last:l||'',
        abbr:computedAbbr,
        hoursTotal:parseInt(ht)||0,
        hoursExtra:parseInt(he)||0
      });
    }
  });
  renderWizStep();
}
function wRemoveTeacher(i){wData.teachers.splice(i,1);renderWizStep();}

// ── Budynki ──
function wAddBuilding() {
  const name = (document.getElementById('wBldName')||{}).value?.trim();
  const address = (document.getElementById('wBldAddress')||{}).value?.trim()||'';
  const note = (document.getElementById('wBldNote')||{}).value?.trim()||'';
  if(!name){notify('Podaj nazwę lokalizacji');return;}
  const BCOLORS=['#38bdf8','#34d399','#fbbf24','#f87171','#a78bfa','#2dd4bf','#fb923c','#f472b6'];
  wData.buildings.push({name, address, note, color:BCOLORS[wData.buildings.length%BCOLORS.length], floors:[]});
  document.getElementById('wBldName').value='';
  document.getElementById('wBldAddress').value='';
  document.getElementById('wBldNote').value='';
  renderWizStep();
}
function wAddFloor(bi) {
  const inp = document.getElementById('wFloorInp_'+bi);
  const label = inp?.value.trim();
  if(!label){notify('Podaj nazwę piętra');return;}
  if(!wData.buildings[bi].floors) wData.buildings[bi].floors=[];
  wData.buildings[bi].floors.push({id:'fl_'+Date.now()+'_'+bi, label, segments:[]});
  if(inp) inp.value='';
  renderWizStep();
}
function wRemoveFloor(bi,fi) {
  wData.buildings[bi].floors.splice(fi,1);
  renderWizStep();
}
function wAddSegment(bi,fi) {
  const inp = document.getElementById('wSegInp_'+bi+'_'+fi);
  const label = inp?.value.trim();
  if(!label){notify('Podaj nazwę segmentu');return;}
  wData.buildings[bi].floors[fi].segments.push({id:'seg_'+Date.now(), label});
  if(inp) inp.value='';
  renderWizStep();
}
function wRemoveSegment(bi,fi,si) {
  wData.buildings[bi].floors[fi].segments.splice(si,1);
  renderWizStep();
}
function wRemoveBuilding(i){wData.buildings.splice(i,1);renderWizStep();}
function wSetBldColor(i,c){wData.buildings[i].color=c;renderWizStep();}

// ── Sale (z budynkiem) ──
function wAddRoom() {
  const v=document.getElementById('wRoomInput').value.trim();
  if(!v)return;
  const bldEl=document.getElementById('wRoomBuilding');
  const buildingId=(bldEl&&bldEl.value!=='')?bldEl.value:null;
  const type=document.getElementById('wRoomType')?.value||'full';
  const capacity=parseInt(document.getElementById('wRoomCapacity')?.value)||0;
  if(!wData.rooms.find(r=>r.name===v))wData.rooms.push({name:v,buildingId,type,capacity});
  document.getElementById('wRoomInput').value='';
  if(document.getElementById('wRoomCapacity')) document.getElementById('wRoomCapacity').value='';
  renderWizStep();
}
function wAddRoomBulk() {
  const raw=document.getElementById('wRoomBulk').value.trim();
  if(!raw)return;
  raw.split(';').forEach(r=>{
    r=r.trim();
    if(r&&!wData.rooms.find(x=>x.name===r))wData.rooms.push({name:r,buildingId:null});
  });
  renderWizStep();
}
function wRemoveRoom(i){wData.rooms.splice(i,1);renderWizStep();}

function wAddHour() {
  const num=parseInt(document.getElementById('wHNum').value)||wData.hours.length+1;
  const start=document.getElementById('wHStart').value;
  const end=document.getElementById('wHEnd').value;
  if(!start||!end)return;
  if(!wData.hours.find(h=>h.num===num))wData.hours.push({num,start,end});
  else{const h=wData.hours.find(h=>h.num===num);h.start=start;h.end=end;}
  wData.hours.sort((a,b)=>a.num-b.num);
  // auto-increment
  document.getElementById('wHNum').value=num+1;
  // calc next start = end + 10min
  const [eh,em]=end.split(':').map(Number);
  const nm=eh*60+em+10;
  document.getElementById('wHStart').value=`${String(Math.floor(nm/60)).padStart(2,'0')}:${String(nm%60).padStart(2,'0')}`;
  const len=parseInt(document.getElementById('wHAutoLen')?.value)||45;
  const nm2=nm+len;
  document.getElementById('wHEnd').value=`${String(Math.floor(nm2/60)).padStart(2,'0')}:${String(nm2%60).padStart(2,'0')}`;
  renderWizStep();
}
function wRemoveHour(i){wData.hours.splice(i,1);renderWizStep();}
function wGenerateHours() {
  const from=document.getElementById('wHAutoFrom').value||'08:00';
  const len=parseInt(document.getElementById('wHAutoLen').value)||45;
  const brk=parseInt(document.getElementById('wHAutoBreak').value)||10;
  const cnt=parseInt(document.getElementById('wHAutoCount').value)||8;
  const [sh,sm]=from.split(':').map(Number);
  let cur=sh*60+sm;
  wData.hours=[];
  for(let i=0;i<cnt;i++){
    const s=`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`;
    cur+=len;
    const e=`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`;
    wData.hours.push({num:i+1,start:s,end:e});
    cur+=brk;
  }
  renderWizStep();
}

function currentSchoolYear(){
  const now=new Date();
  const y=now.getFullYear();
  return now.getMonth()>=8 ? `${y}/${y+1}` : `${y-1}/${y}`;
}

// ================================================================
//  POPULATE SELECTS
// ================================================================
function populateSelects() {
  if(!appState) return;

  // Days to day selects
  ['classDaySelect','teacherDaySelect'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.innerHTML='<option value="all">Cały tydzień</option>' +
      DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
  });

  // Matrix day select
  const mds=document.getElementById('matrixDaySelect');
  if(mds) mds.innerHTML='<option value="all">Cały tydzień</option>'+DAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('');

  // Class select
  const cs=document.getElementById('classSelect');
  if(cs){
    cs.innerHTML='<option value="">— wybierz klasę —</option>' +
      sortByName(appState.classes).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if(appState.classes.length) cs.value=appState.classes[0].id;
  }

  // Teacher select
  const ts=document.getElementById('teacherSelect');
  if(ts){
    ts.innerHTML='<option value="">— wybierz nauczyciela —</option>' +
      sortTeachers(appState.teachers).map(t=>`<option value="${t.id}">${escapeHtml(t.first)} ${escapeHtml(t.last)}</option>`).join('');
    if(appState.teachers.length) ts.value=appState.teachers[0].id;
  }

  populateRoomBuildingFilter();

  // Modal selects
  populateModalSelects();
}

function populateModalSelects() {
  const ms=document.getElementById('mSubject');
  if(ms) ms.innerHTML='<option value="">— wybierz przedmiot —</option>' +
    sortSubjects(appState.subjects).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  const mt=document.getElementById('mTeacher');
  if(mt) mt.innerHTML='<option value="">— wybierz nauczyciela —</option>' +
    sortTeachers(appState.teachers).map(t=>`<option value="${t.id}">${escapeHtml(t.first)} ${escapeHtml(t.last)} (${escapeHtml(t.abbr)})</option>`).join('');

  const mr=document.getElementById('mRoom');
  if(mr) {
    // Grupuj sale wg budynku jeśli budynki istnieją
    const hasBld = (appState.buildings||[]).length > 0;
    if(hasBld){
      // Buduj przez innerHTML z optgroup
      let html='<option value="">— brak / bez sali —</option>';
      (appState.buildings||[]).forEach(b=>{
        const bRooms=sortByName(appState.rooms.filter(r=>r.buildingId===b.id));
        if(bRooms.length) html+=`<optgroup label="${escapeHtml(b.name)}">`+bRooms.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')+'</optgroup>';
      });
      const noBldRooms=sortByName(appState.rooms.filter(r=>!r.buildingId));
      if(noBldRooms.length) html+='<optgroup label="Budynek główny">'+noBldRooms.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')+'</optgroup>';
      mr.innerHTML=html;
    } else {
      mr.innerHTML='<option value="">— brak / bez sali —</option>' +
        appState.rooms.map(r=>{
          const rt=ROOM_TYPES[r.type]||ROOM_TYPES.full;
          const cap=r.capacity?` (${r.capacity} os.)`:'';
          return `<option value="${r.id}">${rt.icon} ${escapeHtml(r.name)}${cap}</option>`;
        }).join('');
    }
  }

  const mc=document.getElementById('mClass');
  if(mc) mc.innerHTML='<option value="">— wybierz klasę —</option>' +
    sortByName(appState.classes).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// ================================================================
//  VIEW SWITCHING
// ================================================================
function switchView(name, btn) {
  _currentView=name;
  document.querySelectorAll('.view-panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById('view-'+name);
  if(panel) panel.classList.add('active');
  document.querySelectorAll('.ttab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderCurrentView();
}

function renderCurrentView() {
  switch(_currentView){
    case 'class':   renderClassView();   break;
    case 'teacher': renderTeacherView(); break;
    case 'room':    renderRoomView();    break;
    case 'matrix':  renderMatrixView();  break;
    case 'duty':    renderDuties();      break;
    case 'stats':   renderStats();       break;
    case 'generator':renderGenerator(); break;
    case 'settings':renderSettings();    break;
  }
  updateHelpBtn();
}

function updateHelpBtn() {
  document.querySelectorAll('.view-help-btn').forEach(el=>el.remove());
  const activePanel = document.querySelector('.view-panel.active');
  if(!activePanel) return;
  const sel = activePanel.querySelector('.view-selector');
  if(!sel || !HELP[_currentView]) return;
  const btn = document.createElement('button');
  btn.className = 'wbtn wbtn-ghost view-help-btn no-print';
  btn.style.cssText = 'padding:4px 10px;font-size:.72rem;margin-left:auto';
  btn.innerHTML = '❓ Pomoc';
  btn.onclick = () => openHelp(_currentView);
  sel.appendChild(btn);
}

// ================================================================
//  SCHEDULE GRID RENDERER
// ================================================================
// schedData key: clsId + '_' + dayIdx + '_' + hourIdx => lessonObj

function lessonKey(clsId, dayIdx, hourIdx) {
  return `${clsId}_${dayIdx}_${hourIdx}`;
}

function getLesson(clsId, dayIdx, hourIdx) {
  return schedData[lessonKey(clsId,dayIdx,hourIdx)] || null;
}

function setLesson(clsId, dayIdx, hourIdx, lesson) {
  const k=lessonKey(clsId,dayIdx,hourIdx);
  undoRecordChange(k, schedData[k] !== undefined ? JSON.parse(JSON.stringify(schedData[k])) : null);
  if(lesson===null) delete schedData[k];
  else schedData[k]=lesson;
  invalidateSlotIndex();
  persistAll();
}

function renderGrid(columns, getLabel, getDays, opts={}) {
  // columns: [{id, label}]
  // getDays: tablica indeksów dni [0..4]
  // opts.showDayLabel: dodaj kolumnę z nazwą dnia (tryb cały tydzień, nauczyciel/sala)
  // opts.fixTeacher, opts.fixRoom: pre-fill przy dodawaniu lekcji
  const days  = getDays;
  const hours = (appState.hours||[]).slice().sort((a,b)=>a.num-b.num);
  if(!hours.length) return '<div class="empty-state"><div class="empty-state-icon">⏰</div><div class="empty-state-title">Brak godzin lekcyjnych</div></div>';

  const showDayLabel = !!(opts.showDayLabel && days.length > 1);
  // DAY_SHORT zastąpione przez DAYS[]

  // ── Nagłówek ──
  let html = `<div class="grid-wrap-outer"><table class="sched-grid${showDayLabel?' with-day-col':''}"><thead>`;

  if(showDayLabel) {
    // Tryb tygodniowy: etykiety dni są w kolumnie bocznej (rowspan) — bez nagłówka dni
    // Nagłówek: Dzień | Nr | [nazwy klas]
    html += '<tr>';
    html += '<th class="day-label-hdr"></th>';
    html += '<th class="hour-header">Nr</th>';
    columns.forEach(col => {
      html += `<th class="day-header">${col.label}</th>`;
    });
    html += '</tr>';
  } else if(days.length > 1) {
    // Wiele dni, bez etykiety bocznej: nagłówek z nazwami dni (colspan) + subheader z klasami
    html += '<tr>';
    html += '<th class="hour-header">Nr</th>';
    days.forEach(di => {
      html += `<th class="day-header" colspan="${columns.length}">${DAYS[di]}</th>`;
    });
    html += '</tr>';
    if(columns.length > 1) {
      html += '<tr><th></th>';
      days.forEach(() => {
        columns.forEach(col => {
          html += `<th style="font-size:.65rem;padding:4px 8px">${col.label}</th>`;
        });
      });
      html += '</tr>';
    }
  } else {
    // Jeden dzień: nagłówek z nazwami klas
    html += '<tr>';
    html += '<th class="hour-header">Nr</th>';
    columns.forEach(col => {
      html += `<th class="day-header">${col.label}</th>`;
    });
    html += '</tr>';
  }
  html += '</thead><tbody>';

  // Pre-build lookup Maps for O(1) access
  const subjMap  = new Map((appState.subjects||[]).map(s=>[s.id,s]));
  const tchMap   = new Map((appState.teachers||[]).map(t=>[t.id,t]));
  const roomMap  = new Map((appState.rooms||[]).map(r=>[r.id,r]));
  const bldMap   = new Map((appState.buildings||[]).map(b=>[b.id,b]));

  // ── Helper: renderuj jedną komórkę ──
  const cellHtml = (col, di, h) => {
    const lesson = getLesson(col.id, di, h.num);
    if(lesson) {
      const subj  = subjMap.get(lesson.subjectId);
      const tch   = tchMap.get(lesson.teacherId);
      const room  = roomMap.get(lesson.roomId);
      const color = subj?.color||'#38bdf8';
      const bg    = hexToRgba(color,.18);
          const textC = isDarkColor(color)?'#fff':'#111';
      const hasC  = checkCellConflict(col.id, di, h.num, lesson);
      const bldSuffix = room ? (()=>{ const b=bldMap.get(room.buildingId); return b?' ('+escapeHtml(b.name)+')':''; })() : '';
      return `<td data-clsid="${col.id}" data-day="${di}" data-hour="${h.num}"
          style="${hasC?'background:var(--red-g)':''}"
          ondragover="doDragOver(event,this)" ondrop="doDrop(event,'${col.id}',${di},${h.num})" ondragleave="doDragLeave(event)">
          <div class="lesson-chip ${hasC?'conflict-chip':''}"
            style="background:${bg};border-left:3px solid ${color};color:${textC}"
            draggable="true"
            ondragstart="doDragStart(event,'${col.id}',${di},${h.num})"
            ondragend="doDragEnd(event)"
            ondragover="event.preventDefault();event.stopPropagation();this.closest('td').classList.add('droptarget-hover')"
            ondragleave="event.stopPropagation()"
            ondrop="event.stopPropagation();doDrop(event,'${col.id}',${di},${h.num})"
            onclick="event.stopPropagation();openEditModal('${col.id}',${di},${h.num})">
            <div class="lesson-chip-subj">${escapeHtml(subj?.abbr)||'?'}${lesson.groups&&lesson.groups.length?' ('+lesson.groups.map(g=>escapeHtml(g)).join('/')+')':''}</div>
            <div class="lesson-chip-meta">${escapeHtml(tch?tch.abbr:'')}${room?' · '+escapeHtml(room.name)+bldSuffix:''}</div>
            <div class="lesson-chip-del" onclick="event.stopPropagation();deleteLesson('${col.id}',${di},${h.num})">×</div>
            ${hasC?'<div class="conflict-dot"></div>':''}
          </div>
        </td>`;
    } else {
      return `<td class="empty-cell" data-clsid="${col.id}" data-day="${di}" data-hour="${h.num}"
          ondragover="doDragOver(event,this)" ondrop="doDrop(event,'${col.id}',${di},${h.num})" ondragleave="doDragLeave(event)"
          onclick="openAddModal('${col.id}',${di},${h.num},'${opts.fixTeacher||''}','${opts.fixRoom||''}')">
          <button class="add-cell-btn" tabindex="-1">＋</button>
        </td>`;
    }
  }

  // ── Ciało tabeli ──
  if(showDayLabel) {
    // Tryb tygodniowy: dni jako grupy wierszy z etykietą po lewej
    days.forEach(di => {
      hours.forEach((h, hi) => {
        html += '<tr>';
        if(hi === 0) {
          // Etykieta dnia z rowspan = liczba godzin
          html += `<td class="day-label-cell" rowspan="${hours.length}">${DAYS[di]}</td>`;
        }
        html += `<td class="hour-cell" >${h.num}<br><span style="font-size:.65rem">${h.start}</span></td>`;
        columns.forEach(col => { html += cellHtml(col, di, h); });
        html += '</tr>';
      });
    });
  } else {
    // Tryb normalny: wiersze = godziny, kolumny = (dni ×) klasy
    hours.forEach(h => {
      html += `<tr><td class="hour-cell">${h.num}<br><span style="font-size:.65rem">${h.start}</span></td>`;
      days.forEach(di => {
        columns.forEach(col => { html += cellHtml(col, di, h); });
      });
      html += '</tr>';
    });
  }

  html += '</tbody></table></div>';
  return html;
}

// ── CLASS VIEW ──
function renderClassView() {
  if(!appState) return;
  const clsId = document.getElementById('classSelect').value;
  const dayVal = document.getElementById('classDaySelect').value;
  const wrap = document.getElementById('classGridWrap');
  if(!clsId){wrap.innerHTML=`<div class="empty-state"><div class="empty-state-icon">📚</div><div class="empty-state-title">Wybierz klasę z listy</div></div>`;return;}
  const cls = appState.classes.find(c=>c.id===clsId);
  const days = dayVal==='all' ? [0,1,2,3,4] : [parseInt(dayVal)];
  wrap.innerHTML = renderGrid([{id:clsId,label:cls?.name||''}], null, days);
}

// ── TEACHER VIEW ──
function renderTeacherView() {
  if(!appState) return;
  const tchId  = document.getElementById('teacherSelect').value;
  const dayVal = document.getElementById('teacherDaySelect').value;
  const wrap   = document.getElementById('teacherGridWrap');
  if(!tchId){wrap.innerHTML=`<div class="empty-state"><div class="empty-state-icon">👩‍🏫</div><div class="empty-state-title">Wybierz nauczyciela z listy</div></div>`;return;}
  const days = dayVal==='all' ? [0,1,2,3,4] : [parseInt(dayVal)];
  const cols = appState.classes.map(c=>({id:c.id,label:c.name}));
  wrap.innerHTML = renderGrid(cols, null, days, {fixTeacher:tchId, showDayLabel: dayVal==='all'});

  // Znajdź klasy gdzie nauczyciel jest wspomagającym (przez niStudents)
  const supportClasses = new Set();
  (appState.niStudents||[]).forEach(stud => {
    if(!stud.classId) return;
    (stud.subjects||[]).forEach(r => {
      if(r.supportTeacherId === tchId) supportClasses.add(stud.classId);
    });
  });

  wrap.querySelectorAll('td[data-clsid]').forEach(td=>{
    const clsId=td.dataset.clsid;
    const di=parseInt(td.dataset.day);
    const hn=parseInt(td.dataset.hour);
    const lesson=getLesson(clsId,di,hn);
    const isSupport = supportClasses.has(clsId);

    if(lesson && lesson.teacherId!==tchId){
      // Znajdź chip lekcji (może być .lesson-chip lub .m-chip lub pierwszy div)
      const chip = td.querySelector('.lesson-chip,.m-chip,.cell-chip') || td.firstElementChild?.firstElementChild;
      if(chip) {
        if(isSupport) {
          chip.style.opacity = '.75';
          chip.style.borderLeft = '3px solid var(--teal)';
          chip.title = 'Lekcja z klasą — nauczyciel wspomagający';
          if(!chip.querySelector('.support-badge')) {
            const badge = document.createElement('span');
            badge.className = 'support-badge';
            badge.textContent = '+W';
            badge.style.cssText = 'position:absolute;top:2px;left:3px;font-size:.55rem;'+
              'background:var(--teal);color:#fff;border-radius:3px;padding:0 3px;font-weight:700;z-index:1';
            chip.style.position = 'relative';
            chip.appendChild(badge);
          }
        } else {
          chip.style.opacity = '.2';
        }
      }
    }
    if(!lesson) td.onclick=()=>openAddModal(clsId,di,hn,tchId,'');
  });

  // Info o roli wspomagającego jeśli dotyczy
  if(supportClasses.size > 0) {
    const clsNames = [...supportClasses].map(id=>{
      const c = appState.classes.find(c=>c.id===id);
      return escapeHtml(c?.name||'?');
    }).join(', ');
    const info = document.createElement('div');
    info.style.cssText = 'margin-bottom:10px;padding:7px 12px;background:var(--teal)15;'+
      'border:1px solid var(--teal)44;border-radius:8px;font-size:.72rem;color:var(--text-m)';
    info.innerHTML = `👥 Pełni rolę <strong>nauczyciela wspomagającego</strong> w klasach: <strong>${clsNames}</strong>`+
      ` — lekcje oznaczone <span style="color:var(--teal);font-weight:700">+W</span> i zielonym paskiem.`;
    wrap.insertBefore(info, wrap.firstChild);
  }
}

// ── ROOM VIEW ──
// ================================================================
//  WIDOK SAL — styl SalePlan
//  Kolumny = sale (pogrupowane wg budynku/piętra/segmentu)
//  Wiersze = godziny lekcyjne
//  Jeden dzień na raz
// ================================================================
// ================================================================
//  WIDOK SAL — wzorowany 1:1 na SalePlan
// ================================================================
const ROOM_BLD_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

function renderRoomView() {
  if(!appState) return;
  const di     = parseInt(document.getElementById('roomDaySelect').value)||0;
  const bldFlt = document.getElementById('roomBuildingFilter')?.value||'';
  const wrap   = document.getElementById('roomGridWrap');
  const hours  = appState.hours||[];
  const rooms  = (appState.rooms||[]).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','pl',{numeric:true}));
  const classes= appState.classes||[];
  const subjs  = appState.subjects||[];
  const tchs   = appState.teachers||[];
  const blds   = appState.buildings||[];

  if(!hours.length){
    wrap.innerHTML='<div class="empty-state"><div class="empty-state-icon">⏰</div><div class="empty-state-title">Brak godzin lekcyjnych</div></div>';
    return;
  }
  if(!rooms.length){
    wrap.innerHTML='<div class="empty-state"><div class="empty-state-icon">🏫</div><div class="empty-state-title">Brak sal — dodaj sale w Ustawieniach</div></div>';
    return;
  }

  // Filtruj wg budynku
  let visRooms = bldFlt ? rooms.filter(r=>r.buildingId===bldFlt) : rooms;

  // Zbuduj kolumny z informacją o budynku
  const cols = visRooms.map(r=>{
    const bldIdx = blds.findIndex(b=>b.id===r.buildingId);
    const bld    = bldIdx>=0 ? blds[bldIdx] : null;
    return {room:r, bld, bldIdx: bldIdx>=0?bldIdx:0};
  });

  // Wykryj ile unikalnych budynków
  const uniqueBlds = [...new Set(cols.map(c=>c.bldIdx))];
  const showBldRow = blds.length>1 || uniqueBlds.length>1;

  // ── Funkcja buildMergedRow (jak w SalePlan) ──
  function buildMergedRow(keyFn, labelFn, stylesFn, extraClass, timeCell, topPx) {
    const topStyle = `--th-top:${topPx}px;`;
    let row = `<tr><th class="rs-time-th" style="${topStyle}">${timeCell}</th>`;
    let i=0;
    while(i<cols.length){
      const key=keyFn(cols[i]);
      let span=1;
      while(i+span<cols.length && keyFn(cols[i+span])===key) span++;
      const styles=stylesFn?stylesFn(cols[i]):'';
      row+=`<th colspan="${span}" class="${extraClass}" style="${topStyle}${styles}">${labelFn(cols[i])}</th>`;
      i+=span;
    }
    return row+'</tr>';
  }

  const ROW_H=26;
  let _rowTop=0;
  let thead='<thead>';

  // Wiersz budynków
  if(showBldRow){
    thead+=buildMergedRow(
      c=>c.bldIdx,
      c=>{ const b=blds[c.bldIdx]; return escapeHtml(b?b.name:'Budynek główny'); },
      c=>{ const color=ROOM_BLD_COLORS[c.bldIdx%ROOM_BLD_COLORS.length]; return `color:${color};border-top:3px solid ${color};border-bottom:2px solid ${color}`; },
      'rs-th-building','Budynek',_rowTop
    );
    _rowTop+=ROW_H;
  }

  // Wiersz numerów sal (zawsze)
  {
    const topStyle=`--th-top:${_rowTop}px;`;
    let row=`<tr><th class="rs-time-th" style="background:var(--s1);${topStyle}">Godz.</th>`;
    cols.forEach(col=>{
      const r=col.room;
      const bldColor = col.bld?.color || ROOM_BLD_COLORS[col.bldIdx%ROOM_BLD_COLORS.length];
      const topBorder = !showBldRow ? `border-top:3px solid ${bldColor}` : '';
      const cap = r.capacity?`<br><span style="font-size:.55rem;color:var(--text-d);font-weight:400">${r.capacity} os.</span>`:'';
      row+=`<th class="rs-th-room" style="${topStyle}${topBorder}"
        title="${escapeHtml(r.note||r.name)}">Sala ${escapeHtml(r.name)}${cap}</th>`;
    });
    thead+=row+'</tr>';
    _rowTop+=ROW_H;
  }

  // Wiersz gospodarz — klasy których homeRooms zawiera tę salę
  // (odwrotne wyszukiwanie: klasa → sala, bo sala nie przechowuje listy klas-gospodarz)
  const roomToClasses = {}; // roomId → [className, ...]
  classes.forEach(cls => {
    (cls.homeRooms||[]).forEach(rid => {
      if(!roomToClasses[rid]) roomToClasses[rid] = [];
      roomToClasses[rid].push(cls.name);
    });
  });
  {
    const topStyle=`--th-top:${_rowTop}px;`;
    let row=`<tr><th class="rs-time-th" style="background:var(--s1);font-size:.55rem;color:var(--text-d);${topStyle}">Gospod.</th>`;
    cols.forEach(col=>{
      const r=col.room;
      const clsNames=(roomToClasses[r.id]||[]).slice().sort((a,b)=>a.localeCompare(b,'pl',{numeric:true}));
      const hasTwo=clsNames.length>1;
      row+=`<th class="rs-th-homeroom" style="${topStyle}" onclick="openEditRoomModal('${r.id}')"
        title="Kliknij aby edytować salę">
        ${clsNames.length
          ? clsNames.slice(0,2).map((n,i)=>
              `<div class="rs-hr-pair"><div class="hr-class${i?'-2':''}">${escapeHtml(n)}</div></div>`+
              (i===0&&hasTwo?'<div class="rs-hr-sep"></div>':'')
            ).join('')
          : '<span style="color:var(--text-d)">—</span>'}
      </th>`;
    });
    thead+=row+'</tr>';
  }
  thead+='</thead>';

  // ── Zbierz zajętość sal ──
  const dayOcc={}; // roomId → { hourNum → {lesson, clsId} }
  const dayOccCount={}; // roomId_hourNum → count (do wykrywania kolizji)
  Object.entries(schedData).forEach(([k,v])=>{
    const p=k.split('_');
    if(parseInt(p[1])!==di||!v.roomId) return;
    const rId=v.roomId, hn=parseInt(p[2]);
    if(!dayOcc[rId]) dayOcc[rId]={};
    if(!dayOcc[rId][hn]) dayOcc[rId][hn]={lesson:v,clsId:p[0]};
    const ck=rId+'_'+hn;
    dayOccCount[ck]=(dayOccCount[ck]||0)+1;
  });

  // ── Buduj tbody ──
  let tbody='<tbody>';
  hours.forEach(h=>{
    tbody+=`<tr><td class="rs-time-td">${h.num}<br><span style="font-size:.65rem;color:var(--text-d)">${h.start}</span></td>`;
    cols.forEach(col=>{
      const r=col.room;
      const occ=dayOcc[r.id]?.[h.num];
      const isCollision=(dayOccCount[r.id+'_'+h.num]||0)>1;

      if(occ){
        const {lesson,clsId}=occ;
        const subj  = lesson.subjectId?subjs.find(s=>s.id===lesson.subjectId):null;
        const tch   = lesson.teacherId?tchs.find(t=>t.id===lesson.teacherId):null;
        const cls   = classes.find(c=>c.id===clsId);
        const grps  = lesson.groups?.length?lesson.groups:[];
        const clsLabel = (cls?.name||'?')+(grps.length?' ('+grps.join('/')+')':'');

        tbody+=`<td>
          <div class="rs-cell-inner filled${isCollision?' collision':''}"
            onclick="openEditModal('${clsId}',${di},${h.num})"
            title="${escapeHtml(clsLabel)} · ${escapeHtml(subj?.name||'—')} · ${escapeHtml(tch?tch.last+' '+tch.first:'')}">
            <div class="rs-cell-row-cls">
              <span class="rs-cell-abbr rs-cell-abbr-cls">${escapeHtml(clsLabel)}</span>
            </div>
            ${subj?`<div class="rs-cell-row-subj">${escapeHtml(subj.abbr||subj.name)}</div>`:''}
            ${tch?`<div class="rs-cell-row-tch"><span class="rs-cell-abbr">${escapeHtml(tch.abbr)}</span></div>`:''}
          </div>
        </td>`;
      } else {
        tbody+=`<td>
          <div class="rs-cell-inner"
            onclick="openAddModal(null,${di},${h.num},'','${r.id}')">
            <div class="rs-cell-plus">＋</div>
          </div>
        </td>`;
      }
    });
    tbody+='</tr>';
  });
  tbody+='</tbody>';

  wrap.innerHTML=`<div class="room-schedule-wrap">
    <table class="room-schedule-table">${thead}${tbody}</table>
  </div>`;
}

function populateRoomBuildingFilter() {
  const sel = document.getElementById('roomBuildingFilter');
  const lbl = document.getElementById('roomBldLabel');
  if(!sel||!appState) return;
  const blds = appState.buildings||[];
  sel.innerHTML = '<option value="">Wszystkie budynki</option>' +
    blds.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  if(lbl) lbl.style.display = blds.length<2?'none':'';
  if(sel.parentElement) {
    const span = sel.previousElementSibling;
    if(span) span.style.display = blds.length<2?'none':'';
    sel.style.display = blds.length<2?'none':'';
  }
}


function renderMatrixView() {
  if(!appState) return;
  const dayVal = document.getElementById('matrixDaySelect').value;
  const dayIdx = dayVal==='all' ? 'all' : (parseInt(dayVal)||0);
  const mode   = document.getElementById('matrixModeSelect').value;
  const wrap   = document.getElementById('matrixGridWrap');
  const hours  = appState.hours;
  if(!hours||!hours.length){wrap.innerHTML='<div class="empty-state"><div class="empty-state-icon">⏰</div><div class="empty-state-title">Brak godzin lekcyjnych</div></div>';return;}

  // ── helper: renderuje jedną komórkę macierzy (klasa×godzina lub nauczyciel×godzina) ──
  function mCell(clsId, di, hnum, lesson, extraData={}) {
    if(lesson){
      const subj  = appState.subjects.find(s=>s.id===lesson.subjectId);
      const tch   = appState.teachers.find(t=>t.id===lesson.teacherId);
      const room  = appState.rooms.find(r=>r.id===lesson.roomId);
      const color = subj?.color||'#38bdf8';
      const bg    = hexToRgba(color,.18);
          const textC = isDarkColor(color)?'#fff':'#111';
      const hasC  = checkCellConflict(clsId,di,hnum,lesson);
      // line2: zależy od trybu — w trybie klas pokaż nauczyciela, w trybie nauczycieli pokaż klasę
      const line2 = extraData.line2||'';
      return `<td data-clsid="${clsId}" data-day="${di}" data-hour="${hnum}"
          style="${hasC?'background:var(--red-g)':''}"
          ondragover="doDragOver(event,this)" ondrop="doDrop(event,'${clsId}',${di},${hnum})" ondragleave="doDragLeave(event)">
          <div class="m-chip ${hasC?'conflict-chip':''}"
            style="background:${bg};border-left:3px solid ${color};color:${textC}"
            draggable="true"
            ondragstart="doDragStart(event,'${clsId}',${di},${hnum})"
            ondragend="doDragEnd(event)"
            ondragover="event.preventDefault();event.stopPropagation();this.closest('td').classList.add('droptarget-hover')"
            ondragleave="event.stopPropagation()"
            ondrop="event.stopPropagation();doDrop(event,'${clsId}',${di},${hnum})"
            onclick="event.stopPropagation();openEditModal('${clsId}',${di},${hnum})">
            <div class="m-chip-subj">${escapeHtml(subj?.abbr||'?')}${lesson.groups&&lesson.groups.length?' ('+lesson.groups.join('/')+')':''}</div>
            <div class="m-chip-meta">${escapeHtml(line2)}</div>
            <div class="m-chip-del" onclick="event.stopPropagation();deleteLesson('${clsId}',${di},${hnum})">×</div>
            ${hasC?'<div class="conflict-dot"></div>':''}
          </div>
        </td>`;
    } else {
      return `<td class="m-empty" data-clsid="${clsId}" data-day="${di}" data-hour="${hnum}"
          ondragover="doDragOver(event,this)" ondrop="doDrop(event,'${clsId}',${di},${hnum})" ondragleave="doDragLeave(event)"
          onclick="openAddModal('${clsId}',${di},${hnum},'${extraData.prefTeacher||''}','')">
          <button class="m-add-btn" tabindex="-1">＋</button>
        </td>`;
    }
  }

  const allDays = dayIdx==='all' ? [0,1,2,3,4] : [dayIdx];
  const DAY_SHORT_M = ['Pon','Wt','Śr','Czw','Pt'];

  if(mode==='class'){
    // Wiersze = godziny (× dni jeśli cały tydzień), Kolumny = klasy
    let html=`<div class="grid-wrap-outer"><table class="sched-grid${dayIdx==='all'?' with-day-col':''}"><thead><tr>`;
    if(dayIdx==='all') html+=`<th class="day-label-hdr"></th>`;
    html+=`<th class="hour-header">Godz.</th>`;
    appState.classes.forEach(c=>html+=`<th>${escapeHtml(c.name)}</th>`);
    html+='</tr></thead><tbody>';
    allDays.forEach(di=>{
      hours.forEach((h,hi)=>{
        html+=`<tr>`;
        if(dayIdx==='all' && hi===0)
          html+=`<td class="day-label-cell" rowspan="${hours.length}">${DAYS[di]}</td>`;
        html+=`<td class="hour-cell">${h.num}<br><span style="font-size:.62rem">${h.start}</span></td>`;
        appState.classes.forEach(c=>{
          const lesson=getLesson(c.id,di,h.num);
          const tch=lesson?appState.teachers.find(t=>t.id===lesson.teacherId):null;
          const room=lesson?appState.rooms.find(r=>r.id===lesson.roomId):null;
          const line2=[escapeHtml(tch?.abbr), escapeHtml(room?.name)].filter(Boolean).join(' · ');
          html += mCell(c.id, di, h.num, lesson, {line2});
        });
        html+='</tr>';
      });
    });
    html+='</tbody></table></div>';
    wrap.innerHTML=html;

  } else {
    // Wiersze = godziny (× dni jeśli cały tydzień), Kolumny = nauczyciele
    let html=`<div class="grid-wrap-outer"><table class="sched-grid${dayIdx==='all'?' with-day-col':''}"><thead><tr>`;
    if(dayIdx==='all') html+=`<th class="day-label-hdr"></th>`;
    html+=`<th class="hour-header">Godz.</th>`;
    sortTeachers(appState.teachers).forEach(t=>html+=`<th title="${escapeHtml(t.first)} ${escapeHtml(t.last)}">${escapeHtml(t.abbr)}</th>`);
    html+='</tr></thead><tbody>';
    const sortedTch = sortTeachers(appState.teachers);
    allDays.forEach(di=>{
      hours.forEach((h,hi)=>{
        html+=`<tr>`;
        if(dayIdx==='all' && hi===0)
          html+=`<td class="day-label-cell" rowspan="${hours.length}">${DAYS[di]}</td>`;
        html+=`<td class="hour-cell">${h.num}<br><span style="font-size:.62rem">${h.start}</span></td>`;
        sortedTch.forEach(t=>{
          const entry=Object.entries(schedData).find(([k,v])=>{
            const parts=k.split('_');
            return parseInt(parts[1])===di && parseInt(parts[2])===h.num && v.teacherId===t.id;
          });
          if(entry){
            const [key,lesson]=entry;
            const clsId=key.split('_')[0];
            const cls=appState.classes.find(c=>c.id===clsId);
            const room=appState.rooms.find(r=>r.id===lesson.roomId);
            const line2=[escapeHtml(cls?.name), escapeHtml(room?.name)].filter(Boolean).join(' · ');
            html += mCell(clsId, di, h.num, lesson, {line2});
          } else {
            html+=`<td class="m-empty" data-day="${di}" data-hour="${h.num}" data-teacher="${t.id}"
              ondragover="doDragOver(event,this)" ondrop="doDropTeacherCell(event,'${t.id}',${di},${h.num})" ondragleave="doDragLeave(event)"
              onclick="openAddModalForTeacher('${t.id}',${di},${h.num})">
              <button class="m-add-btn" tabindex="-1">＋</button>
            </td>`;
          }
        });
        html+='</tr>';
      });
    });
    html+='</tbody></table></div>';
    wrap.innerHTML=html;
  }
}

// Otwiera modal dodawania lekcji w trybie nauczyciela — wymaga wyboru klasy
function openAddModalForTeacher(tchId, dayIdx, hourIdx) {
  if(!appState)return;
  _mCtx = {mode:'add', clsId:null, dayIdx, hourIdx, prefTeacher:tchId};
  const h=appState.hours.find(h=>h.num===hourIdx);
  const tch=appState.teachers.find(t=>t.id===tchId);
  document.getElementById('lessonModalTitle').innerHTML =
    `Dodaj lekcję — <span>${DAYS[dayIdx]}, godz. ${hourIdx} (${h?h.start+'-'+h.end:''})</span>`;
  document.getElementById('mSubject').value='';
  document.getElementById('mNote').value='';
  document.getElementById('mDeleteBtn').style.display='none';
  document.getElementById('mTeacherWarn').style.display='none';

  // Pokaż pole wyboru klasy (wymagane w tym trybie)
  const mClassField=document.getElementById('mClassField');
  const mClass=document.getElementById('mClass');
  mClassField.style.display='';
  if(mClass)mClass.value='';

  rebuildTeacherOptions();
  document.getElementById('mTeacher').value=tchId;
  document.getElementById('mRoom').value='';
  populateGroupsInModal(null,[]);

  document.getElementById('lessonModal').classList.add('show');
}

// Drop w trybie nauczyciela — przenosimy lekcję do tej samej godziny ale zostawiamy klasę
function doDropTeacherCell(e, tchId, toDayIdx, toHourIdx) {
  e.preventDefault();
  document.querySelectorAll('.droptarget-hover').forEach(el=>el.classList.remove('droptarget-hover'));
  if(!_dragData)return;
  const {clsId,dayIdx,hourIdx}=_dragData;
  // Przenosimy lekcję tej samej klasy do nowej godziny/dnia
  const src=getLesson(clsId,dayIdx,hourIdx);
  const dst=getLesson(clsId,toDayIdx,toHourIdx);
  if(!src)return;
  undoBatchStart();
  setLesson(clsId,toDayIdx,toHourIdx,src);
  setLesson(clsId,dayIdx,hourIdx,dst||null);
  undoBatchEnd();
  renderCurrentView();
  detectAndShowConflicts();
  notify('Lekcja przeniesiona');
}

// ================================================================
//  STATS VIEW
// ================================================================
// ================================================================
//  GENERATOR PLANU LEKCJI
//  Constraints zapisywane w appState.constraints
// ================================================================

// ── Domyślna struktura ograniczeń ──
function defaultConstraints() {
  return {
    // Dostępność nauczycieli: {tchId: {di_hnum: 'blocked'|'preferred'}}
    teacherAvail: {},
    // Bloki lekcji: {subjId: {blockSize:2, allowSplit:false}}
    lessonBlocks: {},
    // Przedmioty nieblokowane: Set subjId (przechowywany jako tablica)
    noBlock: [],
    // Pozycja przedmiotu: {subjId: 'first'|'last'|'any'}
    subjPosition: {},
    // Podział na grupy: {clsId_subjId: {groups:2}}
    groupSplit: {},
    // Max lekcji danego przedmiotu per dzień per klasa: {subjId: 1|2}
    maxPerDay: {},
    // Preferowane sale: auto (z room.preferredSubjects) — brak dodatkowego pola
    // Max razy przedmiot pod rząd w tygodniu: {subjId: n}
    maxConsecutive: {},
  };
}

function getConstraints() {
  if(!appState.constraints) appState.constraints = defaultConstraints();
  // Upewnij się że mamy wszystkie klucze
  const d = defaultConstraints();
  for(const k of Object.keys(d)) {
    if(appState.constraints[k] === undefined) appState.constraints[k] = d[k];
  }
  return appState.constraints;
}

// ── Migracja ──
function migrateConstraints() {
  if(appState && !appState.constraints) appState.constraints = defaultConstraints();
  if(appState?.constraints && !appState.constraints.maxConsecutive) appState.constraints.maxConsecutive = {};
}

// ── Render główny ──
function renderGenerator() {
  const wrap = document.getElementById('generatorContent');
  if(!wrap) return;
  if(!appState) {
    wrap.innerHTML='<div class="empty-state"><div class="empty-state-icon">⚡</div><div class="empty-state-title">Najpierw skonfiguruj szkołę w kreatorze</div></div>';
    return;
  }
  migrateConstraints();
  const C = getConstraints();

  let html = `<div style="max-width:960px">`;

  // ── Baner info ──
  html += `<div style="padding:12px 16px;background:var(--accent-g);border:1px solid var(--accent);
    border-radius:var(--radius-lg);margin-bottom:16px;display:flex;align-items:center;gap:12px">
    <span style="font-size:1.4rem">⚡</span>
    <div>
      <div style="font-size:.82rem;font-weight:700;color:var(--accent)">Generator planu lekcji</div>
      <div style="font-size:.72rem;color:var(--text-m);margin-top:2px">
        Ustaw warunki poniżej, zapisz i kliknij Generuj.
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-left:auto">
      <button class="wbtn wbtn-ghost" style="font-size:.78rem;white-space:nowrap"
        onclick="genSaveConstraints()">💾 Zapisz warunki</button>
      <button class="wbtn wbtn-primary" style="font-size:.78rem;white-space:nowrap;padding:8px 18px"
        onclick="genRun()">▶ Generuj plan</button>
    </div>
  </div>`;

  // ─── SEKCJA 1: Dostępność nauczycieli ───
  html += genSection('avail', '👩‍🏫 Dostępność nauczycieli', `
    <p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
      Dla każdego nauczyciela kliknij komórkę aby zmienić jej stan:<br>
      <strong>Biała</strong> = dostępny &nbsp;·&nbsp;
      <span style="color:var(--red)">✕ Czerwona</span> = zablokowany (poza szkołą) &nbsp;·&nbsp;
      <span style="color:#f59e0b">◐ Żółta</span> = przymusowe okienko (wolny od lekcji, ale w szkole) &nbsp;·&nbsp;
      <span style="color:var(--accent)">★ Niebieska</span> = preferowana godzina
    </p>
    ${genTeacherAvailUI(C)}`);

  // ─── SEKCJA 2: Przypisania godzin (tygodniowe pensum) ───
  html += genSection('hours', '📋 Przydział godzin nauczyciel → klasa', genHoursUI());

  // ─── SEKCJA 3: Bloki lekcji ───
  html += genSection('blocks', '🔗 Bloki i ciągłość lekcji', `
    <p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
      Blok = kilka godzin tego samego przedmiotu z rzędu (np. 2h chemii = podwójne zajęcia).
      „Nie łącz" = przedmiot zawsze jako pojedyncze godziny.
    </p>
    ${genBlocksUI(C)}`);

  // ─── SEKCJA 4: Pozycja w planie ───
  html += genSection('position', '📍 Pozycja przedmiotów w dniu', `
    <p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
      Np. WF na końcu dnia, język obcy na początku.
    </p>
    ${genPositionUI(C)}`);

  // ─── SEKCJA 5: Podział na grupy ───
  html += genSection('groups', '👥 Podział klas na grupy', `
    <p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
      Zaznacz które przedmioty w danej klasie są prowadzone w grupach
      (równolegle z różnymi nauczycielami). Generator przydzieli wtedy dwa sloty jednocześnie.
    </p>
    ${genGroupsUI(C)}`);

  // ─── SEKCJA 6: Max lekcji przedmiotu per dzień ───
  html += genSection('maxday', '📅 Maks. wystąpień przedmiotu dziennie', `
    <p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
      Ogranicz ile razy dany przedmiot może być tego samego dnia
      (np. matematyka max 1× dziennie dla każdej klasy).
    </p>
    ${genMaxDayUI(C)}`);

  // ─── SEKCJA 6b: Max razy pod rząd ───
  html += genSection('consecutive', '📆 Max dni z rzędu dla przedmiotu', `
    ${genMaxConsecutiveUI(C)}`);

  // ─── SEKCJA 6c: Nauczanie indywidualne i grupowe ───
  html += genSection('indivteach', '👤 Nauczanie indywidualne i grupowe', genIndivTeachUI());

  // ─── SEKCJA 7: Preferencje sal ───
  html += genSection('rooms', '🏫 Preferencje sal', genRoomPrefUI());

  // Sprawdź czy jest zapisany wynik z poprzedniej sesji
  const prevGen = localStorage.getItem('pl_sched_generated');
  if(prevGen) {
    try {
      const {placed,failed,pct} = JSON.parse(prevGen);
      const c = pct>=95?'var(--accent)':pct>=80?'var(--orange)':'var(--red)';
      html += `<div style="padding:8px 14px;border-radius:8px;border:1px solid ${c}44;
        background:${c}0d;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <span style="font-size:.8rem;font-weight:600;color:${c}">
          Poprzedni wynik: ${pct}% (${placed}h / ${placed+failed}h)
        </span>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="wbtn wbtn-ghost" style="font-size:.72rem;padding:4px 10px"
            onclick="genPreview()">👁 Podgląd</button>
          <button class="wbtn wbtn-primary" style="font-size:.72rem;padding:4px 10px"
            onclick="genApply()">✓ Zastosuj</button>
          <button onclick="genDiscard()"
            style="font-size:.72rem;color:var(--red);background:none;border:none;cursor:pointer">✕</button>
        </div>
      </div>`;
    } catch(e) {}
  }

  // ─── SEKCJA 8: Analiza pojemności sal ───
  html += genSection('capacity', '📐 Analiza pojemności sal', genCapacityUI());

  html += `</div>`;
  wrap.innerHTML = html;
}

// ── Akordeon sekcji ──
function genSection(id, title, bodyHtml) {
  const open = localStorage.getItem('gen_sec_'+id) !== 'closed';
  return `<div class="gen-section">
    <div class="gen-section-hdr" onclick="genToggleSection('${id}')">
      <span class="gen-section-title">${title}</span>
      <span style="color:var(--text-m);transition:transform .2s;display:inline-block;
        transform:${open?'':'rotate(-90deg)'}" id="genSecArr_${id}">▼</span>
    </div>
    <div class="gen-section-body${open?'':' collapsed'}" id="genSec_${id}">${bodyHtml}</div>
  </div>`;
}

function genToggleSection(id) {
  const body = document.getElementById('genSec_'+id);
  const arr  = document.getElementById('genSecArr_'+id);
  if(!body) return;
  const closed = body.classList.toggle('collapsed');
  if(arr) arr.style.transform = closed ? 'rotate(-90deg)' : '';
  localStorage.setItem('gen_sec_'+id, closed ? 'closed' : 'open');
}

// ── UI: Dostępność nauczycieli ──
function genTeacherAvailUI(C) {
  if(!(appState.teachers||[]).length)
    return '<div style="color:var(--text-d);font-size:.78rem">Brak nauczycieli</div>';
  const hours  = (appState.hours||[]).slice().sort((a,b)=>a.num-b.num);
  const DSHORT = ['Pon','Wt','Śr','Czw','Pt'];

  return sortTeachers(appState.teachers).map(t => {
    const avail   = (C.teacherAvail||{})[t.id] || {};
    const nBlk    = Object.values(avail).filter(v=>v==='blocked').length;
    const nWin    = Object.values(avail).filter(v=>v==='window').length;
    const nPref   = Object.values(avail).filter(v=>v==='preferred').length;
    const hasAny  = nBlk||nWin||nPref;
    const isOpen  = localStorage.getItem('gen_tch_'+t.id) === 'open';

    // Mini-podgląd tygodnia (5×hours kolorowe kwadraty) gdy zwinięty
    const miniDots = DSHORT.map((_,di) =>
      hours.map(h => {
        const st = avail[`${di}_${h.num}`]||'';
        const bg = st==='blocked'?'var(--red)':st==='window'?'#f59e0b':st==='preferred'?'var(--accent)':'var(--s3)';
        return `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${bg}"></span>`;
      }).join('')
    ).map(row=>`<span style="display:flex;gap:1px">${row}</span>`).join('');

    // Buduj siatkę (tylko gdy rozwinięty)
    let grid = '';
    if(isOpen) {
      let cols = '';
      for(let di=0; di<5; di++) {
        let cells = `<div class="gen-avail-day">${DSHORT[di]}</div>`;
        hours.forEach(h => {
          const k   = `${di}_${h.num}`;
          const st  = avail[k]||'';
          const cls = st==='blocked'?'blocked':st==='preferred'?'preferred':st==='window'?'window':'';
          const lbl = st==='blocked'?'✕':st==='preferred'?'★':st==='window'?'◐':h.num;
          const ttl = st==='blocked'?'Zablokowana':st==='preferred'?'Preferowana':st==='window'?'Przymusowe okienko':'Dostępna';
          cells += `<div class="gen-avail-cell ${cls}" title="${DSHORT[di]} godz.${h.num} — ${ttl}"
            onclick="genCycleAvail('${t.id}','${k}')">${lbl}</div>`;
        });
        cols += `<div class="gen-avail-col">${cells}</div>`;
      }
      grid = `<div class="gen-avail-grid" style="grid-template-columns:repeat(5,1fr);margin-top:10px">${cols}</div>`;
    }

    const summary = hasAny
      ? [nBlk?`<span style="color:var(--red)">${nBlk}✕</span>`:'',
         nWin?`<span style="color:#f59e0b">${nWin}◐</span>`:'',
         nPref?`<span style="color:var(--accent)">${nPref}★</span>`:'']
        .filter(Boolean).join(' ')
      : '<span style="color:var(--text-d)">brak ograniczeń</span>';

    return `<div style="border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer"
        onclick="genToggleTch('${t.id}')">
        <span style="font-size:.78rem;font-weight:700;min-width:170px">${escapeHtml(t.last)} ${escapeHtml(t.first)}
          <span style="font-weight:400;color:var(--text-d);font-family:var(--mono);font-size:.68rem"> ${escapeHtml(t.abbr)}</span>
        </span>
        <span style="font-size:.72rem;display:flex;gap:4px">${summary}</span>
        ${hasAny ? `<div style="display:flex;flex-direction:column;gap:1px;margin-left:4px">${miniDots}</div>` : ''}
        <span style="margin-left:auto;color:var(--text-d);font-size:.8rem;transition:transform .2s;
          transform:${isOpen?'':'rotate(-90deg)'}" id="genTchArr_${t.id}">▼</span>
      </div>
      ${isOpen ? `<div style="padding-bottom:10px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button onclick="event.stopPropagation();genClearAvail('${t.id}')"
            style="font-size:.65rem;color:var(--text-d);background:none;border:1px solid var(--border);
                   border-radius:4px;padding:2px 8px;cursor:pointer">Wyczyść</button>
          <button onclick="event.stopPropagation();genBlockAllDay('${t.id}')"
            style="font-size:.65rem;color:var(--red);background:none;border:1px solid var(--red);
                   border-radius:4px;padding:2px 8px;cursor:pointer">Zablokuj cały tydzień</button>
        </div>
        ${grid}
      </div>` : ''}
    </div>`;
  }).join('');
}

function genToggleTch(tchId) {
  const cur = localStorage.getItem('gen_tch_'+tchId);
  localStorage.setItem('gen_tch_'+tchId, cur==='open' ? 'closed' : 'open');
  renderGenerator();
}

function genCycleAvail(tchId, key) {
  const C = getConstraints();
  if(!C.teacherAvail[tchId]) C.teacherAvail[tchId] = {};
  const cur = C.teacherAvail[tchId][key]||'';
  const nxt = cur===''?'blocked':cur==='blocked'?'window':cur==='window'?'preferred':'';
  if(!nxt) delete C.teacherAvail[tchId][key];
  else C.teacherAvail[tchId][key] = nxt;
  genRefreshTch(tchId);
}

function genRefreshTch(tchId) {
  // Odśwież tylko sekcję dostępności bez przeładowania całego widoku
  const C = getConstraints();
  const wrap = document.getElementById('genSec_avail');
  if(!wrap) { renderGenerator(); return; }
  wrap.innerHTML = genTeacherAvailUI(C);
}

function genClearAvail(tchId) {
  const C = getConstraints();
  C.teacherAvail[tchId] = {};
  genRefreshTch(tchId);
}

function genBlockAllDay(tchId) {
  const C = getConstraints();
  if(!C.teacherAvail[tchId]) C.teacherAvail[tchId] = {};
  const hours = (appState.hours||[]);
  for(let di=0;di<5;di++) hours.forEach(h => {
    C.teacherAvail[tchId][`${di}_${h.num}`] = 'blocked';
  });
  genRefreshTch(tchId);
}

// ── UI: Przydział godzin (podsumowanie assignments) ──
function genHoursUI() {
  const teachers = appState.teachers||[];
  const classes  = appState.classes||[];
  const subjects = appState.subjects||[];
  if(!teachers.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak nauczycieli</div>';

  let rows = '';
  sortTeachers(teachers).forEach(t => {
    const asgns = (t.assignments||[]).filter(a=>a.hours>0);
    if(!asgns.length) return;
    const assignedH = asgns.reduce((s,a)=>s+(a.hours||0),0);
    const niH = niPensumHours(t.id);
    const total = assignedH + niH;
    const pensum = t.hoursTotal||0;
    const diff   = total - pensum;
    const diffCol = diff>0?'var(--orange)':diff<0?'var(--red)':'var(--accent)';
    const diffStr = diff>0?`+${diff}`:diff<0?`${diff}`:'✓';

    const aList = asgns.map(a => {
      const cls  = classes.find(c=>c.id===a.classId);
      const subj = subjects.find(s=>s.id===a.subjectId);
      return `<span style="font-size:.68rem;background:var(--s3);border-radius:4px;padding:1px 6px;white-space:nowrap">
        ${escapeHtml(cls?.name||'?')} · ${escapeHtml(subj?.abbr||subj?.name||'?')} · ${a.hours}h
      </span>`;
    }).join('');

    rows += `<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:160px;font-size:.78rem;font-weight:600">${escapeHtml(t.last)} ${escapeHtml(t.first)}</div>
      <div style="flex:1;display:flex;flex-wrap:wrap;gap:4px">${aList}</div>
      <div style="font-size:.75rem;font-family:var(--mono);white-space:nowrap">
        ${total}h / ${pensum}h
        <span style="color:${diffCol};font-weight:700;margin-left:4px">${diffStr}</span>
      </div>
    </div>`;
  });

  return rows || '<div style="color:var(--text-d);font-size:.78rem">Brak przypisań — dodaj je w karcie nauczyciela</div>';
}

// ── UI: Bloki lekcji ──
function genBlocksUI(C) {
  const subjects = appState.subjects||[];
  if(!subjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów</div>';
  const activeSubjects = sortSubjects(subjects).filter(s => !(s.classes||[]).length || (appState.classes||[]).some(c => s.classes.includes(c.id)));
  if(!activeSubjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów z przypisanymi klasami</div>';

  return activeSubjects.map(s => {
    const block = (C.lessonBlocks||{})[s.id] || {blockSize:1};
    const noBlk = (C.noBlock||[]).includes(s.id);
    const dot   = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
                    background:${s.color||'#888'};flex-shrink:0"></span>`;
    return `<div class="gen-subj-row">
      <span class="gen-subj-name" style="display:flex;align-items:center;gap:6px">${dot}${escapeHtml(s.name)}</span>
      <div class="gen-field-row">
        <span class="gen-label">Rozmiar bloku:</span>
        <select class="gen-mini-select" onchange="genSetBlock('${s.id}',+this.value)"
          ${noBlk?'disabled title="Nie łącz — bloki wyłączone"':''}>
          <option value="1" ${block.blockSize<=1?'selected':''}>1h (pojedyncze)</option>
          <option value="2" ${block.blockSize==2?'selected':''}>2h (podwójne)</option>
          <option value="3" ${block.blockSize==3?'selected':''}>3h</option>
          <option value="4" ${block.blockSize==4?'selected':''}>4h</option>
        </select>
        <span class="gen-label" style="margin-left:10px">Zakaz łączenia:</span>
        <div class="gen-pill ${noBlk?'danger':''}" onclick="genToggleNoBlock('${s.id}')">
          ${noBlk?'🚫 Nie łączyć':'Można łączyć'}
        </div>
      </div>
    </div>`;
  }).join('');
}

function genSetBlock(subjId, size) {
  const C = getConstraints();
  if(!C.lessonBlocks) C.lessonBlocks={};
  C.lessonBlocks[subjId] = {blockSize: size};
}

function genToggleNoBlock(subjId) {
  const C = getConstraints();
  if(!C.noBlock) C.noBlock=[];
  const i = C.noBlock.indexOf(subjId);
  if(i>=0) C.noBlock.splice(i,1); else C.noBlock.push(subjId);
  renderGenerator();
}

// ── UI: Pozycja przedmiotów ──
function genPositionUI(C) {
  const subjects = appState.subjects||[];
  if(!subjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów</div>';
  const activeSubjects = sortSubjects(subjects).filter(s => !(s.classes||[]).length || (appState.classes||[]).some(c => s.classes.includes(c.id)));
  if(!activeSubjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów z przypisanymi klasami</div>';

  // Zbierz automatyczne reguły z optionalSubjects (stary) i grup z edgePosition (nowy)
  const autoPositions = {}; // subjId → Set('edge')
  (appState.classes||[]).forEach(cls => {
    // Stary system
    (cls.optionalSubjects||[]).forEach(o => {
      if(o.position && o.position !== 'any') {
        if(!autoPositions[o.subjId]) autoPositions[o.subjId] = new Set();
        autoPositions[o.subjId].add(o.position);
      }
    });
    // Nowy system: grupy z edgePosition
    // Szukamy przedmiotu przypisanego do tej grupy przez nauczyciela
    (cls.groups||[]).filter(g=>g.edgePosition && (g.type==='group'||g.type==='small')).forEach(g => {
      // Znajdź przedmioty prowadzone przez nauczyciela tej grupy dla tej klasy
      const tchId = g.teacherId;
      const tch = tchId ? (appState.teachers||[]).find(t=>t.id===tchId) : null;
      (tch?.assignments||[]).filter(a=>a.classId===cls.id).forEach(a => {
        if(!autoPositions[a.subjectId]) autoPositions[a.subjectId] = new Set();
        autoPositions[a.subjectId].add('edge');
      });
    });
  });

  const POS = [
    ['any',   'Dowolna',      ''],
    ['edge',  'Skrajne',      '⇔'],
    ['first', 'Na początku',  '🌅'],
    ['last',  'Na końcu',     '🌇'],
  ];

  return activeSubjects.map(s => {
    const pos        = (C.subjPosition||{})[s.id]||'any';
    const isAutoEdge = autoPositions[s.id]?.has('edge');
    const dot        = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
                         background:${s.color||'#888'};flex-shrink:0"></span>`;

    // Przedmiot z wymuszonym edge (jawnie ustawione w opcjonalnych) — zablokuj UI
    if(isAutoEdge) {
      return `<div class="gen-subj-row">
        <span class="gen-subj-name" style="display:flex;align-items:center;gap:6px">
          ${dot}${escapeHtml(s.name)}
          <span style="font-size:.66rem;padding:2px 8px;border-radius:10px;
            background:var(--accent-g);color:var(--accent);border:1px solid var(--accent)44">
            ⇔ skrajne godziny (z ustawień klasy)
          </span>
        </span>
        <span style="font-size:.7rem;color:var(--text-d);font-style:italic">— ustaw w modalu klasy → Grupy międzyoddziałowe</span>
      </div>`;
    }

    // Pozostałe — pełny wybór z opcją Skrajne
    const pills = POS.map(([v,l,ic]) =>
      `<div class="gen-pill ${pos===v?'active':''}" onclick="genSetPosition('${s.id}','${v}')"
        title="${v==='edge'?'Pierwsza lub ostatnia godzina (bez preferencji)':''}">
        ${ic} ${l}
      </div>`
    ).join('');
    return `<div class="gen-subj-row">
      <span class="gen-subj-name" style="display:flex;align-items:center;gap:6px">${dot}${escapeHtml(s.name)}</span>
      <div class="gen-field-row">${pills}</div>
    </div>`;
  }).join('');
}

function genSetPosition(subjId, val) {
  const C = getConstraints();
  if(!C.subjPosition) C.subjPosition={};
  C.subjPosition[subjId] = val;
  renderGenerator();
}

// ── UI: Podział na grupy ──
function genGroupsUI(C) {
  const classes  = appState.classes||[];
  const subjects = appState.subjects||[];
  if(!classes.length||!subjects.length)
    return '<div style="color:var(--text-d);font-size:.78rem">Brak klas lub przedmiotów</div>';

  // Zbierz przedmioty opcjonalne ze wszystkich klas — te są automatycznie w grupach
  // Klucz clsId_subjId → true oznacza auto-grupę z optionalSubjects
  const autoGroups = {};
  classes.forEach(cls => {
    (cls.optionalSubjects||[]).forEach(o => {
      if(o.subjId) autoGroups[cls.id+'_'+o.subjId] = true;
    });
  });

  let html = '';

  // Zbierz połączenia między-klasowe
  const mergeGroups = {}; // "subjId|cls1,cls2,cls3" → [clsId...]
  classes.forEach(cls => {
    (cls.optionalSubjects||[]).forEach(o => {
      if(!o.subjId || !(o.mergeWith||[]).length) return;
      const allCls = [cls.id, ...o.mergeWith].sort().join(',');
      const key = o.subjId+'|'+allCls;
      mergeGroups[key] = mergeGroups[key] || {subjId:o.subjId, clsIds:[cls.id,...o.mergeWith]};
    });
  });
  const mergeList = Object.values(mergeGroups);

  // Info o auto-grupach i połączeniach
  if(Object.keys(autoGroups).length || mergeList.length) {
    let infoHtml = `<div style="padding:8px 12px;background:var(--accent-g);border:1px solid var(--accent)44;
      border-radius:8px;margin-bottom:12px;font-size:.72rem;color:var(--text-m)">
      <strong style="color:var(--accent)">◑ Grupy automatyczne</strong> —
      przedmioty opcjonalne klas są automatycznie traktowane jako równoległe grupy.`;
    if(mergeList.length) {
      infoHtml += `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
        <strong style="color:var(--accent)">🔗 Połączenia między-klasowe:</strong>`;
      mergeList.forEach(m => {
        const s = subjects.find(s=>s.id===m.subjId);
        const clsNames = m.clsIds.map(id=>escapeHtml(classes.find(c=>c.id===id)?.name||'?'));
        const total = m.clsIds.reduce((sum,id)=>{
          const cls=classes.find(c=>c.id===id);
          const entry=(cls?.optionalSubjects||[]).find(o=>o.subjId===m.subjId);
          return sum+(entry?.count||0);
        },0);
        infoHtml += `<div style="display:flex;align-items:center;gap:6px;padding-left:8px">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${s?.color||'#888'}"></span>
          <strong>${escapeHtml(s?.name||'?')}</strong>:
          ${clsNames.map(n=>`<span style="padding:1px 6px;background:var(--s3);border-radius:5px;font-size:.68rem">${n}</span>`).join(' + ')}
          ${total?`<span style="color:var(--accent);font-family:var(--mono)">${total} uczniów</span>`:''}
          → jeden nauczyciel, jedna sala
        </div>`;
      });
      infoHtml += `</div>`;
    }
    infoHtml += `</div>`;
    html += infoHtml;
  }

  html += sortByName(classes).map(cls => {
    // Pokaż tylko przedmioty przypisane do tej klasy
    const clsSubjects = sortSubjects(subjects).filter(s =>
      !(s.classes||[]).length || s.classes.includes(cls.id)
    );
    if(!clsSubjects.length) return `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div style="font-size:.75rem;font-weight:700;margin-bottom:4px">${escapeHtml(cls.name)}</div>
      <div style="font-size:.72rem;color:var(--text-d)">Brak przypisanych przedmiotów</div>
    </div>`;

    const pills = clsSubjects.map(s => {
      const key    = cls.id+'_'+s.id;
      const isAuto = !!autoGroups[key];
      const active = isAuto || !!(C.groupSplit||{})[key];
      const dot    = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;
                       background:${s.color||'#888'}"></span>`;
      if(isAuto) {
        return `<div class="gen-pill active" style="gap:5px;opacity:.85;cursor:default" title="${escapeHtml(s.name)} — automatycznie w grupie (przedmiot opcjonalny)">
          ${dot} ${escapeHtml(s.abbr||s.name)}
          <span style="font-size:.58rem;padding:0 4px;border-radius:5px;background:rgba(255,255,255,.25)">auto</span>
        </div>`;
      }
      return `<div class="gen-pill ${active?'active':''}" style="gap:5px"
        onclick="genToggleGroup('${cls.id}','${s.id}')" title="${escapeHtml(s.name)}">
        ${dot} ${escapeHtml(s.abbr||s.name)}
      </div>`;
    }).join('');

    // Grupy NI i małe — pokaż informacyjnie
    const specialGroups = (cls.groups||[]).filter(g=>g.type==='indiv'||g.type==='small');
    const specialPills = specialGroups.map(g => {
      const tch = g.teacherId ? (appState.teachers||[]).find(t=>t.id===g.teacherId) : null;
      const icon = g.type==='indiv' ? '👤' : '👤👤';
      return `<div class="gen-pill active" style="gap:4px;opacity:.9;cursor:default;
        border-color:var(--accent)" title="${escapeHtml(g.type==='indiv'?'Nauczanie indywidualne':'Mała grupa')}: ${escapeHtml(g.name)}">
        ${icon} ${escapeHtml(g.name)}${tch?' · '+escapeHtml(tch.abbr):''}
        <span style="font-size:.58rem;padding:0 4px;border-radius:5px;background:rgba(255,255,255,.25)">
          ${g.type==='indiv'?'NI':g.studentCount+'os.'}
        </span>
      </div>`;
    }).join('');

    return `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">
      <div style="font-size:.75rem;font-weight:700;margin-bottom:6px">${escapeHtml(cls.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${pills}
        ${specialPills}
      </div>
    </div>`;
  }).join('');

  return html;
}

function genToggleGroup(clsId, subjId) {
  const C = getConstraints();
  if(!C.groupSplit) C.groupSplit={};
  const key = clsId+'_'+subjId;
  if(C.groupSplit[key]) delete C.groupSplit[key];
  else C.groupSplit[key] = {groups:2};
  renderGenerator();
}

// ── UI: Max per dzień ──
function genMaxDayUI(C) {
  const subjects = appState.subjects||[];
  if(!subjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów</div>';
  const activeSubjects = sortSubjects(subjects).filter(s => !(s.classes||[]).length || (appState.classes||[]).some(c => s.classes.includes(c.id)));
  if(!activeSubjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów z przypisanymi klasami</div>';

  return activeSubjects.map(s => {
    const mx  = (C.maxPerDay||{})[s.id]||0;
    const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
                  background:${s.color||'#888'};flex-shrink:0"></span>`;
    return `<div class="gen-subj-row">
      <span class="gen-subj-name" style="display:flex;align-items:center;gap:6px">${dot}${escapeHtml(s.name)}</span>
      <div class="gen-field-row">
        <span class="gen-label">Max dziennie per klasa:</span>
        <select class="gen-mini-select" onchange="genSetMaxDay('${s.id}',+this.value)">
          <option value="0" ${!mx?'selected':''}>Bez limitu</option>
          <option value="1" ${mx==1?'selected':''}>1×</option>
          <option value="2" ${mx==2?'selected':''}>2×</option>
          <option value="3" ${mx==3?'selected':''}>3×</option>
        </select>
      </div>
    </div>`;
  }).join('');
}

function genSetMaxDay(subjId, val) {
  const C = getConstraints();
  if(!C.maxPerDay) C.maxPerDay={};
  if(!val) delete C.maxPerDay[subjId];
  else C.maxPerDay[subjId] = val;
}

// ── UI: Preferencje sal ──
function genRoomPrefUI() {
  const rooms    = appState.rooms||[];
  const subjects = appState.subjects||[];
  if(!rooms.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak sal</div>';

  const withPref = rooms.filter(r=>(r.preferredSubjects||[]).length>0);
  const withCust = rooms.filter(r=>(r.custodians||[]).length>0);

  let html = `<p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px">
    Preferencje sal wynikają z ustawień sali (zakładka Sale w Ustawieniach).
    Poniżej podsumowanie — edytuj sale tam aby zmienić przypisania.
  </p>`;

  if(!withPref.length && !withCust.length) {
    html += `<div style="color:var(--text-d);font-size:.78rem">
      Żadna sala nie ma przypisanych preferowanych przedmiotów ani opiekunów.
      <button onclick="switchView('settings',document.querySelector('[data-view=settings]'))"
        style="font-size:.72rem;color:var(--accent);background:none;border:none;cursor:pointer;
               text-decoration:underline">Przejdź do Ustawień →</button>
    </div>`;
    return html;
  }

  html += sortByName(rooms).filter(r=>(r.preferredSubjects||[]).length||(r.custodians||[]).length).map(r => {
    const prefs = (r.preferredSubjects||[]).map(sid => {
      const s = subjects.find(s=>s.id===sid);
      return s ? `<span style="font-size:.68rem;padding:1px 6px;border-radius:10px;
        background:${s.color||'#888'}22;border:1px solid ${s.color||'#888'}44;
        color:var(--text)">${escapeHtml(s.name)}</span>` : '';
    }).filter(Boolean).join(' ');

    const custs = (r.custodians||[]).map(tid => {
      const t = (appState.teachers||[]).find(t=>t.id===tid);
      return t ? `<span style="font-size:.68rem;color:var(--text-m)">${escapeHtml(t.abbr)}</span>` : '';
    }).filter(Boolean).join(', ');

    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="font-size:.78rem;font-weight:600;min-width:100px">${escapeHtml(r.name)}</span>
      ${prefs ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${prefs}</div>` : ''}
      ${custs ? `<span style="font-size:.72rem;color:var(--text-d)">Opiekun: ${custs}</span>` : ''}
      <button onclick="openEditRoomModal('${r.id}')"
        style="font-size:.65rem;color:var(--accent);background:none;border:none;cursor:pointer;
               margin-left:auto">✎ edytuj</button>
    </div>`;
  }).join('');

  return html;
}


// ── UI: Analiza sal ──
function genCapacityUI() {
  const rooms    = appState.rooms||[];
  const classes  = appState.classes||[];
  const subjects = appState.subjects||[];
  const teachers = appState.teachers||[];
  const hours    = (appState.hours||[]);

  if(!rooms.length) return `<div style="color:var(--text-d);font-size:.78rem">
    Brak sal — <button onclick="switchView('settings',document.querySelector('[data-view=settings]'))"
      style="color:var(--accent);background:none;border:none;cursor:pointer;text-decoration:underline">
      dodaj sale w Ustawieniach →</button></div>`;

  let html = `<p style="font-size:.72rem;color:var(--text-m);margin:0 0 14px">
    Trzy analizy: (1) czy sal wystarczy na szczyt obłożenia,
    (2) czy sale specjalistyczne nie będą zajęte przez nieodpowiednie przedmioty,
    (3) czy sale mają ograniczenia wiekowe.
  </p>`;

  // ═══════════════════════════════════════════════════
  // ANALIZA 1 — Równoczesne zapotrzebowanie na sale
  // ═══════════════════════════════════════════════════
  const totalRooms = rooms.length;

  // Grupy łączone między klasami
  const mergedGroups = [];
  const processedKeys = new Set();
  classes.forEach(cls => {
    (cls.optionalSubjects||[]).forEach(o => {
      if(!o.subjId) return;
      const allCls = [cls.id,...(o.mergeWith||[])].sort();
      const key = allCls.join('|')+':'+o.subjId;
      if(processedKeys.has(key)) return;
      processedKeys.add(key);
      if(o.mergeWith?.length) mergedGroups.push({subjId:o.subjId, clsIds:allCls});
    });
  });

  // Zapotrzebowanie: każda klasa = 1 sala, każdy opcjonalny w klasie = +1 sala
  const extraForOptional = classes.reduce((s,cls)=>s+(cls.optionalSubjects||[]).length, 0);
  const mergedSavings    = mergedGroups.reduce((s,g)=>s+(g.clsIds.length-1), 0);
  const maxNeeded        = classes.length + extraForOptional - mergedSavings;
  const ok1   = totalRooms >= maxNeeded;
  const diff1 = totalRooms - maxNeeded;
  const c1    = ok1 ? 'var(--accent)' : 'var(--red)';

  html += `<div style="margin-bottom:20px">
    <div style="font-size:.75rem;font-weight:700;color:var(--text);margin-bottom:8px;
      display:flex;align-items:center;gap:6px">
      <span style="color:${c1}">${ok1?'✓':'✕'}</span> 1. Równoczesne zapotrzebowanie na sale
    </div>
    <div style="padding:10px 14px;border-radius:8px;background:${c1}10;border:1px solid ${c1}33">
      <div style="font-size:.78rem;color:var(--text-m);display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;justify-content:space-between">
          <span>Liczba klas</span>
          <span style="font-family:var(--mono)">${classes.length}</span>
        </div>
        ${extraForOptional?`<div style="display:flex;justify-content:space-between">
          <span>Przedmioty opcjonalne (+1 sala per równoległa grupa)</span>
          <span style="font-family:var(--mono);color:var(--orange)">+${extraForOptional}</span>
        </div>`:''}
        ${mergedSavings?`<div style="display:flex;justify-content:space-between">
          <span>Grupy łączone między klasami (oszczędność)</span>
          <span style="font-family:var(--mono);color:var(--accent)">−${mergedSavings}</span>
        </div>`:''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);
          padding-top:5px;margin-top:3px;font-weight:700">
          <span>Maks. równoczesne zapotrzebowanie</span>
          <span style="font-family:var(--mono);color:${c1}">${maxNeeded}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>Dostępnych sal w szkole</span>
          <span style="font-family:var(--mono);color:${c1}">${totalRooms}
            ${ok1?`<span style="color:var(--accent)">(zapas: ${diff1})</span>`:`<span style="color:var(--red)">(brakuje: ${-diff1})</span>`}
          </span>
        </div>
      </div>
      ${!ok1?`<div style="margin-top:8px;font-size:.72rem;color:var(--text-m);
        padding:7px;background:var(--s1);border-radius:6px;line-height:1.6">
        <strong style="color:var(--red)">Co zrobić:</strong><br>
        • Zablokuj nauczycielom godziny w sekcji <em>Dostępność nauczycieli</em>
          — solver rozłoży klasy nierównomiernie i nie wszystkie będą miały lekcję jednocześnie.<br>
        • Połącz więcej małych grup opcjonalnych między klasami (mniej sal potrzebnych).<br>
        • Przeznacz sale specjalistyczne tylko dla właściwych przedmiotów
          — wtedy inne klasy nie będą mogły do nich wejść i solver będzie lepiej rozdzielał klasy.
      </div>`:''}
    </div>
  </div>`;

  // ═══════════════════════════════════════════════════
  // ANALIZA 2 — Sale specjalistyczne vs przedmioty
  // ═══════════════════════════════════════════════════
  const specialRooms = rooms.filter(r=>(r.preferredSubjects||[]).length > 0);
  const issues2 = [];

  specialRooms.forEach(room => {
    const prefSubjIds = room.preferredSubjects||[];
    // Ile klas ma lekcje z tych przedmiotów jednocześnie?
    const subjNames = prefSubjIds.map(id=>subjects.find(s=>s.id===id)?.name).filter(Boolean);
    // Dla każdego NIE-preferowanego przedmiotu — ile klas może trafić do tej sali
    // Znajdź wszystkie klasy które nie mają tego przedmiotu w planie = mogą "zająć" salę
    const clsWithPrefSubj = new Set();
    teachers.forEach(t => {
      (t.assignments||[]).forEach(a => {
        if(prefSubjIds.includes(a.subjectId)) clsWithPrefSubj.add(a.classId);
      });
    });
    const clsNeedingRoom = clsWithPrefSubj.size;
    // Jeśli sal z tym przedmiotem jest mniej niż klas potrzebujących ich jednocześnie
    const sameTypeSals = specialRooms.filter(r2=>
      prefSubjIds.some(id=>(r2.preferredSubjects||[]).includes(id))
    ).length;
    if(clsNeedingRoom > sameTypeSals) {
      issues2.push({room, subjNames, clsNeedingRoom, sameTypeSals});
    }
  });

  html += `<div style="margin-bottom:20px">
    <div style="font-size:.75rem;font-weight:700;color:var(--text);margin-bottom:8px;
      display:flex;align-items:center;gap:6px">
      <span style="color:${issues2.length?'var(--orange)':'var(--accent)'}">${issues2.length?'⚠':'✓'}</span>
      2. Sale specjalistyczne — ryzyko zajęcia przez nieodpowiedni przedmiot
    </div>`;

  if(!specialRooms.length) {
    html += `<div style="font-size:.72rem;color:var(--text-d);padding:8px 12px;
      background:var(--s2);border-radius:7px">
      Brak sal z przypisanymi preferowanymi przedmiotami.
      Ustaw preferowane przedmioty w Ustawieniach → Sale (np. sala komp. → Informatyka),
      a solver będzie pilnował żeby inne przedmioty jej nie zajęły.
      <button onclick="switchView('settings',document.querySelector('[data-view=settings]'))"
        style="font-size:.68rem;color:var(--accent);background:none;border:none;cursor:pointer;
               text-decoration:underline;display:block;margin-top:4px">
        Przejdź do Ustawień →</button>
    </div>`;
  } else {
    // Pokaż sale specjalistyczne i ich przypisania
    html += `<div style="display:flex;flex-direction:column;gap:5px">`;
    specialRooms.forEach(r => {
      const sNames = (r.preferredSubjects||[]).map(id=>subjects.find(s=>s.id===id)?.name).filter(Boolean);
      const issue  = issues2.find(i=>i.room.id===r.id);
      const c      = issue ? 'var(--orange)' : 'var(--accent)';
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
        border-radius:7px;background:${c}0d;border:1px solid ${c}33">
        <span style="font-size:.78rem;font-weight:600;min-width:90px">${r.name}</span>
        <span style="font-size:.68rem;color:var(--text-m)">tylko dla:</span>
        <span style="font-size:.7rem;color:${c}">${sNames.join(', ')||'—'}</span>
        ${issue?`<span style="font-size:.68rem;color:var(--orange);margin-left:auto">
          ⚠ ${issue.clsNeedingRoom} klas potrzebuje, ${issue.sameTypeSals} sal dostępnych</span>`
          :`<span style="font-size:.68rem;color:var(--accent);margin-left:auto">✓ OK</span>`}
      </div>`;
    });
    html += `</div>
    <div style="font-size:.7rem;color:var(--text-d);margin-top:6px">
      Solver nie przydzieli tych sal do innych przedmiotów — ale tylko jeśli masz wystarczającą
      liczbę zwykłych sal dla pozostałych klas.
    </div>`;
  }
  html += `</div>`;

  // ═══════════════════════════════════════════════════
  // ANALIZA 3 — Ograniczenia wiekowe sal
  // ═══════════════════════════════════════════════════
  html += `<div>
    <div style="font-size:.75rem;font-weight:700;color:var(--text);margin-bottom:8px;
      display:flex;align-items:center;gap:6px">
      🎓 3. Ograniczenia wiekowe sal
    </div>
    <div style="font-size:.72rem;color:var(--text-m);padding:8px 12px;
      background:var(--s2);border-radius:7px;margin-bottom:8px">
      Oznacz w ustawieniach sali jakie klasy mogą z niej korzystać (np. sala dla klas 1–3).
      Solver nie przydzieli wtedy klasy 8 do sali dla maluchów.
    </div>`;

  // Pokaż sale z ograniczeniami wiekowymi (pole note jako wskazówka lub dedykowane pole)
  // Sprawdź czy któraś sala ma w nazwie/uwagach sugestię wiekową
  const ageRooms = rooms.filter(r => {
    const note = (r.note||'').toLowerCase();
    const name = (r.name||'').toLowerCase();
    return /kl\.|klasa|klas|1-3|4-6|7-8|sp|wczesno|młod|star/.test(note+name);
  });

  if(ageRooms.length) {
    html += `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">`;
    ageRooms.forEach(r => {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;
        border-radius:6px;background:var(--orange)0d;border:1px solid var(--orange)33">
        <span style="font-size:.72rem;font-weight:600">${r.name}</span>
        <span style="font-size:.68rem;color:var(--text-m)">${r.note||''}</span>
        <button onclick="openEditRoomModal('${r.id}')"
          style="margin-left:auto;font-size:.65rem;color:var(--accent);background:none;
                 border:none;cursor:pointer">✎ edytuj</button>
      </div>`;
    });
    html += `</div>`;
  }

  html += `<div style="font-size:.7rem;color:var(--text-d)">
    💡 Wpisz w polu <em>Uwagi</em> sali np. <code>kl. 1–3</code> lub <code>edukacja wczesnoszkolna</code>
    — solver w Etapie 2 odczyta to jako ograniczenie wiekowe.
  </div></div>`;

  return html;
}

function saveSchoolSettings() {
  if(!appState) return;
  appState.schoolYear = document.getElementById('setSchoolYear').value.trim();
  appState.year       = appState.schoolYear; // synchronizuj stare pole
  appState.activeSem  = parseInt(document.getElementById('setActiveSem').value)||1;
  const KEYS = ['mon','tue','wed','thu','fri'];
  if(!appState.schoolWindow) appState.schoolWindow = {};
  KEYS.forEach((k,di) => {
    const from = parseInt(document.getElementById('swFrom_'+di).value)||null;
    const to   = parseInt(document.getElementById('swTo_'+di).value)||null;
    const off  = document.getElementById('swOff_'+di).checked;
    appState.schoolWindow[k] = [from, to, off||undefined].filter((_,i)=> i<2 || off);
    if(!from && !to && !off) appState.schoolWindow[k] = [null,null];
    if(off) appState.schoolWindow[k] = [null,null,true];
  });
  persistAll();
  renderSettings();
  updateTopbarInfo();
  notify('Ustawienia szkoły zapisane');
}

// ── UI: Max razy przedmiot pod rząd w tygodniu ──
function genMaxConsecutiveUI(C) {
  const subjects = appState.subjects||[];
  if(!subjects.length) return '<div style="color:var(--text-d);font-size:.78rem">Brak przedmiotów</div>';
  const activeSubjects = sortSubjects(subjects).filter(s =>
    !(s.classes||[]).length || (appState.classes||[]).some(c=>s.classes.includes(c.id))
  );
  return `<div style="font-size:.72rem;color:var(--text-m);margin-bottom:10px">
    Ogranicz ile razy dany przedmiot może wystąpić w kolejnych dniach tygodnia (pod rząd).
    Np. matematyka max 5 razy pod rząd = może być codziennie, ale WF max 3 = nie w każdym dniu.
  </div>` + activeSubjects.map(s => {
    const mx  = (C.maxConsecutive||{})[s.id]||0;
    const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
                  background:${s.color||'#888'};flex-shrink:0"></span>`;
    return `<div class="gen-subj-row">
      <span class="gen-subj-name" style="display:flex;align-items:center;gap:6px">${dot}${s.name}</span>
      <div class="gen-field-row">
        <span class="gen-label">Max dni pod rząd:</span>
        <select class="gen-mini-select" onchange="genSetMaxConsecutive('${s.id}',+this.value)">
          <option value="0" ${!mx?'selected':''}>Bez limitu</option>
          <option value="1" ${mx==1?'selected':''}>1 (nigdy dwa dni z rzędu)</option>
          <option value="2" ${mx==2?'selected':''}>2</option>
          <option value="3" ${mx==3?'selected':''}>3</option>
          <option value="4" ${mx==4?'selected':''}>4</option>
          <option value="5" ${mx==5?'selected':''}>5 (codziennie)</option>
        </select>
      </div>
    </div>`;
  }).join('');
}

function genSetMaxConsecutive(subjId, val) {
  const C = getConstraints();
  if(!C.maxConsecutive) C.maxConsecutive = {};
  if(!val) delete C.maxConsecutive[subjId];
  else C.maxConsecutive[subjId] = val;
}

// ── UI: Nauczanie indywidualne i grupowe ──
function genIndivTeachUI() {
  const teachers = appState.teachers||[];
  const subjects = appState.subjects||[];

  // Zbierz wszystkie wpisy NI i grupowe
  const allItems = [];
  sortTeachers(teachers).forEach(t => {
    (t.individualTeaching||[]).forEach(item => {
      allItems.push({t, item});
    });
  });

  if(!allItems.length && !(appState.classes||[]).some(c=>(c.groups||[]).some(g=>g.type==='indiv'))) {
    return `<div style="color:var(--text-d);font-size:.78rem">
      Brak wpisów nauczania indywidualnego lub grupowego.<br>
      Dodaj je w <strong>Ustawieniach → Nauczyciele → karta nauczyciela</strong>
      lub <strong>Ustawieniach → Klasy → karta klasy → Grupy → typ NI</strong>.
    </div>`;
  }

  // ── Wykryj nauczycieli łączących NI i regularne lekcje z tego samego przedmiotu ──
  const combinedTeachers = [];
  teachers.forEach(t => {
    (t.individualTeaching||[]).forEach(item => {
      if(!item.subjectId) return;
      // Czy ten nauczyciel prowadzi też regularne lekcje z tego przedmiotu?
      const regularAssign = (t.assignments||[]).filter(a=>a.subjectId===item.subjectId && a.hours>0);
      if(regularAssign.length) {
        regularAssign.forEach(a => {
          const cls = (appState.classes||[]).find(c=>c.id===a.classId);
          const subj = (appState.subjects||[]).find(s=>s.id===item.subjectId);
          combinedTeachers.push({t, item, assign:a, cls, subj});
        });
      }
    });
  });

  // Pogrupuj: indywidualne vs grupowe
  const indivItems = allItems.filter(({item}) => (item.students||1)===1 && !item.form.includes('grupow'));
  const groupItems = allItems.filter(({item}) => (item.students||1)>1  ||  item.form.includes('grupow'));

  let html = `<p style="font-size:.72rem;color:var(--text-m);margin:0 0 12px;line-height:1.6">
    Zajęcia indywidualne i grupowe (do 5 osób) są traktowane jak <strong>osobne klasy</strong> —
    solver przydziela im osobne sloty w planie, niezależne od regularnych lekcji.
    Wpisz w polach poniżej ile razy w tygodniu dane zajęcia powinny się odbyć (zwykle odpowiada to już wpisanym godzinom).
  </p>`;

  // ── Panel: nauczyciel łączy NI i regularne lekcje ──
  if(combinedTeachers.length) {
    html += `<div style="margin-bottom:14px;padding:10px 12px;
      background:var(--orange)10;border:1px solid var(--orange)40;border-radius:8px">
      <div style="font-size:.72rem;font-weight:700;color:var(--orange);margin-bottom:8px">
        ⚠ Nauczyciel prowadzi NI i regularne lekcje z tego samego przedmiotu
      </div>`;
    combinedTeachers.forEach(({t,item,assign,cls,subj}) => {
      html += `<div style="font-size:.74rem;color:var(--text-m);margin-bottom:5px;padding-left:8px">
        <strong style="color:var(--text)">${escapeHtml(t.abbr)}</strong> —
        <span style="color:${subj?.color||'var(--accent)'}">
          ${escapeHtml(subj?.name||'przedmiot')}</span>:
        NI z <strong>${escapeHtml(item.name)}</strong> (${item.hours}h)
        + regularne z <strong>${escapeHtml(cls?.name||'klasą')}</strong> (${assign.hours}h)<br>
        <span style="font-size:.68rem;color:var(--text-d)">
          Solver ułoży te lekcje w RÓŻNYCH slotach — nauczyciel nie może być jednocześnie
          przy uczniu NI i w klasie. Łącznie ${item.hours+assign.hours}h/${subj?.name||''} tygodniowo.
        </span>
      </div>`;
    });
    html += `<div style="font-size:.68rem;color:var(--text-d);margin-top:6px;padding-top:6px;
      border-top:1px solid var(--orange)30">
      💡 Jeśli uczeń NI ma tego samego nauczyciela co klasa z danego przedmiotu —
      klasa w godzinie NI ucznia po prostu ma o jednego ucznia mniej.
      To poprawna sytuacja pedagogiczna, solver sobie z tym radzi.
    </div>
    </div>`;
  }

  if(indivItems.length) {
    html += `<div style="font-size:.73rem;font-weight:700;color:var(--text-m);text-transform:uppercase;
      letter-spacing:.04em;margin-bottom:8px">👤 Nauczanie indywidualne</div>`;
    html += indivItems.map(({t, item}) => {
      const subj = item.subjectId ? subjects.find(s=>s.id===item.subjectId) : null;
      return `<div class="gen-subj-row">
        <span class="gen-subj-name" style="display:flex;flex-direction:column;gap:2px">
          <span style="font-weight:700">${escapeHtml(item.name)}</span>
          <span style="font-size:.68rem;color:var(--text-d)">${escapeHtml(t.abbr)} · ${escapeHtml(subj?.name||'—')} · ${escapeHtml(item.form)}</span>
        </span>
        <div class="gen-field-row">
          <span class="gen-label">Godz./tydz.:</span>
          <span style="font-family:var(--mono);font-size:.8rem;color:var(--accent);font-weight:700">${item.hours}</span>
          <span class="gen-label" style="margin-left:10px;color:var(--text-d);font-size:.68rem">
            (wg ustawień nauczyciela)
          </span>
        </div>
      </div>`;
    }).join('');
  }

  if(groupItems.length) {
    html += `<div style="font-size:.73rem;font-weight:700;color:var(--accent);text-transform:uppercase;
      letter-spacing:.04em;margin:${indivItems.length?12:0}px 0 8px">👥 Zajęcia w grupach (2–5 osób)</div>`;
    html += groupItems.map(({t, item}) => {
      const subj = item.subjectId ? subjects.find(s=>s.id===item.subjectId) : null;
      const students = item.students||2;
      return `<div class="gen-subj-row" style="border-left:3px solid var(--accent);padding-left:8px">
        <span class="gen-subj-name" style="display:flex;flex-direction:column;gap:2px">
          <span style="font-weight:700">${escapeHtml(item.name)}
            <span style="font-size:.68rem;background:var(--accent-g);color:var(--accent);
              padding:1px 6px;border-radius:8px;margin-left:4px">${students} ucz.</span>
          </span>
          <span style="font-size:.68rem;color:var(--text-d)">${escapeHtml(t.abbr)} · ${escapeHtml(subj?.name||'—')} · ${escapeHtml(item.form)}</span>
        </span>
        <div class="gen-field-row">
          <span class="gen-label">Godz./tydz.:</span>
          <span style="font-family:var(--mono);font-size:.8rem;color:var(--accent);font-weight:700">${item.hours}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ── Uczniowie z częściowym NI (z grup klas) ──
  const partialNI = [];
  (appState.classes||[]).forEach(cls => {
    (cls.groups||[]).filter(g=>g.type==='indiv' && (g.subjects||[]).length).forEach(g => {
      const tch = g.teacherId ? (appState.teachers||[]).find(t=>t.id===g.teacherId) : null;
      const subjNames = (g.subjects||[]).map(sid => {
        const s = (appState.subjects||[]).find(s=>s.id===sid);
        return s ? `<span style="font-size:.68rem;padding:1px 5px;border-radius:6px;
          background:${s.color}22;color:${s.color};border:1px solid ${s.color}44">${escapeHtml(s.abbr||s.name)}</span>` : '';
      }).join(' ');
      partialNI.push({cls, g, tch, subjNames});
    });
  });

  if(partialNI.length) {
    html += `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:.73rem;font-weight:700;color:var(--orange);text-transform:uppercase;
        letter-spacing:.04em;margin-bottom:8px">⚠ Uczniowie z częściowym NI (z klasą na część lekcji)</div>`;
    html += partialNI.map(({cls,g,tch,subjNames}) =>
      `<div class="gen-subj-row" style="border-left:3px solid var(--orange)">
        <span class="gen-subj-name" style="display:flex;flex-direction:column;gap:3px">
          <span style="font-weight:700">👤 ${escapeHtml(g.name)}
            <span style="font-size:.65rem;color:var(--text-m)">z klasy ${escapeHtml(cls.name)}</span>
          </span>
          <span style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">
            <span style="font-size:.65rem;color:var(--orange)">NI z:</span> ${subjNames}
            <span style="font-size:.65rem;color:var(--text-d)">· reszta z klasą</span>
          </span>
        </span>
        <div class="gen-field-row" style="flex-direction:column;align-items:flex-end;gap:2px">
          ${tch ? `<span style="font-size:.7rem;font-family:var(--mono);color:var(--text-m)">${escapeHtml(tch.abbr)}</span>` : '<span style="font-size:.65rem;color:var(--red)">⚠ brak nauczyciela</span>'}
          <span style="font-size:.62rem;color:var(--text-d)">solver pilnuje konfliktu</span>
        </div>
      </div>`
    ).join('');
    html += '</div>';
  }

  // Podsumowanie
  const totalHours = allItems.reduce((s,{item})=>s+item.hours,0);
  const totalStudents = allItems.reduce((s,{item})=>s+(item.students||1),0);
  html += `<div style="margin-top:12px;padding:8px 12px;background:var(--s2);border-radius:7px;
    font-size:.72rem;color:var(--text-m)">
    Łącznie: <strong>${totalHours} godz./tydz.</strong> dla ${totalStudents} uczniów
    w ${allItems.length} zajęciach — solver zarezerwuje osobne sloty.
    ${partialNI.length ? '<br>⚠ '+partialNI.length+' uczeń/uczniów z częściowym NI — solver pilnuje by nie nakładały się z lekcjami klasy.' : ''}
  </div>`;

  return html;
}

function genSaveConstraints() {
  persistAll();
  notify('Warunki generatora zapisane');
}

// ================================================================
//  SOLVER — Etap 2
//  Zachłanny z backtrackingiem + lokalna optymalizacja (SA)
// ================================================================

// ================================================================
//  SOLVER — Etap 2
//  Architektura: główny wątek steruje UI, solver działa jako
//  inline Web Worker (blob URL) żeby nie blokować interfejsu.
//  Algorytm: Greedy + Simulated Annealing
// ================================================================

function genRun() {
  if(!appState) { notify('Brak danych szkoły','warn'); return; }
  const C       = getConstraints();
  const hours   = (appState.hours||[]).slice().sort((a,b)=>a.num-b.num);
  const classes = appState.classes||[];
  const teachers= appState.teachers||[];
  const subjects= appState.subjects||[];
  const rooms   = appState.rooms||[];

  if(!hours.length)   { notify('Uzupełnij godziny lekcyjne','warn'); return; }
  if(!classes.length) { notify('Dodaj klasy','warn'); return; }
  if(!teachers.length){ notify('Dodaj nauczycieli','warn'); return; }

  const hasAssignments = teachers.some(t=>(t.assignments||[]).some(a=>a.hours>0));
  if(!hasAssignments) { notify('Brak przydziałów godzin — przypisz nauczycielom klasy i przedmioty','warn'); return; }

  // Pokaż UI postępu
  const wrap = document.getElementById('generatorContent');
  wrap.innerHTML = `<div style="max-width:900px">
    <div class="gen-run-bar" style="margin-bottom:10px">
      <span style="font-size:1.2rem">⚡</span>
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:700">Generowanie planu…</div>
        <div style="font-size:.72rem;color:var(--text-m);margin-top:2px" id="genStatus">Przygotowanie…</div>
      </div>
      <button class="wbtn wbtn-ghost" style="font-size:.78rem" onclick="genStop()">✕ Zatrzymaj</button>
    </div>
    <div style="height:8px;background:var(--s3);border-radius:4px;overflow:hidden;margin-bottom:12px">
      <div id="genPBar" style="height:100%;width:0%;background:var(--accent);border-radius:4px;transition:width .4s"></div>
    </div>
    <div class="gen-log" id="genLog" style="height:180px;font-size:.68rem"></div>
    <div id="genResultArea" style="margin-top:16px"></div>
  </div>`;

  // Przygotuj dane do solvera
  const payload = {
    C,
    hours,
    days: genActiveDays(C),
    classes:  classes.map(c=>({
      id:c.id, name:c.name, studentCount:c.studentCount||0,
      optionalSubjects:(c.optionalSubjects||[]),
      homeRooms:(c.homeRooms||[]),
      // Grupy NI
      niGroups:(c.groups||[])
        .filter(g=>(typeof g==='object') && g.type==='indiv')
        .map(g=>({
          id:g.id||g.name, name:g.name,
          teacherId:g.teacherId||null,
          niSubjects: g.subjects||[]
        })),
      // Grupy łączone (type=group/small z linkedWith)
      groups:(c.groups||[])
        .filter(g=>(typeof g==='object') && (g.type==='group'||g.type==='small'))
        .map(g=>({
          id:g.id, name:g.name, type:g.type,
          teacherId:g.teacherId||null,
          studentCount:g.studentCount||0,
          linkedWith:(g.linkedWith||[]),
          edgePosition:!!(g.edgePosition)
        }))
    })),
    teachers: teachers.map(t=>({
      id:t.id, abbr:t.abbr, first:t.first, last:t.last,
      hoursTotal:t.hoursTotal||0, hoursExtra:t.hoursExtra||0,
      employment:t.employment||'full',
      employmentFraction:t.employmentFraction||1,
      assignments:(t.assignments||[]).filter(a=>a.hours>0),
      availability:((C.teacherAvail||{})[t.id])||{},
      individualTeaching:(t.individualTeaching||[]).map(i=>({...i, students:i.students||1}))
    })),
    subjects: subjects.map(s=>({
      id:s.id, name:s.name, abbr:s.abbr, color:s.color,
      duration:s.duration||'year', classes:s.classes||[]
    })),
    rooms: rooms.map(r=>({
      id:r.id, name:r.name, type:r.type||'full',
      capacity:r.capacity||0,
      preferredSubjects:r.preferredSubjects||[],
      note:r.note||''
    })),
    activeSem: appState.activeSem||1,
    schoolWindow: appState.schoolWindow||{},
    niStudents: (appState.niStudents||[]).map(s=>({id:s.id,name:s.name,classId:s.classId||null,studentCount:s.studentCount||1,subjects:(s.subjects||[]).map(r=>({...r}))}))
  };

  window._genWorker = genRunWorker(payload);
}

function genActiveDays(C) {
  const win = C.schoolWindow || appState.schoolWindow || {};
  const keys = ['mon','tue','wed','thu','fri'];
  return [0,1,2,3,4].filter(di => !(win[keys[di]]||[])[2]);
}

function genStop() {
  if(window._genWorker) { window._genWorker.terminate(); window._genWorker=null; }
  renderGenerator();
  notify('Generowanie zatrzymane');
}

function genLog(msg) {
  const el = document.getElementById('genLog');
  if(!el) return;
  el.textContent += (el.textContent?'\n':'')+msg;
  el.scrollTop = el.scrollHeight;
}
function genStatus(msg) {
  const el = document.getElementById('genStatus'); if(el) el.textContent=msg;
}
function genProgress(pct) {
  const el = document.getElementById('genPBar'); if(el) el.style.width=Math.round(pct)+'%';
}

// ── Uruchom solver jako Web Worker (blob) ──
function genRunWorker(payload) {
  const workerCode = `(${genWorkerFn.toString()})()`;
  const blob   = new Blob([workerCode], {type:'application/javascript'});
  const url    = URL.createObjectURL(blob);
  const worker = new Worker(url);

  worker.onmessage = (e) => {
    const msg = e.data;
    if(msg.type==='log')      genLog(msg.text);
    if(msg.type==='status')   genStatus(msg.text);
    if(msg.type==='progress') genProgress(msg.pct);
    if(msg.type==='done')     genHandleResult(msg.result, msg.warnings, msg.stats);
    if(msg.type==='error')    { genLog('BŁĄD: '+msg.text); genStatus('Błąd solvera'); }
  };
  worker.onerror = (e) => { genLog('Worker error: '+e.message); };
  worker.postMessage(payload);
  URL.revokeObjectURL(url);
  return worker;
}

// ── Obsługa wyniku ──
function genHandleResult(newSched, warnings, stats) {
  window._genSched    = newSched;
  window._genWarnings = warnings;

  const placed  = stats.placed||0;
  const total   = stats.total||0;
  const pct     = total ? Math.round(placed/total*100) : 100;
  const perfect = placed >= total;

  genProgress(100);
  genStatus(perfect ? '✓ Plan ułożony kompletnie!' : `Ułożono ${pct}% lekcji`);

  // Raport
  let html = `<div style="padding:14px 16px;border-radius:10px;margin-bottom:12px;
    background:${perfect?'var(--accent)':'var(--orange)'}12;
    border:2px solid ${perfect?'var(--accent)':'var(--orange)'}44">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:1.3rem">${perfect?'🎉':'⚠'}</span>
      <div>
        <div style="font-size:.85rem;font-weight:700">
          ${perfect?'Plan kompletny!':'Plan częściowy — '+placed+' z '+total+' lekcji ('+pct+'%)'}
        </div>
        <div style="font-size:.72rem;color:var(--text-m)">
          Czas generowania: ${(stats.ms/1000).toFixed(1)}s · 
          ${stats.saSteps||0} kroków optymalizacji SA
        </div>
      </div>
    </div>`;

  // Statystyki
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
    ${[
      ['✓ Ułożono',placed+' lekcji','var(--accent)'],
      ['✕ Brakuje',(total-placed)+' lekcji',total-placed?'var(--red)':'var(--text-d)'],
      ['⚠ Ostrzeżenia',warnings.length,'var(--orange)'],
    ].map(([l,v,c])=>`<div style="padding:6px 10px;background:var(--s1);border-radius:7px;text-align:center">
      <div style="font-size:.68rem;color:var(--text-m)">${l}</div>
      <div style="font-size:.85rem;font-weight:700;color:${c}">${v}</div>
    </div>`).join('')}
  </div>`;

  // Ostrzeżenia
  if(warnings.length) {
    html += `<div style="max-height:150px;overflow-y:auto;font-size:.7rem;
      background:var(--s1);border-radius:7px;padding:8px;margin-bottom:10px">
      ${warnings.map(w=>`<div style="padding:2px 0;border-bottom:1px solid var(--border);color:${
        w.type==='error'?'var(--red)':w.type==='warn'?'var(--orange)':'var(--text-m)'
      }">${w.type==='error'?'✕':w.type==='warn'?'⚠':'ℹ'} ${w.msg}</div>`).join('')}
    </div>`;
  }

  // Przyciski akcji
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="wbtn wbtn-primary" onclick="genApply()" style="font-size:.78rem">
      ✓ Zastosuj jako aktywny plan
    </button>
    <button class="wbtn wbtn-ghost" onclick="genPreview()" style="font-size:.78rem">
      👁 Podgląd
    </button>
    <button class="wbtn wbtn-ghost" onclick="genRunAgain()" style="font-size:.78rem">
      🔄 Generuj ponownie
    </button>
    <button class="wbtn wbtn-ghost" onclick="renderGenerator()" style="font-size:.78rem">
      ⚙ Zmień warunki
    </button>
  </div>`;

  if(!perfect) {
    html += `<div style="margin-top:10px;padding:8px 12px;background:var(--s2);border-radius:7px;
      font-size:.72rem;color:var(--text-m);line-height:1.6">
      <strong>Co zrobić z brakującymi lekcjami?</strong><br>
      • <strong>Zastosuj częściowy plan</strong> i uzupełnij brakujące lekcje ręcznie w widoku klas<br>
      • <strong>Zmień warunki</strong> — odblokuj godziny nauczycielom lub zwiększ dostępność sal<br>
      • <strong>Generuj ponownie</strong> — solver losuje kolejność, może dać inny wynik
    </div>`;
  }

  html += `</div>`;
  const ra = document.getElementById('genResultArea');
  if(ra) ra.innerHTML = html;

  // Zapisz w localStorage jako backup
  try { localStorage.setItem('pl_sched_generated', JSON.stringify({sched:newSched,ts:Date.now()})); }
  catch(_) {}
}

function genDiscard() {
  window._genSched = null;
  renderGenerator();
}

function genApply() {
  if(!window._genSched) { notify('Brak wygenerowanego planu','warn'); return; }
  if(!confirm('Zastąpić aktualny plan wygenerowanym?\nAktualne wpisy zostaną nadpisane.')) return;
  schedData = window._genSched;
  persistAll();
  notify('Plan wygenerowany zastosowany!');
  switchView('class', document.querySelector('[data-view=class]'));
}

function genPreview() {
  if(!window._genSched) return;
  window._genBackup = schedData;
  schedData = window._genSched;
  switchView('class', document.querySelector('[data-view=class]'));
  notify('Podgląd — nie zapisano. Wróć do Generatora aby anulować.');
}

function genRunAgain() {
  window._genSched = null;
  genRun();
}

// ================================================================
//  KOD WORKERA (uruchamiany w osobnym wątku)
// ================================================================
function genWorkerFn() {
  // Funkcje pomocnicze (muszą być zdefiniowane wewnątrz workera)
  const key  = (cid,di,hn) => `${cid}_${di}_${hn}`;
  const rnd  = (n) => Math.floor(Math.random()*n);
  const pick = (arr) => arr[rnd(arr.length)];
  const shuffle = (arr) => {
    const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=rnd(i+1);[a[i],a[j]]=[a[j],a[i]];} return a;
  };

  self.onmessage = (e) => {
    const P   = e.data;
    const t0  = Date.now();
    const log = (msg) => self.postMessage({type:'log',text:msg});
    const sts = (msg) => self.postMessage({type:'status',text:msg});
    const prg = (pct) => self.postMessage({type:'progress',pct});

    try {
      const result = solve(P, log, sts, prg);
      self.postMessage({type:'done', ...result, stats:{...result.stats, ms:Date.now()-t0}});
    } catch(err) {
      self.postMessage({type:'error', text:err.message||String(err)});
    }
  };

  function solve(P, log, sts, prg) {
    const {C, hours, days, classes, teachers, subjects, rooms, activeSem, schoolWindow} = P;
    const warnings = [];
    const warn = (type,msg) => warnings.push({type,msg});
    const newSched = {};

    // ── Struktury zajętości ──
    const tchSlots  = {}; // tchId  → Set('di_hn')
    const clsSlots  = {}; // clsId  → Set('di_hn')  — pełna klasa (lekcje dla całej klasy)
    const grpSlots  = {}; // grpSlotId → Set('di_hn') — wirtualne sloty grup łączonych
    const roomSlots = {}; // roomId → Set('di_hn')
    // Mapa uczniów NI: niStudentId → Set('di_hn') — kiedy uczeń jest zajęty
    // Zajmowany przez: (a) lekcje klasy gdy uczeń jest z klasą, (b) inne sloty NI tego ucznia
    const niStudentSlots = {}; // `${clsId}_${niGroupId}` → Set('di_hn')

    // Zajmij slot ucznia NI (wywołaj po ułożeniu każdego slotu NI dla tego ucznia)
    const occupyNIStudent = (clsId, niId, di, hn) => {
      const k = `${clsId}_${niId}`;
      if(!niStudentSlots[k]) niStudentSlots[k] = new Set();
      niStudentSlots[k].add(`${di}_${hn}`);
    };

    // Zbuduj mapę: które przedmioty uczeń realizuje WYŁĄCZNIE w NI (nie z klasą)
    // niPartial[clsId][niStudId] = Set(subjId) — przedmioty tylko NI
    // Split: uczeń bywa i na NI i z klasą → nie blokujemy pełnie slotów klasy
    const niPartial = {};
    (P.niStudents||[]).forEach(stud => {
      if(!stud.classId) return;
      // Tylko 'indiv' całkowicie wyklucza obecność z klasą
      const niOnlyIds = (stud.subjects||[])
        .filter(r=>r.mode==='indiv').map(r=>r.subjId);
      if(!niOnlyIds.length) return;
      if(!niPartial[stud.classId]) niPartial[stud.classId] = {};
      niPartial[stud.classId][stud.id] = new Set(niOnlyIds);
    });

    const isTchFree  = (tid,di,hn) => !tchSlots[tid]?.has(`${di}_${hn}`);
    const isClsFree  = (cid,di,hn) => !clsSlots[cid]?.has(`${di}_${hn}`);
    const isGrpFree  = (gid,di,hn) => !grpSlots[gid]?.has(`${di}_${hn}`);
    const isRoomFree = (rid,di,hn) => !roomSlots[rid]?.has(`${di}_${hn}`);

    // Czy uczeń NI jest wolny w tym slocie (nie jest wtedy na lekcji z klasą)
    const isNIStudentFree = (clsId, niStudId, di, hn) => {
      const k = clsId + '_' + niStudId;
      return !niStudentSlots[k]?.has(di + '_' + hn);
    };

    // Gdy kładziemy lekcję klasy - sprawdzamy czy uczeń NI jest na niej z klasą
    // i jeśli tak, zajmujemy jego slot (nie może mieć NI w tym czasie)
    const occupyNIStudentIfNeeded = (clsId, subjId, di, hn) => {
      if(!niPartial[clsId]) return;
      Object.entries(niPartial[clsId]).forEach(([niStudId, niSubjSet]) => {
        if(!niSubjSet.has(subjId)) {
          const k = clsId + '_' + niStudId;
          if(!niStudentSlots[k]) niStudentSlots[k] = new Set();
          niStudentSlots[k].add(di + '_' + hn);
        }
      });
    };

    const occupyGrp = (gid,di,hn) => {
      if(!gid) return;
      if(!grpSlots[gid]) grpSlots[gid]=new Set();
      grpSlots[gid].add(`${di}_${hn}`);
    };
    const occupy = (tid,cid,rid,di,hn,subjId,gid=null) => {
      if(tid) { if(!tchSlots[tid])  tchSlots[tid] =new Set(); tchSlots[tid].add(`${di}_${hn}`); }
      // Dla grup łączonych: blokuj tylko slot grupy, NIE całą klasę
      if(gid) { occupyGrp(gid,di,hn); }
      else if(cid) { if(!clsSlots[cid]) clsSlots[cid]=new Set(); clsSlots[cid].add(`${di}_${hn}`); }
      if(rid) { if(!roomSlots[rid]) roomSlots[rid]=new Set(); roomSlots[rid].add(`${di}_${hn}`); }
      if(cid && subjId && !gid) occupyNIStudentIfNeeded(cid, subjId, di, hn);
    };
    const vacate = (tid,cid,rid,di,hn,gid=null) => {
      tchSlots[tid]?.delete(`${di}_${hn}`);
      if(gid) grpSlots[gid]?.delete(`${di}_${hn}`);
      else clsSlots[cid]?.delete(`${di}_${hn}`);
      if(rid) roomSlots[rid]?.delete(`${di}_${hn}`);
    };

    // ── Dostępność nauczyciela ──
    const tchAvail = (tid,di,hn) => {
      const av = (C.teacherAvail||{})[tid]||{};
      return av[`${di}_${hn}`] !== 'blocked';
    };
    const tchPref  = (tid,di,hn) => {
      const av = (C.teacherAvail||{})[tid]||{};
      return av[`${di}_${hn}`]==='preferred' ? 2 : av[`${di}_${hn}`]==='window' ? -1 : 0;
    };

    // ── Okno szkoły per dzień ──
    const WKEYS = ['mon','tue','wed','thu','fri'];
    const dayWindow = days.map(di => {
      const w = (schoolWindow||{})[WKEYS[di]]||[null,null];
      return {from:w[0]||null, to:w[1]||null};
    });
    const inWindow = (di,hn) => {
      const wi = days.indexOf(di);
      if(wi<0) return false;
      const {from,to} = dayWindow[wi];
      if(from!==null && hn<from) return false;
      if(to!==null   && hn>to)   return false;
      return true;
    };

    // ── Ważny semestr — filtruj przedmioty ──
    const subjActive = (sid) => {
      const s = subjects.find(s=>s.id===sid);
      if(!s) return false;
      if(s.duration==='sem1' && activeSem!==1) return false;
      if(s.duration==='sem2' && activeSem!==2) return false;
      return true;
    };

    // ── Zbuduj zadania ──
    sts('Budowanie listy zadań…');
    const tasks = [];

    // Zbierz połączenia grup między klasami z g.linkedWith
    // linkedMap[grpId] = {clsId, partnerGrpSlots:[grpSlotId...]}
    // Format wirtualnego slotu grupy: "grp_{clsId}_{grpId}"
    const grpSlotOf = (clsId, grpId) => `grp_${clsId}_${grpId}`;

    // Dla każdej grupy z linkedWith — znajdź przypisany przedmiot (przez teacherId)
    // Mapa: grpId → subjectId (pierwszy przydział nauczyciela dla tej klasy+grupy)
    // W praktyce: nauczyciel przypisany do klasy prowadzi też grupę
    // Połączone grupy dzielą ten sam slot w planie — jeden nauczyciel, jedna sala

    // Zbierz wszystkie grupy łączone w grupy-klucze
    // linkedGroups[canonicalKey] = [{clsId, grpId, subjId}]
    // canonical key = posortowane grp_clsId_grpId połączone
    const linkedGroupSets = []; // [{grpSlots:[...], subjId}]
    const seenGrpSlots = new Set();

    classes.forEach(cls => {
      (cls.niGroups||[]).concat(
        // niGroups zawiera tylko NI — dla zwykłych grup czytamy z cls.groups przez payload
        // Payload klas ma groups z linkedWith
        []
      );
    });

    // Czytamy linkedWith bezpośrednio z payload classes (mamy je przez cls.groups)
    // Payload class ma: optionalSubjects (stary system) i teraz grupy z linkedWith
    // Grupy z linkedWith są w cls.groups (type=group/small)
    classes.forEach(cls => {
      (cls.groups||[]).forEach(g => {
        if(!(g.linkedWith||[]).length) return;
        const slotId = grpSlotOf(cls.id, g.id);
        if(seenGrpSlots.has(slotId)) return;
        // Zbierz wszystkich partnerów
        const allSlots = [slotId, ...g.linkedWith.map(lw=>grpSlotOf(lw.clsId,lw.grpId))];
        allSlots.forEach(s=>seenGrpSlots.add(s));
        linkedGroupSets.push({slots:allSlots, clsId:cls.id, grpId:g.id});
      });
    });

    teachers.forEach(t => {
      t.assignments.forEach(a => {
        if(!subjActive(a.subjectId)) return;
        const cls = classes.find(c=>c.id===a.classId);
        if(!cls || !a.hours) return;
        const subj = subjects.find(s=>s.id===a.subjectId);
        if(subj?.classes?.length && !subj.classes.includes(cls.id)) return;

        const noBlk  = (C.noBlock||[]).includes(a.subjectId);
        const blkSz  = noBlk ? 1 : Math.max(1,(C.lessonBlocks||{})[a.subjectId]?.blockSize||1);
        const pos    = (C.subjPosition||{})[a.subjectId]||'any';
        const maxPD  = (C.maxPerDay||{})[a.subjectId]||0;
        const maxCon = (C.maxConsecutive||{})[a.subjectId]||0;

        // Stary system optionalSubjects (pozycja skrajna)
        const optEntry = (cls.optionalSubjects||[]).find(o=>o.subjId===a.subjectId);
        // Nowy system: edgePosition z grupy (ustawiane przez checkbox w modalu klasy)
        const isEdge   = optEntry?.position==='edge' || !!(linkedGrp?.edgePosition);
        const effectivePos = isEdge ? 'edge' : pos;

        // Nowy system: sprawdź czy nauczyciel prowadzi przedmiot dla grupy z linkedWith
        // Grupa łączona = nauczyciel ma przydział do tej klasy I istnieje grupa tej klasy
        // z linkedWith wskazującym na inną klasę która też ma przydział tego samego nauczyciela
        // (lub innego nauczyciela — każda klasa może mieć swojego)
        //
        // Uproszczenie: jeśli klasa ma grupę (type=group/small) z linkedWith — 
        // i ta klasa ma przydział tego przedmiotu — to jest to zadanie grupowe
        const linkedGrp = (cls.groups||[]).find(g =>
          (g.type==='group'||g.type==='small') && (g.linkedWith||[]).length > 0 &&
          // Sprawdź czy ten nauczyciel jest przypisany do tej grupy (przez teacherId grupy)
          // lub czy nie ma przypisanego nauczyciela (wtedy bierzemy dowolny z przydziałem)
          (!g.teacherId || g.teacherId===t.id)
        );

        // Jeśli klasa ma grupę łączoną i nauczyciel ma przydział — to zadanie grupowe
        const isInterclass = !!(linkedGrp);
        const groupSlotId  = isInterclass ? grpSlotOf(cls.id, linkedGrp.id) : null;
        // Sloty partnerów (inne klasy/grupy połączone z tą)
        const partnerSlots = isInterclass
          ? (linkedGrp.linkedWith||[]).map(lw=>grpSlotOf(lw.clsId,lw.grpId))
          : [];

        tasks.push({
          clsId:cls.id, clsName:cls.name,
          tchId:t.id, tchAbbr:t.abbr,
          subjId:a.subjectId, subjName:subj?.name||'?',
          hoursLeft:a.hours, blkSz,
          pos:effectivePos, maxPD, maxCon,
          isOptional:!!optEntry,
          isInterclass,
          mergeClsIds: isInterclass
            ? [cls.id, ...(linkedGrp.linkedWith||[]).map(lw=>lw.clsId)]
            : null,
          groupSlotId,
          partnerSlots,
          priority: (effectivePos!=='any'?10:0) + (blkSz>1?5:0) + a.hours + (isInterclass?8:0)
        });
      });
    });

    // ── Dodaj zadania NI z appState.niStudents ──
    (P.niStudents||[]).forEach(stud => {
      (stud.subjects||[]).forEach(r => {
        const subj = subjects.find(s=>s.id===r.subjId);
        const mode = r.mode || 'class';

        // Godziny NI (indiv lub część split)
        if((mode==='indiv'||mode==='split') && r.teacherId && (r.hours||0)>0) {
          const tch = teachers.find(t=>t.id===r.teacherId);
          if(tch) {
            const virtualClsId = 'ni_' + stud.id + '_' + r.subjId;
            tasks.push({
              clsId: virtualClsId,
              clsName: stud.name + ' (NI: ' + (subj?.abbr||r.subjId) + ')',
              tchId: tch.id, tchAbbr: tch.abbr,
              subjId: r.subjId, subjName: subj?.name||'NI',
              hoursLeft: r.hours,
              blkSz: 1, pos: 'any', maxPD: 0, maxCon: 0,
              isOptional: false, mergeClsIds: null,
              isIndiv: true, isGroup: stud.studentCount>1,
              students: stud.studentCount||1,
              priority: 22,
              parentClsId: stud.classId||null,
              niStudId: stud.id, niSubjId: r.subjId,
            });
          }
        }
        // Godziny z klasą (class lub część split) — solver nie tworzy osobnego zadania,
        // uczeń jest po prostu razem z klasą; odnotowujemy nauczyciela wspomagającego
        // w uwadze do zadania klasy (obsługa informacyjna)
      });
    });

    // ── Dodaj zadania NI i grupowe z indivTeaching nauczycieli ──
    teachers.forEach(t => {
      (t.individualTeaching||[]).forEach((item,idx) => {
        if(!item.hours) return;
        const isGroup = (item.students||1) > 1 || (item.form||'').includes('grupow');
        // ID wirtualnej klasy dla tego ucznia/grupy
        const virtualClsId = `ni_${t.id}_${idx}`;
        tasks.push({
          clsId: virtualClsId,
          clsName: item.name + (isGroup ? ` (gr. ${item.students||2})` : ' (NI)'),
          tchId: t.id, tchAbbr: t.abbr,
          subjId: item.subjectId||null,
          subjName: item.form||'NI',
          hoursLeft: item.hours,
          blkSz: 1,
          pos: 'any',
          maxPD: 0, maxCon: 0,
          isOptional: false, mergeClsIds: null,
          isIndiv: !isGroup,
          isGroup: isGroup,
          students: item.students||1,
          priority: isGroup ? 15 : 20,
          // Dla ucznia z częściowym NI: parentClsId + niGroupId do sprawdzenia kolizji
          parentClsId: item.parentClsId || null,
          niGroupId:   item.niGroupId   || null,
        });
      });
    });

    log('Zadań: ' + tasks.length + ', godzin do przydzielenia: ' + tasks.reduce((s,t)=>s+t.hoursLeft,0));

    // Sortuj: najpierw najtrudniejsze (opcjonalne/skrajne, blokami, dużo godzin)
    tasks.sort((a,b)=>b.priority-a.priority);

    // ── Śledź per-dzień ──
    const perDay = {}; // `${clsId}_${subjId}_${di}` → count
    const consec = {}; // `${clsId}_${subjId}` → [di1,di2,...] ostatnie dni

    const pdKey = (cid,sid,di) => `${cid}_${sid}_${di}`;
    const getPD = (cid,sid,di) => perDay[pdKey(cid,sid,di)]||0;
    const incrPD= (cid,sid,di) => perDay[pdKey(cid,sid,di)]=(perDay[pdKey(cid,sid,di)]||0)+1;
    const decrPD= (cid,sid,di) => perDay[pdKey(cid,sid,di)]=Math.max(0,(perDay[pdKey(cid,sid,di)]||0)-1);

    // ── Wybierz salę ──
    const findRoom = (subjId,di,hn,excludeIds=[]) => {
      const isSpecial = rooms.some(r=>(r.preferredSubjects||[]).length>0);
      // Preferowana dla tego przedmiotu
      const pref = rooms.filter(r=>
        (r.preferredSubjects||[]).includes(subjId) &&
        isRoomFree(r.id,di,hn) && !excludeIds.includes(r.id)
      );
      if(pref.length) return pick(pref);
      // Sala bez preferencji (nie specjalistyczna)
      const free = rooms.filter(r=>
        !(r.preferredSubjects||[]).length &&
        isRoomFree(r.id,di,hn) && !excludeIds.includes(r.id)
      );
      if(free.length) return pick(free);
      // Ostatnia szansa — dowolna wolna
      const any = rooms.filter(r=>isRoomFree(r.id,di,hn) && !excludeIds.includes(r.id));
      return any.length ? pick(any) : null;
    };

    // ── Zbierz kandydatów dla zadania ──
    const getCandidates = (task, usedHours) => {
      const cands = [];
      const hnums = hours.map(h=>h.num);
      const maxHi = hours.length - task.blkSz;

      for(const di of shuffle(days)) {
        if(task.maxPD && getPD(task.clsId,task.subjId,di)+task.blkSz > task.maxPD) continue;
        for(let hi=0; hi<=maxHi; hi++) {
          const block = hours.slice(hi, hi+task.blkSz).map(h=>h.num);

          // Okno szkoły
          if(!block.every(hn=>inWindow(di,hn))) continue;
          // Pozycja
          if(task.pos==='first' && hi>1) continue;
          if(task.pos==='last'  && hi<hours.length-2) continue;
          if(task.pos==='edge'  && hi>0 && hi<hours.length-task.blkSz) continue;
          // Wolność nauczyciela
          if(!block.every(hn=>isTchFree(task.tchId,di,hn))) continue;
          // Dostępność nauczyciela (nie zablokowany)
          if(!block.every(hn=>tchAvail(task.tchId,di,hn))) continue;
          // Dla ucznia NI z częściowym NI: sprawdź czy nie jest w tym czasie na lekcji z klasą
          if(task.parentClsId && task.niStudId) {
            if(!block.every(hn=>isNIStudentFree(task.parentClsId, task.niStudId, di, hn))) continue;
          }
          if(task.isInterclass) {
            // Grupy łączone: sprawdź wirtualne sloty grup (nie całe klasy)
            if(!block.every(hn=>isGrpFree(task.groupSlotId,di,hn))) continue;
            if(task.partnerSlots?.length) {
              if(!task.partnerSlots.every(ps=>block.every(hn=>isGrpFree(ps,di,hn)))) continue;
            }
          } else {
            // Zwykłe zadanie: cała klasa musi być wolna
            if(!block.every(hn=>isClsFree(task.clsId,di,hn))) continue;
          }

          const score = block.reduce((s,hn)=>s+tchPref(task.tchId,di,hn),0)
            + (task.pos!=='any'?3:0);
          cands.push({di,hi,block,score});
        }
      }
      return cands.sort((a,b)=>b.score-a.score);
    };

    // ── Przydziel zadanie ──
    const placeTask = (task) => {
      let hoursLeft = task.hoursLeft;
      let placedForTask = 0;

      while(hoursLeft > 0) {
        const blk  = Math.min(task.blkSz, hoursLeft);
        const taskCopy = {...task, blkSz:blk};
        const cands = getCandidates(taskCopy, placedForTask);

        if(!cands.length) break;

        // Wybierz z top 30% losowo (dla różnorodności)
        const topN = Math.max(1, Math.ceil(cands.length*0.3));
        const chosen = cands.slice(0,topN)[rnd(Math.min(topN,cands.length))];
        if(!chosen) break;

        const room = findRoom(task.subjId, chosen.di, chosen.block[0]);

        chosen.block.forEach(hn => {
          const entry = {subjectId:task.subjId, teacherId:task.tchId,
                         roomId:room?.id||null, groups:[]};
          newSched[key(task.clsId,chosen.di,hn)] = entry;
          if(task.isInterclass) {
            // Grupy łączone: blokuj slot własnej grupy + sloty partnerów
            occupy(task.tchId, task.clsId, room?.id, chosen.di, hn, task.subjId, task.groupSlotId);
            // Wpisz lekcję do planów klas partnerskich i zajmij ich sloty
            if(task.partnerSlots?.length && task.mergeClsIds) {
              task.mergeClsIds.filter(cid=>cid!==task.clsId).forEach((cid,pi) => {
                newSched[key(cid,chosen.di,hn)] = {...entry};
                if(task.partnerSlots[pi]) occupyGrp(task.partnerSlots[pi],chosen.di,hn);
              });
            }
          } else {
            occupy(task.tchId, task.clsId, room?.id, chosen.di, hn, task.subjId);
          }
          // Gdy to zadanie NI — zajmij też slot ucznia
          if(task.parentClsId && task.niStudId) {
            occupyNIStudent(task.parentClsId, task.niStudId, chosen.di, hn);
          }
          incrPD(task.clsId, task.subjId, chosen.di);
        });
        hoursLeft  -= chosen.block.length;
        placedForTask += chosen.block.length;
      }

      return task.hoursLeft - hoursLeft; // ile udało się umieścić
    };

    // ── Faza 1: Zachłanny ──
    sts('Faza 1: rozmieszczanie lekcji…');
    let placed=0, failed=0;
    const total = tasks.reduce((s,t)=>s+t.hoursLeft,0);
    const unplaced = [];

    tasks.forEach((task,ti) => {
      const p = placeTask(task);
      placed += p;
      if(p < task.hoursLeft) {
        const missing = task.hoursLeft - p;
        failed += missing;
        warn('warn',`${task.clsName} · ${task.subjName} (${task.tchAbbr}): brakuje ${missing}h`);
        unplaced.push({...task, hoursLeft:missing});
      }
      prg(Math.round(ti/tasks.length*60));
    });
    log(`Faza 1: ułożono ${placed}/${total} (${Math.round(placed/total*100)}%)`);

    // ── Faza 2: SA — minimalizuj okienka i poprawiaj jakość ──
    sts('Faza 2: optymalizacja…');
    const SA_STEPS = Math.min(2000, placed*10);
    let temp = 1.5;
    const schedKeys = Object.keys(newSched);

    const countGaps = (tchId) => {
      let gaps=0;
      days.forEach(di=>{
        const occupied = hours.map(h=>h.num).filter(hn=>tchSlots[tchId]?.has(`${di}_${hn}`));
        if(occupied.length<2) return;
        gaps += occupied[occupied.length-1] - occupied[0] - (occupied.length-1);
      });
      return gaps;
    };

    for(let step=0; step<SA_STEPS; step++) {
      temp *= 0.9995;
      const k1 = schedKeys[rnd(schedKeys.length)];
      const k2 = schedKeys[rnd(schedKeys.length)];
      if(k1===k2) continue;
      const [c1,d1,h1] = k1.split('_');
      const [c2,d2,h2] = k2.split('_');
      if(c1!==c2) continue; // tylko ta sama klasa
      const l1=newSched[k1], l2=newSched[k2];
      if(l1.teacherId===l2.teacherId) continue;

      // Sprawdź czy zamiana jest możliwa
      const ok1 = isTchFree(l2.teacherId,+d1,+h1) && tchAvail(l2.teacherId,+d1,+h1);
      const ok2 = isTchFree(l1.teacherId,+d2,+h2) && tchAvail(l1.teacherId,+d2,+h2);
      if(!ok1||!ok2) continue;

      const before = countGaps(l1.teacherId)+countGaps(l2.teacherId);
      // Zamień
      newSched[k1]={...l1,teacherId:l2.teacherId};
      newSched[k2]={...l2,teacherId:l1.teacherId};
      const after = countGaps(l1.teacherId)+countGaps(l2.teacherId);

      // Akceptuj jeśli lepiej lub z prawdopodobieństwem SA
      if(after>before && Math.random()>Math.exp((before-after)/temp)) {
        // Cofnij
        newSched[k1]=l1; newSched[k2]=l2;
      }
      if(step%200===0) prg(60+Math.round(step/SA_STEPS*35));
    }

    // ── Faza 3: Spróbuj wcisnąć nieumieszczone ──
    if(unplaced.length) {
      sts('Faza 3: ponowna próba dla brakujących…');
      unplaced.forEach(task => {
        const p2 = placeTask(task);
        if(p2>0) { placed+=p2; failed-=p2; }
      });
      log(`Faza 3: łącznie ułożono ${placed}/${total}`);
    }

    prg(100);
    sts(placed>=total ? '✓ Kompletny!' : `Ułożono ${Math.round(placed/total*100)}%`);

    return {
      result:newSched, warnings,
      stats:{placed,total,saSteps:SA_STEPS}
    };
  }
}



// Godziny NI wliczane do pensum danego nauczyciela
function niPensumHours(tchId) {
  return (appState.niStudents||[]).reduce((sum, stud) => {
    if(!stud.inPensum) return sum;
    return sum + (stud.subjects||[])
      .filter(r=>(r.mode==='indiv'||r.mode==='split') && r.teacherId===tchId)
      .reduce((s,r)=>s+(r.hours||0), 0);
  }, 0);
}
function renderStats() {
  if(!appState){ document.getElementById('statsContent').innerHTML=''; return; }
  const allLessons = Object.values(schedData);
  const totalLessons = allLessons.length;
  const teacherHours = {};
  appState.teachers.forEach(t=>{teacherHours[t.id]=0;});
  allLessons.forEach(l=>{if(l.teacherId)teacherHours[l.teacherId]=(teacherHours[l.teacherId]||0)+1;});
  const maxH = Math.max(...Object.values(teacherHours),1);
  const conflicts = detectConflicts();

  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-num" style="color:var(--accent)">${totalLessons}</div><div class="stat-label">Lekcji w planie</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--green)">${appState.classes.length}</div><div class="stat-label">Klas</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--purple)">${appState.teachers.length}</div><div class="stat-label">Nauczycieli</div></div>
    <div class="stat-card"><div class="stat-num" style="color:${conflicts.length?'var(--red)':'var(--green)'}">${conflicts.length}</div><div class="stat-label">Konfliktów</div></div>
  </div>`;

  html += `<div class="teacher-load-table">
    <div class="tlt-header"><div class="tlt-name">Nauczyciel</div><div class="tlt-hours">Godz.</div><div class="tlt-bar-wrap" style="padding:0">Obciążenie</div></div>`;
  appState.teachers.sort((a,b)=>(teacherHours[b.id]||0)-(teacherHours[a.id]||0)).forEach(t=>{
    const h=teacherHours[t.id]||0;
    const pct=Math.round(h/maxH*100);
    const barColor = pct>80?'var(--red)':pct>60?'var(--yellow)':'var(--green)';
    const niH = (t.individualTeaching||[]).reduce((s,i)=>s+(i.hours||0),0);
    html+=`<div class="tlt-row">
      <div class="tlt-name">${t.first} ${t.last}
        <span style="color:var(--text-m);font-family:var(--mono);font-size:.72rem">${t.abbr}</span>
        ${niH?`<span style="font-size:.62rem;padding:1px 5px;border-radius:6px;
          background:var(--accent-g);color:var(--accent);margin-left:4px"
          title="Godziny NI/grupowe poza planem klasy">+${niH}h NI</span>`:''}
      </div>
      <div class="tlt-hours" title="W planie lekcji${niH?' + '+niH+'h NI':''}">${h}</div>
      <div class="tlt-bar-wrap"><div class="tlt-bar" style="width:${pct}%;background:${barColor}"></div></div>
    </div>`;
  });
  html += '</div>';

  // Subject distribution
  const subjCount={};
  allLessons.forEach(l=>{if(l.subjectId)subjCount[l.subjectId]=(subjCount[l.subjectId]||0)+1;});
  const maxS=Math.max(...Object.values(subjCount),1);
  html+=`<div class="teacher-load-table">
    <div class="tlt-header"><div class="tlt-name">Przedmiot</div><div class="tlt-hours">Godz.</div><div class="tlt-bar-wrap" style="padding:0">Udział</div></div>`;
  appState.subjects.filter(s=>subjCount[s.id]).sort((a,b)=>(subjCount[b.id]||0)-(subjCount[a.id]||0)).forEach(s=>{
    const cnt=subjCount[s.id]||0;
    const pct=Math.round(cnt/maxS*100);
    html+=`<div class="tlt-row">
      <div class="tlt-name"><span class="cdot" style="background:${s.color};margin-right:6px"></span>${s.name}</div>
      <div class="tlt-hours">${cnt}</div>
      <div class="tlt-bar-wrap"><div class="tlt-bar" style="width:${pct}%;background:${s.color}"></div></div>
    </div>`;
  });
  html += '</div>';

  // ── Przydziały vs rzeczywistość ──
  const hasAssignments = appState.teachers.some(t => (t.assignments||[]).length > 0);
  if (hasAssignments) {
    html += `<div class="teacher-load-table" style="margin-top:0">
      <div class="tlt-header">
        <div class="tlt-name">Nauczyciel</div>
        <div class="tlt-hours" style="min-width:110px;text-align:left">Plan / Przydział</div>
        <div class="tlt-bar-wrap" style="padding:0;flex:3">Realizacja etatu</div>
      </div>`;
    appState.teachers.filter(t=>(t.assignments||[]).length||t.hoursTotal).forEach(t => {
      const actual = teacherHours[t.id] || 0;
      const assignedBase = (t.assignments||[]).reduce((s,a)=>s+(a.hours||0),0);
      const niInPensumH  = niPensumHours(t.id);
      const assigned = assignedBase + niInPensumH;
      const pensum = t.hoursTotal || 0;
      const extra  = t.hoursExtra || 0;
      const target = pensum + extra;
      const refVal = target || assigned || 1;
      const pct    = Math.min(100, Math.round(actual / refVal * 100));
      let barColor = 'var(--green)';
      if (target > 0) {
        if (actual > target)           barColor = 'var(--red)';
        else if (actual < target * 0.8) barColor = 'var(--yellow)';
      }
      const diff = target ? actual - target : actual - assigned;
      const diffStr = (target || assigned) ? (diff > 0 ? `+${diff}` : `${diff}`) : '';
      const diffColor = diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--yellow)' : 'var(--green)';
      // Label: "15 / 18+2=20 godz." or "15 / 18 godz."
      const targetLabel = target
        ? (extra ? `${pensum}+${extra}=${target}` : `${target}`)
        : (assigned ? `przyd. ${assigned}` : '');

      html += `<div class="tlt-row">
        <div class="tlt-name">${t.first} ${t.last}
          <span style="color:var(--text-m);font-family:var(--mono);font-size:.7rem">${t.abbr}</span>
          ${extra ? `<span style="font-size:.68rem;color:var(--orange);margin-left:4px" title="Nadgodziny stałe: ${extra} godz.">+${extra} nadg.</span>` : ''}
        </div>
        <div class="tlt-hours" style="min-width:130px;text-align:left;font-family:var(--mono)">
          ${actual}${targetLabel ? ' / '+targetLabel : ''} godz.
          ${diffStr ? `<span style="color:${diffColor};margin-left:3px">(${diffStr})</span>` : ''}
        </div>
        <div class="tlt-bar-wrap"><div class="tlt-bar" style="width:${pct}%;background:${barColor}"></div></div>
      </div>`;

      // Per-class breakdown
      if ((t.assignments||[]).length) {
        const byClass = {};
        (t.assignments||[]).forEach(a => {
          const cls = appState.classes.find(c=>c.id===a.classId);
          const subj = appState.subjects.find(s=>s.id===a.subjectId);
          if (!byClass[a.classId]) byClass[a.classId] = {cls, items:[]};
          byClass[a.classId].items.push({subj, hours:a.hours});
        });
        Object.values(byClass).forEach(({cls, items}) => {
          items.forEach(({subj, hours}) => {
            const actH = Object.entries(schedData).filter(([k,v])=>{
              const parts=k.split('_');
              return parts[0]===cls?.id && v.teacherId===t.id && v.subjectId===subj?.id;
            }).length;
            // Count unique days x hours (not just per-day)
            const realH = Object.entries(schedData).filter(([k,v])=>{
              const parts=k.split('_');
              return parts[0]===(cls?.id||'') && v.teacherId===t.id && v.subjectId===(subj?.id||'');
            }).length;
            const rowPct = Math.min(100, Math.round(realH/hours*100));
            const rowColor = realH > hours ? 'var(--red)' : realH === hours ? 'var(--green)' : 'var(--yellow)';
            html += `<div class="tlt-row" style="padding-left:28px;background:var(--s2);font-size:.76rem">
              <div class="tlt-name" style="color:var(--text-m)">
                ${cls?cls.name:'?'} —
                <span class="cdot" style="background:${subj?subj.color:'#888'};margin-right:3px;margin-left:4px"></span>
                ${subj?subj.name:'?'}
              </div>
              <div class="tlt-hours" style="min-width:110px;font-family:var(--mono);text-align:left;color:var(--text-m)">${realH}/${hours} godz.</div>
              <div class="tlt-bar-wrap"><div class="tlt-bar" style="width:${rowPct}%;background:${rowColor}"></div></div>
            </div>`;
          });
        });
      }
    });
    html += '</div>';
  }

  document.getElementById('statsContent').innerHTML = html;
}

// Pomocnicze sortowania alfabetyczne
const sortByName    = arr => [...arr].sort((a,b)=>a.name.localeCompare(b.name,'pl'));
const sortTeachers  = arr => [...arr].sort((a,b)=>(a.last+a.first).localeCompare(b.last+b.first,'pl'));
const sortSubjects  = arr => [...arr].sort((a,b)=>a.name.localeCompare(b.name,'pl'));
const sortClasses   = arr => [...arr].sort((a,b)=>a.name.localeCompare(b.name,'pl'));

// ================================================================
//  SETTINGS VIEW
// ================================================================
// ================================================================
//  USTAWIENIA — zakładkowy panel
// ================================================================
let _settingsTab = 'klasy';

const SETTINGS_TABS = [
  {id:'klasy',       icon:'📚', label:'Klasy'},
  {id:'nauczyciele', icon:'👩\u200d🏫', label:'Nauczyciele'},
  {id:'przedmioty',  icon:'🎨', label:'Przedmioty'},
  {id:'sale',        icon:'🏫', label:'Sale'},
  {id:'budynki',     icon:'🏢', label:'Budynki'},
  {id:'godziny',     icon:'⏰', label:'Godziny'},
  {id:'dyzury',      icon:'🚨', label:'Dyżury'},
  {id:'szkola',      icon:'⚙', label:'Szkoła'},
  {id:'ni',          icon:'👤', label:'NI / Grupy'},
];

function renderSettings(tab) {
  if(!appState){ document.getElementById('settingsContent').innerHTML=''; return; }
  if(tab) _settingsTab = tab;

  const tabs = SETTINGS_TABS.map(t => `
    <button onclick="renderSettings('${t.id}')"
      style="padding:6px 14px;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer;
             font-family:var(--font);display:inline-flex;align-items:center;gap:5px;white-space:nowrap;
             border:1px solid ${_settingsTab===t.id?'var(--accent)':'var(--border)'};
             background:${_settingsTab===t.id?'var(--accent)':'var(--s2)'};
             color:${_settingsTab===t.id?'#fff':'var(--text-m)'};transition:all .15s">
      ${t.icon} ${t.label}
    </button>`).join('');

  const TAB_FNS = {
    klasy:       settingsKlasy,
    nauczyciele: settingsNauczyciele,
    przedmioty:  settingsPrzedmioty,
    sale:        settingsSale,
    budynki:     settingsBudynki,
    godziny:     settingsGodziny,
    dyzury:      settingsDyzury,
    szkola:      settingsSzkola,
    ni:          settingsNI,
  };

  const body = (TAB_FNS[_settingsTab] || settingsKlasy)();
  document.getElementById('settingsContent').innerHTML =
    `<div style="display:flex;gap:5px;flex-wrap:wrap;padding-bottom:12px;
       margin-bottom:16px;border-bottom:1px solid var(--border)">${tabs}</div>
     <div class="settings-grid">${body}</div>`;
}

function settingsKlasy() {
  let html = `<div style="grid-column:1/-1">`;
  html+=`<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">`;
  html+=`<div class="settings-card">
    <div class="settings-card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>Klasy</span>
    </div>`;

  if (!appState.classes.length) {
    html += `<div style="color:var(--text-m);font-size:.82rem;padding:8px 0">Brak klas.</div>`;
  }

  appState.classes.forEach(c => {
    // Zbierz nauczycieli przypisanych do tej klasy (mają przydział z tą klasą)
    const assignedTeachers = appState.teachers.filter(t =>
      (t.assignments||[]).some(a => a.classId === c.id)
    );

    const tchBadges = assignedTeachers.map(t => {
      const subjIds = (t.assignments||[]).filter(a=>a.classId===c.id).map(a=>a.subjectId);
      const subjDots = subjIds.map(sid => {
        const s = appState.subjects.find(s=>s.id===sid);
        return s ? `<span class="cdot" style="background:${s.color}" title="${escapeHtml(s.name)}"></span>` : '';
      }).join('');
      const totalHours = (t.assignments||[]).filter(a=>a.classId===c.id).reduce((s,a)=>s+(a.hours||0),0);
      return `<div class="tch-assign-item" style="cursor:pointer" onclick="event.stopPropagation();openEditTeacherModal('${t.id}')" title="Edytuj ${escapeHtml(t.first)} ${escapeHtml(t.last)}">
        <div class="tch-assign-cls" style="min-width:44px">${escapeHtml(t.abbr)}</div>
        <div class="tch-assign-subj" style="display:flex;align-items:center;gap:4px">${subjDots}
          <span style="font-size:.72rem;color:var(--text-m)">${(t.assignments||[]).filter(a=>a.classId===c.id).map(a=>{const s=appState.subjects.find(s=>s.id===a.subjectId);return escapeHtml(s?s.abbr:'?');}).join(', ')}</span>
        </div>
        <div class="tch-assign-hrs">${totalHours} godz.</div>
      </div>`;
    }).join('');

    const totalHoursInClass = assignedTeachers.reduce((sum,t)=>
      sum + (t.assignments||[]).filter(a=>a.classId===c.id).reduce((s,a)=>s+(a.hours||0),0), 0);

    const homeroom = c.homeroomTeacherId ? appState.teachers.find(t=>t.id===c.homeroomTeacherId) : null;
    const homeRoomNames = (c.homeRooms||[]).map(rid=>{
      const r=appState.rooms.find(r=>r.id===rid); return r?r.name:'';
    }).filter(Boolean);

    html += `<div class="tch-card" id="ccard_${c.id}">
      <div class="tch-card-header" onclick="toggleClsCard('${c.id}')">
        <div class="tch-card-name">${escapeHtml(c.name)}</div>
        ${homeroom ? `<span style="font-size:.72rem;color:var(--text-m);margin-right:6px" title="Wychowawca">👤 ${escapeHtml(homeroom.abbr)}</span>` : ''}
        ${(c.groups||[]).length ? (() => {
          const grps = c.groups.map(g => {
            const tch = g.teacherId ? (appState.teachers||[]).find(t=>t.id===g.teacherId) : null;
            const icons = {group:'👥',small:'👤👤',indiv:'👤'};
            const icon = icons[g.type||'group']||'👥';
            const subjNote = g.type==='indiv' && (g.subjects||[]).length
              ? ' ['+g.subjects.length+'p.NI]' : '';
            return icon + escapeHtml(g.name||g) + subjNote + (tch?' ('+escapeHtml(tch.abbr)+')':'');
          });
          return `<span style="font-size:.72rem;color:var(--text-m);margin-right:6px">${grps.join(' · ')}</span>`;
        })() : ''}
        ${homeRoomNames.length ? `<span style="font-size:.72rem;color:var(--teal);margin-right:6px" title="Sale gospodarz">🏫 ${homeRoomNames.map(n=>escapeHtml(n)).join(', ')}</span>` : ''}
        ${(c.optionalSubjects||[]).length ? `<span style="font-size:.72rem;color:var(--text-m);margin-right:6px" title="Przedmioty opcjonalne">◑ ${(c.optionalSubjects||[]).map(o=>{const s=appState.subjects.find(s=>s.id===o.subjId);return s?escapeHtml(s.abbr||s.name)+(o.count?` (${o.count})`:'')+(o.position==='edge'?' ⇔':''):'';}).filter(Boolean).join(', ')}</span>` : ''}
        ${c.studentCount ? `<span style="font-size:.72rem;color:var(--text-m);margin-right:6px">👤 ${c.studentCount} ucz.</span>` : ''}
        <span style="font-size:.72rem;color:var(--accent);font-family:var(--mono);margin-right:6px">${assignedTeachers.length} naucz. · ${totalHoursInClass} godz.</span>
        <button class="si-btn" onclick="event.stopPropagation();openEditClassModal('${c.id}')" style="margin-right:4px">Edytuj</button>
        <span class="tch-card-arr">▼</span>
      </div>
      <div class="tch-card-body">
        ${tchBadges || '<div style="color:var(--text-m);font-size:.78rem">Brak przypisanych nauczycieli — przypisz ich w kartach nauczycieli.</div>'}
      </div>
    </div>`;
  });
  html += `<button class="wbtn wbtn-ghost" style="width:100%;margin-top:10px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddClassModal()">+ Dodaj nową klasę</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}
function settingsNauczyciele() {
  let html = `<div style="grid-column:1/-1">`;
  html+=`<div class="settings-card">
    <div class="settings-card-title">Nauczyciele</div>`;

  if (!appState.teachers.length) {
    html += `<div style="color:var(--text-m);font-size:.82rem;padding:8px 0">Brak nauczycieli — dodaj pierwszego.</div>`;
  }

  sortTeachers(appState.teachers).forEach(t => {
    // Unikalne przedmioty z przydziałów
    const subjIds = [...new Set((t.assignments||[]).map(a=>a.subjectId))];
    const subjects = subjIds.map(sid => {
      const s = appState.subjects.find(s=>s.id===sid);
      return s ? `<span class="tch-badge" style="background:${hexToRgba(s.color,.18)};color:${s.color}">${escapeHtml(s.abbr)}</span>` : '';
    }).join('');

    const totalAssigned = (t.assignments||[]).reduce((sum,a)=>sum+(a.hours||0),0);
    const fullTarget = (t.hoursTotal||0) + (t.hoursExtra||0);
    const niPenH = niPensumHours(t.id);
    const totalWithNI = totalAssigned + niPenH;
    const etats = fullTarget
      ? `${totalWithNI}/${fullTarget} godz.${niPenH?` (w tym ${niPenH}h NI)`:''}${t.hoursExtra ? ' ('+t.hoursTotal+'+'+t.hoursExtra+')' : ''}`
      : `${totalWithNI} godz. przydzielonych`;
    const indivHours = (t.individualTeaching||[]).reduce((s,i)=>s+(i.hours||0),0);
    const indivCount = (t.individualTeaching||[]).length;
    const hoursColor = fullTarget
      ? (totalAssigned > fullTarget ? 'var(--red)' : totalAssigned === fullTarget ? 'var(--green)' : 'var(--yellow)')
      : 'var(--text-m)';

    const assignRows = (t.assignments||[]).map(a => {
      const cls = appState.classes.find(c=>c.id===a.classId);
      const subj = appState.subjects.find(s=>s.id===a.subjectId);
      return `<div class="tch-assign-item">
        <div class="tch-assign-cls">${escapeHtml(cls?cls.name:'?')}</div>
        <div class="tch-assign-subj">
          <span class="cdot" style="background:${subj?subj.color:'#888'};margin-right:5px"></span>
          ${escapeHtml(subj?subj.name:'?')}
        </div>
        <div class="tch-assign-hrs">${a.hours} godz./tydz.</div>
      </div>`;
    }).join('');

    html += `<div class="tch-card" id="tcard_${t.id}">
      <div class="tch-card-header" onclick="toggleTchCard('${t.id}')">
        <div class="tch-card-name">${escapeHtml(t.first)} ${escapeHtml(t.last)}</div>
        <div class="tch-card-abbr">${escapeHtml(t.abbr)}</div>
        <div class="tch-card-badges">${subjects}</div>
        <span style="font-size:.72rem;color:${hoursColor};font-family:var(--mono);margin-right:4px">${etats}</span>
        ${indivHours ? `<span style="font-size:.68rem;background:var(--accent-g);color:var(--accent);border-radius:4px;padding:2px 6px;margin-right:4px" title="${indivCount} uczniów NI">NI: ${indivHours}h</span>` : ''}
        <button class="si-btn" onclick="event.stopPropagation();openEditTeacherModal('${t.id}')" style="margin-right:4px">Edytuj</button>
        <span class="tch-card-arr">▼</span>
      </div>
      <div class="tch-card-body">
        ${assignRows || '<div style="color:var(--text-m);font-size:.78rem">Brak przydziałów</div>'}
      </div>
    </div>`;
  });

  html += `<button class="wbtn wbtn-ghost" style="width:100%;margin-top:10px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddTeacherModal()">+ Dodaj nowego nauczyciela</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}
function settingsPrzedmioty() {
  let html = `<div style="grid-column:1/-1">`;
  html+=`<div class="settings-card" style="grid-column:1/-1">
    <div class="settings-card-title">Przedmioty</div>
    <div class="subj-grid">`;
  sortSubjects(appState.subjects).forEach(s=>{
    const isDark = isDarkColor(s.color);
    const textC  = isDark ? '#fff' : '#111';
    const bg     = hexToRgba(s.color, .18);
    const durLabel   = s.duration==='sem1'?'Sem.1':s.duration==='sem2'?'Sem.2':'';
    const clsNames   = (s.classes||[]).map(id=>escapeHtml((appState.classes||[]).find(c=>c.id===id)?.name)).filter(Boolean);
    const clsLabel   = clsNames.length ? clsNames.join(', ') : '';
    html+=`<div class="subj-tile" style="background:${bg};border-color:${hexToRgba(s.color,.4)}"
        onclick="openEditSubjectModal('${s.id}')">
      <div class="subj-tile-abbr" style="color:${s.color}">${escapeHtml(s.abbr)}</div>
      <div class="subj-tile-name" style="color:var(--text)">${escapeHtml(s.name)}</div>
      ${durLabel||clsLabel ? `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">
        ${durLabel?`<span style="font-size:.58rem;padding:1px 5px;border-radius:8px;background:${hexToRgba(s.color,.25)};color:${s.color}">${durLabel}</span>`:''}
        ${clsLabel?`<span style="font-size:.58rem;color:${s.color};opacity:.8">${clsLabel}</span>`:''}
      </div>` : ''}
      <div class="subj-tile-edit" onclick="event.stopPropagation();openEditSubjectModal('${s.id}')">✎</div>
    </div>`;
  });
  html+=`</div>
    <button class="wbtn wbtn-ghost" style="width:100%;margin-top:12px;padding:10px;font-size:.82rem;border-style:dashed"
      onclick="openAddSubjectModal()">+ Dodaj nowy przedmiot</button>
  </div>`;
  html += `</div>`;
  return html;
}
function settingsSale() {
  let html = `<div style="grid-column:1/-1">`;
  html+=`<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">`;

  // ── Sale ──
  html+=`<div class="settings-card">`;
  html+=`<div class="settings-card-title">Sale</div>`;
  html+=`<ul class="settings-list">`;
  sortByName(appState.rooms).forEach(r=>{
    const bld=(appState.buildings||[]).find(b=>b.id===r.buildingId);
    const rt=ROOM_TYPES[r.type]||ROOM_TYPES.full;
    const capBadge = r.capacity
      ? `<span class="room-cap-badge ${rt.cls}">${rt.icon} ${r.capacity} os.</span>`
      : `<span class="room-cap-badge">${rt.icon} ${rt.label}</span>`;
    html+=`<li class="settings-item">
      <div style="flex:1;min-width:0">
        <div class="settings-item-name" style="display:flex;align-items:center;gap:7px">
          ${bld?`<span class="cdot" style="background:${bld.color}"></span>`:''}
          ${escapeHtml(r.name)}
          ${capBadge}
        </div>
        <div class="settings-item-meta">${(()=>{
          const parts = [escapeHtml(bld?.name), escapeHtml(r.note)].filter(Boolean);
          const custs = (r.custodians||[]).map(id=>(appState.teachers||[]).find(t=>t.id===id)).filter(Boolean);
          if(custs.length) parts.push('Opiekunowie: '+custs.map(t=>escapeHtml(t.abbr)).join(', '));
          const prefSubjs = (r.preferredSubjects||[]).map(sid=>{
            const s=(appState.subjects||[]).find(s=>s.id===sid);
            return s?`<span style="font-size:.65rem;padding:1px 5px;border-radius:10px;background:${s.color}22;color:var(--text)">${escapeHtml(s.abbr||s.name)}</span>`:'';
          }).filter(Boolean).join(' ');
          return parts.join(' · ') + (prefSubjs ? '<br><span style="font-size:.68rem;color:var(--text-m)">Przedmioty: </span>'+prefSubjs : '');
        })()}</div>
      </div>
      <div class="settings-item-actions">
        <button class="si-btn" onclick="openEditRoomModal('${r.id}')">Edytuj</button>
      </div>
    </li>`;
  });
  html+=`</ul>`;
  html+=`<button class="wbtn wbtn-ghost" style="width:100%;margin-top:10px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddRoomModal()">+ Dodaj nową salę</button>`;
  html+=`</div>`;
  html += `</div>`;
  return html;
}
function settingsBudynki() {
  let html = `<div style="grid-column:1/-1">`;
  // ── Budynki ──
  html+=`<div class="settings-card">`;
  html+=`<div class="settings-card-title">Budynki / Lokalizacje</div>`;
  if((appState.buildings||[]).length){
    html+=`<ul class="settings-list">`;
    appState.buildings.forEach(b=>{
      const rooms  = appState.rooms.filter(r=>r.buildingId===b.id);
      const floors = b.floors||[];
      const preview = floors.length
        ? floors.map(fl=>`<span style="font-size:.68rem;background:var(--s3);border-radius:4px;padding:2px 7px;white-space:nowrap">🏢 ${escapeHtml(fl.label)}${fl.segments.length?' · '+fl.segments.map(s=>escapeHtml(s.label)).join(', '):''}</span>`).join(' ')
        : rooms.slice(0,4).map(r=>{ const rt=ROOM_TYPES[r.type]||ROOM_TYPES.full; return `<span style="font-size:.7rem;background:var(--s3);border-radius:4px;padding:1px 6px">${rt.icon} ${escapeHtml(r.name)}</span>`; }).join(' ')+(rooms.length>4?`<span style="font-size:.7rem;color:var(--text-d)">+${rooms.length-4}</span>`:'');
      html+=`<li class="settings-item" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="cdot" style="background:${b.color};width:14px;height:14px;flex-shrink:0"></span>
          <div style="flex:1">
            <div class="settings-item-name">${escapeHtml(b.name)}</div>
            <div class="settings-item-meta">${[escapeHtml(b.address),escapeHtml(b.note)].filter(Boolean).join(' · ')||''}${floors.length?' · '+floors.length+' pięt(r)':''}</div>
          </div>
          <span style="font-family:var(--mono);font-size:.72rem;color:var(--text-m)">${rooms.length} sal</span>
          <button class="si-btn" onclick="openEditBuildingModal('${b.id}')">Edytuj</button>
        </div>
        ${preview ? `<div style="display:flex;flex-wrap:wrap;gap:4px;padding-left:22px">${preview}</div>` : ''}
      </li>`;
    });
    html+=`</ul>`;
  } else {
    html+=`<div style="font-size:.82rem;color:var(--text-m);padding:8px 0">Brak budynków.</div>`;
  }
  html+=`<button class="wbtn wbtn-ghost" style="width:100%;margin-top:10px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddBuildingModal()">+ Dodaj budynek / lokalizację</button>`;
  html+=`</div>`;

  html+=`</div>`; // koniec wrappera Sale+Budynki
  html += `</div>`;
  return html;
}
function settingsGodziny() {
  let html = `<div style="grid-column:1/-1">`;
  const sortedH = [...appState.hours].sort((a,b)=>a.num-b.num);
  html+=`<div class="settings-card">`;
  html+=`<div class="settings-card-title">Godziny lekcyjne</div>`;
  html+=`<div class="hour-timeline">`;
  sortedH.forEach((h,i) => {
    const dur = timeToMins(h.end) - timeToMins(h.start);
    html+=`<div class="hour-row">
      <div class="hour-row-num">${h.num}</div>
      <div class="hour-row-time" onclick="openEditHourModal(${h.num})">
        <span class="hour-row-range">${h.start} – ${h.end}</span>
        <span class="hour-row-dur">${dur} min</span>
        <span style="margin-left:auto;font-size:.72rem;color:var(--accent)">✎</span>
      </div>
    </div>`;
    if(i < sortedH.length-1) {
      const next = sortedH[i+1];
      const brk = timeToMins(next.start) - timeToMins(h.end);
      if(brk > 0) html+=`<div class="hour-break-bar">przerwa ${brk} min</div>`;
    }
  });
  html+=`</div>`;
  html+=`<button class="wbtn wbtn-ghost" style="width:100%;margin-top:12px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddHourModal()">+ Dodaj godzinę</button>`;
  html+=`</div>`;
  html += `</div>`;
  return html;
}

function settingsDyzury() {
  let html = `<div style="grid-column:1/-1">`;
  if(!appState.duties || appState.duties.length===0) regenerateDuties();
  const sortedH = [...appState.hours].sort((a,b)=>a.num-b.num);
  const firstHour = sortedH[0];
  const lastHour  = sortedH[sortedH.length-1];
  const allDuties = [...(appState.duties||[])].sort((a,b)=>timeToMins(a.start)-timeToMins(b.start));
  html+=`<div class="settings-card">`;
  html+=`<div class="settings-card-title">Dyżury</div>`;
  html+=`<div class="duty-settings-list">`;
  if(firstHour) {
    const beforeEnd = firstHour.start;
    const beforeStart = minsToTime(timeToMins(beforeEnd) - 15);
    html+=`<div style="margin-bottom:6px">`;
    html+=`<button class="wbtn wbtn-ghost" style="width:100%;padding:7px;font-size:.75rem;border-style:dashed" onclick="openAddDutyModal('${beforeStart}','${beforeEnd}','Przed lekcjami')">+ Dyżur przed lekcjami</button>`;
    html+=`</div>`;
  }
  allDuties.forEach(d => {
    const filledDays = DUTY_DAY_KEYS.filter(k=>{
      const v=d.places&&d.places[k];
      return Array.isArray(v)?v.some(r=>r.place||r.teacherId):!!v;
    }).length;
    const isAuto = d.type==='break' || (!d.type && d.breakAfterHour!==undefined);
    html+=`<div class="duty-settings-row ${isAuto?'break-duty':'extra-duty'}">`;
    html+=`<div class="hour-row-num" style="display:flex;align-items:center;justify-content:center;min-width:28px">${isAuto?'P':'D'}</div>`;
    html+=`<div class="duty-slot" onclick="openEditDutyModal('${d.id}')">`;
    html+=`<span class="duty-slot-time">${d.start} – ${d.end}</span>`;
    html+=`<span class="duty-slot-label">${d.label||(isAuto?'Po lekcji '+(d.breakAfterHour||''):'Dyżur')}</span>`;
    html+=`<span class="duty-slot-places">${filledDays?filledDays+'/5 dni':''}</span>`;
    html+=`<span style="font-size:.7rem;color:var(--accent)">✎</span>`;
    html+=`</div>`;
    html+=`</div>`;
  });
  if(!allDuties.length) {
    html+=`<div style="font-size:.8rem;color:var(--text-m);padding:8px 0;text-align:center">Brak dyżurów — dodaj lub uzupełnij godziny lekcyjne.</div>`;
  }
  if(lastHour) {
    const afterStart = lastHour.end;
    const afterEnd   = minsToTime(timeToMins(afterStart) + 15);
    html+=`<div style="margin-top:6px">`;
    html+=`<button class="wbtn wbtn-ghost" style="width:100%;padding:7px;font-size:.75rem;border-style:dashed" onclick="openAddDutyModal('${afterStart}','${afterEnd}','Po lekcjach')">+ Dyżur po lekcjach</button>`;
    html+=`</div>`;
  }
  html+=`</div>`;
  html+=`<button class="wbtn wbtn-ghost" style="width:100%;margin-top:10px;padding:10px;font-size:.82rem;border-style:dashed" onclick="openAddDutyModal()">+ Dodaj inny dyżur</button>`;
  html+=`</div>`;
  html += `</div>`;
  return html;
}

function settingsSzkola() {
  let html = '';
  html+=`<div class="settings-card" style="grid-column:1/-1">
    <div class="settings-card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>Szkoła — rok szkolny i harmonogram</span>
      <button class="si-btn" onclick="saveSchoolSettings()">Zapisz</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="mfield">
        <label>Rok szkolny</label>
        <input class="minput" id="setSchoolYear" value="${escapeHtml(appState.schoolYear||appState.year||'')}" placeholder="2025/2026">
      </div>
      <div class="mfield">
        <label>Aktywny semestr</label>
        <select class="mselect" id="setActiveSem">
          <option value="1" ${(appState.activeSem||1)===1?'selected':''}>Semestr 1</option>
          <option value="2" ${(appState.activeSem||1)===2?'selected':''}>Semestr 2</option>
        </select>
      </div>
      <div class="mfield">
        <label style="font-size:.7rem;color:var(--text-m)">
          Semestr określa które przedmioty (sem.1 / sem.2) są aktywne w planie.
        </label>
      </div>
    </div>
    <div>
      <div style="font-size:.73rem;font-weight:700;color:var(--text-m);text-transform:uppercase;
        letter-spacing:.04em;margin-bottom:8px">Okno czasowe szkoły (godziny lekcji per dzień)</div>
      <div style="font-size:.72rem;color:var(--text-m);margin-bottom:8px">
        Ustaw od której do której godziny (numer) mogą odbywać się lekcje.
        Puste = bez ograniczeń (wszystkie godziny z harmonogramu).
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.75rem">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;color:var(--text-m);font-weight:600">Dzień</th>
          <th style="padding:4px 8px;color:var(--text-m);font-weight:600;text-align:center">Od godz.</th>
          <th style="padding:4px 8px;color:var(--text-m);font-weight:600;text-align:center">Do godz.</th>
          <th style="padding:4px 8px;color:var(--text-m);font-weight:600;text-align:center">Dzień wolny</th>
        </tr></thead>
        <tbody>
          ${['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'].map((day,di)=>{
            const w  = (appState.schoolWindow||{})[['mon','tue','wed','thu','fri'][di]]||[null,null];
            const off = w[2]===true;
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:5px 8px;font-weight:600">${day}</td>
              <td style="padding:3px 6px;text-align:center">
                <input class="minput" id="swFrom_${di}" type="number" min="0" max="20" style="width:60px;text-align:center;padding:4px"
                  value="${w[0]??''}" placeholder="—" ${off?'disabled':''}>
              </td>
              <td style="padding:3px 6px;text-align:center">
                <input class="minput" id="swTo_${di}" type="number" min="0" max="20" style="width:60px;text-align:center;padding:4px"
                  value="${w[1]??''}" placeholder="—" ${off?'disabled':''}>
              </td>
              <td style="padding:3px 6px;text-align:center">
                <label style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
                  <input type="checkbox" id="swOff_${di}" ${off?'checked':''}
                    onchange="document.getElementById('swFrom_${di}').disabled=this.checked;document.getElementById('swTo_${di}').disabled=this.checked"
                    style="accent-color:var(--accent);width:15px;height:15px">
                  <span style="font-size:.7rem;color:var(--text-d)">wolny</span>
                </label>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
  html += settingsDangerZone();
  return html;
}
function settingsNI() {
  let html = `<div style="grid-column:1/-1">`;
  html += niSettingsSection();
  html += `</div>`;
  return html;
}
function settingsDangerZone() {
  let html = '';

  html += niSettingsSection();

  html+=`<div class="settings-card" style="grid-column:1/-1">`;
  html+=`<div class="settings-card-title" style="color:var(--red)">Strefa niebezpieczna</div>`;
  html+=`<div style="font-size:.82rem;color:var(--text-m);margin-bottom:12px;line-height:1.5">Operacje, których nie można cofnąć.</div>`;
  html+=`<button class="wbtn wbtn-danger" onclick="clearSchedule()" style="width:100%;margin-bottom:8px">🗑 Wyczyść cały plan lekcji</button>`;
  html+=`<button class="wbtn wbtn-danger" onclick="resetApp()" style="width:100%">⚠️ Resetuj całą aplikację</button>`;
  html+=`</div>`;
  return html;
}

function toggleTchCard(id) {
  const card = document.getElementById('tcard_' + id);
  if (card) card.classList.toggle('open');
}

function toggleClsCard(id) {
  const card = document.getElementById('ccard_' + id);
  if (card) card.classList.toggle('open');
}

function clearSchedule() {
  if(!confirm('Wyczyścić cały plan? Wszystkie lekcje zostaną usunięte.'))return;
  schedData={};persistAll();renderCurrentView();detectAndShowConflicts();notify('Plan wyczyszczony');
}
function resetApp() {
  if(!confirm('UWAGA: Zresetować całą aplikację? Stracisz wszystkie dane!'))return;
  localStorage.removeItem(LS.STATE);localStorage.removeItem(LS.SCHED);
  appState=null;schedData={};
  document.getElementById('appRoot').classList.remove('show');
  showWelcome();
}

// ================================================================
//  LESSON MODAL
// ================================================================
function openAddModal(clsId, dayIdx, hourIdx, prefTeacherId='', prefRoomId='') {
  if(!appState)return;
  // Widok sal: brak klasy — pokaż wybór klasy przed otwarciem modalu
  if(!clsId) {
    const classes = appState.classes||[];
    if(!classes.length) { notify('Brak klas — dodaj klasy w Ustawieniach'); return; }
    if(classes.length === 1) { clsId = classes[0].id; }
    else {
      // Prosty wybór klasy
      const chosen = classes.find(c=>c.id === (window._lastRoomAddCls||'')) || null;
      const sel = document.createElement('div');
      sel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900;display:flex;align-items:center;justify-content:center';
      sel.innerHTML = `<div style="background:var(--s1);border-radius:var(--radius-lg);padding:20px;
        width:280px;max-height:80vh;overflow-y:auto;border:1px solid var(--border)">
        <div style="font-weight:700;margin-bottom:12px">Wybierz klasę</div>
        ${classes.map(c=>`<button onclick="window._lastRoomAddCls='${c.id}';document.body.removeChild(document.getElementById('_clsPicker'));openAddModal('${c.id}',${dayIdx},${hourIdx},'${prefTeacherId}','${prefRoomId}')"
          style="display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:4px;
                 background:var(--s2);border:1px solid var(--border);border-radius:6px;cursor:pointer;
                 color:var(--text);font-family:var(--font);font-size:.85rem">
          ${c.name}</button>`).join('')}
        <button onclick="document.body.removeChild(document.getElementById('_clsPicker'))"
          style="width:100%;margin-top:8px;padding:7px;background:transparent;border:1px solid var(--border);
                 border-radius:6px;cursor:pointer;color:var(--text-m);font-family:var(--font)">
          Anuluj</button>
      </div>`;
      sel.id = '_clsPicker';
      document.body.appendChild(sel);
      return;
    }
  }
  _mCtx = {mode:'add', clsId, dayIdx, hourIdx};
  const h=appState.hours.find(h=>h.num===hourIdx);
  document.getElementById('lessonModalTitle').innerHTML =
    `Dodaj lekcję — <span>${DAYS[dayIdx]}, godz. ${hourIdx} (${h?h.start+'-'+h.end:''})</span>`;
  document.getElementById('mSubject').value='';
  document.getElementById('mNote').value='';
  document.getElementById('mDeleteBtn').style.display='none';
  document.getElementById('mTeacherWarn').style.display='none';
  populateGroupsInModal(clsId,[]);

  // Show/hide class field based on context
  const mClassField=document.getElementById('mClassField');
  const mClass=document.getElementById('mClass');
  mClassField.style.display='none';
  if(mClass)mClass.value=clsId;

  // Zbuduj listę nauczycieli z podziałem (bez filtra przedmiotu)
  rebuildTeacherOptions();
  if(prefTeacherId) document.getElementById('mTeacher').value=prefTeacherId;
  // Podpowiedz salę-gospodarz klasy jeśli nie podano innej
  if(!prefRoomId){
    const cls=appState.classes.find(c=>c.id===clsId);
    const firstHomeRoom=(cls&&cls.homeRooms&&cls.homeRooms.length)?cls.homeRooms[0]:'';
    document.getElementById('mRoom').value=firstHomeRoom;
  } else {
    document.getElementById('mRoom').value=prefRoomId;
  }

  document.getElementById('lessonModal').classList.add('show');
}

function openEditModal(clsId, dayIdx, hourIdx) {
  const lesson=getLesson(clsId,dayIdx,hourIdx);
  if(!lesson)return;
  _mCtx = {mode:'edit', clsId, dayIdx, hourIdx};
  const h=appState.hours.find(h=>h.num===hourIdx);
  const cls=appState.classes.find(c=>c.id===clsId);
  document.getElementById('lessonModalTitle').innerHTML =
    `Edytuj lekcję — <span>${cls?.name||''}, ${DAYS[dayIdx]}, godz. ${hourIdx}</span>`;
  document.getElementById('mSubject').value=lesson.subjectId||'';
  document.getElementById('mNote').value=lesson.note||'';
  document.getElementById('mDeleteBtn').style.display='';
  document.getElementById('mTeacherWarn').style.display='none';
  populateGroupsInModal(clsId, lesson.groups||[]);
  // Zbuduj listę nauczycieli z podziałem uwzględniając przedmiot i klasę
  rebuildTeacherOptions();
  document.getElementById('mTeacher').value=lesson.teacherId||'';
  document.getElementById('mRoom').value=lesson.roomId||'';
  // Sprawdź walidację dla istniejącej lekcji
  mOnTeacherChange();
  document.getElementById('lessonModal').classList.add('show');
}

function populateGroupsInModal(clsId, selectedGroups) {
  const cls=appState?.classes.find(c=>c.id===clsId);
  const container=document.getElementById('mGroupList');
  const field=document.getElementById('mGroupField');
  if(!cls||!cls.groups||!cls.groups.length){field.style.display='none';return;}
  field.style.display='';
  const sel = (selectedGroups||[]).map(g=>typeof g==='string'?g:g.name);
  container.innerHTML=cls.groups.map(g=>{
    const name = typeof g==='string'?g:g.name;
    return `<label class="gchk ${sel.includes(name)?'checked':''}">
      <input type="checkbox" value="${escapeHtml(name)}" ${sel.includes(name)?'checked':''} onchange="gChkChange(this)">
      ${escapeHtml(name)}
    </label>`;
  }).join('');
}

// Gdy zmienia się klasa w modalu (tryb macierzy nauczyciela)
function mOnClassChange() {
  const clsId=document.getElementById('mClass')?.value;
  if(clsId && _mCtx) {
    _mCtx.clsId=clsId; // tymczasowo ustaw żeby rebuildTeacherOptions wiedział o klasie
    populateGroupsInModal(clsId,[]);
    rebuildTeacherOptions();
    mOnTeacherChange();
  }
}

function gChkChange(inp){
  inp.parentElement.classList.toggle('checked',inp.checked);
}

function mOnSubjectChange() {
  rebuildTeacherOptions();
  mOnTeacherChange();
}

function rebuildTeacherOptions() {
  const subjId = document.getElementById('mSubject').value;
  const mt = document.getElementById('mTeacher');
  const clsId = _mCtx ? _mCtx.clsId : null;
  if (!appState) return;

  const prevVal = mt.value;
  mt.innerHTML = '<option value="">— wybierz nauczyciela —</option>';

  // Podziel nauczycieli na 3 grupy:
  // 1. Ma przydział do tej klasy I tego przedmiotu
  // 2. Uczy tego przedmiotu (ma przydział do jakiejkolwiek klasy z tym przedmiotem)
  // 3. Pozostali
  const g1 = [], g2 = [], g3 = [];
  appState.teachers.forEach(t => {
    const hasAssignment = clsId && subjId &&
      (t.assignments||[]).some(a => a.classId === clsId && a.subjectId === subjId);
    const teachesSubj = subjId &&
      (t.assignments||[]).some(a => a.subjectId === subjId);
    if (hasAssignment)       g1.push(t);
    else if (teachesSubj)    g2.push(t);
    else                     g3.push(t);
  });

  function addGroup(teachers, label, prefix) {
    if (!teachers.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    teachers.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = prefix + t.first + ' ' + t.last + ' (' + t.abbr + ')';
      opt.style.fontWeight = prefix ? '700' : '';
      og.appendChild(opt);
    });
    mt.appendChild(og);
  }

  if (subjId || clsId) {
    addGroup(g1, '✓ Przypisani do tej klasy i przedmiotu', '');
    addGroup(g2, '~ Uczą tego przedmiotu (bez przydziału do klasy)', '');
    addGroup(g3, 'Pozostali nauczyciele', '');
  } else {
    // Brak filtra — pokaż wszystkich płasko
    appState.teachers.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.first + ' ' + t.last + ' (' + t.abbr + ')';
      mt.appendChild(opt);
    });
  }

  // Przywróć poprzednią wartość jeśli dostępna
  if (prevVal && [...mt.options].some(o => o.value === prevVal)) {
    mt.value = prevVal;
  } else if (g1.length && !prevVal) {
    mt.value = g1[0].id; // auto-wybierz pierwszy z grupy 1
  } else if (g2.length && !prevVal) {
    mt.value = g2[0].id;
  }
}

function mOnTeacherChange() {
  const subjId  = document.getElementById('mSubject').value;
  const tchId   = document.getElementById('mTeacher').value;
  const warn    = document.getElementById('mTeacherWarn');
  const clsId   = _mCtx ? _mCtx.clsId : null;
  if (!warn) return;

  if (!tchId || !clsId) { warn.style.display = 'none'; return; }

  const t    = appState.teachers.find(t => t.id === tchId);
  const cls  = appState.classes.find(c => c.id === clsId);
  const subj = appState.subjects.find(s => s.id === subjId);

  if (!t) { warn.style.display = 'none'; return; }

  // Sprawdź czy ma przydział do tej klasy i przedmiotu
  const hasExactAssignment = subjId &&
    (t.assignments||[]).some(a => a.classId === clsId && a.subjectId === subjId);
  const hasClassAssignment =
    (t.assignments||[]).some(a => a.classId === clsId);
  const teachesSubject = subjId &&
    (t.assignments||[]).some(a => a.subjectId === subjId);

  if (hasExactAssignment) {
    warn.style.display = 'none';
    return;
  }

  let msg = '';
  if (!teachesSubject && subjId) {
    msg = `⚠️ ${t.abbr} nie prowadzi ${subj ? subj.name : 'tego przedmiotu'} w żadnej klasie.`;
  } else if (!hasClassAssignment && subjId) {
    msg = `ℹ️ ${t.abbr} nie ma przydziału do klasy ${cls ? cls.name : ''} dla ${subj ? subj.name : 'tego przedmiotu'}.`;
  } else if (subjId) {
    msg = `ℹ️ ${t.abbr} uczy ${subj ? subj.name : 'tego przedmiotu'}, ale bez formalnego przydziału do klasy ${cls ? cls.name : ''}.`;
  }

  if (msg) {
    warn.textContent = msg;
    warn.style.display = '';
    // Ostrzeżenie vs błąd
    if (msg.startsWith('⚠️')) {
      warn.style.background = 'var(--red-g)';
      warn.style.borderColor = 'rgba(248,113,113,.3)';
      warn.style.color = 'var(--red)';
    } else {
      warn.style.background = 'var(--yellow-g)';
      warn.style.borderColor = 'rgba(251,191,36,.3)';
      warn.style.color = 'var(--yellow)';
    }
  } else {
    warn.style.display = 'none';
  }
}

function saveLessonModal() {
  const subjId=document.getElementById('mSubject').value;
  const tchId=document.getElementById('mTeacher').value;
  const roomId=document.getElementById('mRoom').value;
  const note=document.getElementById('mNote').value.trim();
  if(!subjId){notify('Wybierz przedmiot');return;}
  if(!tchId){notify('Wybierz nauczyciela');return;}
  // clsId: z kontekstu lub z pola wyboru klasy (tryb macierzy nauczyciel)
  let clsId = _mCtx.clsId;
  if(!clsId){
    clsId=document.getElementById('mClass')?.value;
    if(!clsId){notify('Wybierz klasę');return;}
  }
  const groups=[...document.querySelectorAll('#mGroupList input:checked')].map(i=>i.value);
  // Jeśli zmieniono klasę, odśwież grupy (nie blokuj zapisu)
  const lesson={subjectId:subjId,teacherId:tchId,roomId:roomId||null,groups,note};
  undoBatchStart();
  setLesson(clsId,_mCtx.dayIdx,_mCtx.hourIdx,lesson);
  undoBatchEnd();
  closeLessonModal();
  renderCurrentView();
  detectAndShowConflicts();
  notify('Lekcja zapisana');
}

function deleteLessonModal() {
  if(!confirm('Usunąć tę lekcję?'))return;
  undoBatchStart();
  setLesson(_mCtx.clsId,_mCtx.dayIdx,_mCtx.hourIdx,null);
  undoBatchEnd();
  closeLessonModal();
  renderCurrentView();
  detectAndShowConflicts();
  notify('Lekcja usunięta');
}

function deleteLesson(clsId,dayIdx,hourIdx){
  undoBatchStart();
  setLesson(clsId,dayIdx,hourIdx,null);
  undoBatchEnd();
  renderCurrentView();
  detectAndShowConflicts();
  notify('Lekcja usunięta');
}

function closeLessonModal(){
  document.getElementById('lessonModal').classList.remove('show');
  _mCtx=null;
}

// Close modal on backdrop click
document.getElementById('lessonModal').addEventListener('click',function(e){
  if(e.target===this)closeLessonModal();
});

// ================================================================
//  DRAG & DROP
// ================================================================
function doDragStart(e, clsId, dayIdx, hourIdx) {
  _dragData={clsId,dayIdx,hourIdx};
  e.dataTransfer.effectAllowed='move';
  // Zapisz też w dataTransfer jako fallback (wymagane przez niektóre przeglądarki)
  try { e.dataTransfer.setData('text/plain', clsId+'|'+dayIdx+'|'+hourIdx); } catch(_){}
  const chip = e.currentTarget;
  setTimeout(()=>{ if(chip) chip.classList.add('dragging'); }, 0);
}
function doDragEnd(e){
  document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));
  _dragData=null;
}
function doDragOver(e,td){
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect='move';
  td.classList.add('droptarget-hover');
}
function doDragLeave(e){
  // Ignoruj leave jeśli mysz weszła w child element (np. chip wewnątrz td)
  const td = e.currentTarget;
  if(td.contains(e.relatedTarget)) return;
  td.classList.remove('droptarget-hover');
}
function doDrop(e,toClsId,toDayIdx,toHourIdx){
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.droptarget-hover').forEach(el=>el.classList.remove('droptarget-hover'));
  if(!_dragData)return;
  const {clsId,dayIdx,hourIdx}=_dragData;
  if(clsId===toClsId&&dayIdx===toDayIdx&&hourIdx===toHourIdx){_dragData=null;return;}
  const src=getLesson(clsId,dayIdx,hourIdx);
  const dst=getLesson(toClsId,toDayIdx,toHourIdx);
  undoBatchStart();
  setLesson(toClsId,toDayIdx,toHourIdx,src);
  setLesson(clsId,dayIdx,hourIdx,dst||null);
  undoBatchEnd();
  _dragData=null;
  renderCurrentView();
  detectAndShowConflicts();
  notify('Lekcja przeniesiona');
}

// ================================================================
//  CONFLICT DETECTION
// ================================================================
function detectConflicts() {
  const conflicts=[];
  if(!appState)return conflicts;
  const hours=appState.hours;

  // Group all lessons by (dayIdx, hourNum) using pre-built index
  const bySlot = getSlotIndex();

  const tchMap  = new Map((appState.teachers||[]).map(t=>[t.id,t]));
  const roomMap = new Map((appState.rooms||[]).map(r=>[r.id,r]));
  const clsMap  = new Map((appState.classes||[]).map(c=>[c.id,c]));

  Object.entries(bySlot).forEach(([slot,entries])=>{
    const [dayIdx,hourNum]=slot.split('_').map(Number);
    if(entries.length < 2) return;
    // Teacher conflict: same teacher in 2+ entries
    const byTeacher={};
    entries.forEach(e=>{
      if(!e.teacherId)return;
      if(!byTeacher[e.teacherId])byTeacher[e.teacherId]=[];
      byTeacher[e.teacherId].push(e);
    });
    Object.entries(byTeacher).forEach(([tchId,ents])=>{
      if(ents.length>1){
        const tch=tchMap.get(tchId);
        const clsNames=ents.map(e=>escapeHtml(clsMap.get(e.clsId)?.name)||'?').join(', ');
        conflicts.push({type:'teacher',tchId,dayIdx,hourNum,clsIds:ents.map(e=>e.clsId),
          text:`<strong>${escapeHtml(tch?.abbr)||'?'} ${escapeHtml(tch?.last)||''}</strong> <span>ma jednocześnie lekcje w klasach: ${clsNames} (${DAYS[dayIdx]}, godz. ${hourNum})</span>`});
      }
    });
    // Room conflict: same room in 2+ entries
    const byRoom={};
    entries.forEach(e=>{
      if(!e.roomId)return;
      if(!byRoom[e.roomId])byRoom[e.roomId]=[];
      byRoom[e.roomId].push(e);
    });
    Object.entries(byRoom).forEach(([roomId,ents])=>{
      if(ents.length>1){
        const room=roomMap.get(roomId);
        const clsNames=ents.map(e=>escapeHtml(clsMap.get(e.clsId)?.name)||'?').join(', ');
        conflicts.push({type:'room',roomId,dayIdx,hourNum,clsIds:ents.map(e=>e.clsId),
          text:`<strong>Sala ${escapeHtml(room?.name)||'?'}</strong> <span>zajęta jednocześnie przez klasy: ${clsNames} (${DAYS[dayIdx]}, godz. ${hourNum})</span>`});
      }
    });
  });
  return conflicts;
}

// Pre-built slot index: {day_hour: [{clsId, teacherId, roomId}]}
function buildSlotIndex() {
  const idx = {};
  Object.entries(schedData).forEach(([k, v]) => {
    const parts = k.split('_');
    const slotKey = parts[1] + '_' + parts[2];
    if(!idx[slotKey]) idx[slotKey] = [];
    idx[slotKey].push({ clsId: parts[0], teacherId: v.teacherId, roomId: v.roomId });
  });
  return idx;
}

let _cachedSlotIndex = null;
let _slotIndexVersion = 0;
let _schedVersion = 0;

function invalidateSlotIndex() {
  _cachedSlotIndex = null;
  _schedVersion++;
}

function getSlotIndex() {
  if(!_cachedSlotIndex) {
    _cachedSlotIndex = buildSlotIndex();
    _slotIndexVersion = _schedVersion;
  }
  return _cachedSlotIndex;
}

function checkCellConflict(clsId, dayIdx, hourIdx, lesson) {
  if(!lesson||!appState)return false;
  const idx = getSlotIndex();
  const entries = idx[dayIdx+'_'+hourIdx];
  if(!entries) return false;
  return entries.some(e => e.clsId !== clsId &&
    ((lesson.teacherId && e.teacherId === lesson.teacherId) || (lesson.roomId && e.roomId === lesson.roomId))
  );
}

function detectAndShowConflicts() {
  const conflicts=detectConflicts();
  const bar=document.getElementById('conflictBar');
  const count=document.getElementById('conflictCount');
  const list=document.getElementById('conflictList');
  if(!conflicts.length){bar.style.display='none';list.classList.remove('show');return;}
  bar.style.display='flex';
  count.textContent=conflicts.length;
  document.getElementById('conflictBarText').textContent=
    `${conflicts.length} ${conflicts.length===1?'konflikt':conflicts.length<5?'konflikty':'konfliktów'} w planie`;

  list.innerHTML=conflicts.map((c,i)=>`
    <div class="conflict-item">
      <div class="conflict-item-icon">${c.type==='teacher'?'👩‍🏫':'🏫'}</div>
      <div class="conflict-item-text">${c.text}</div>
      <button class="conflict-goto" onclick="gotoConflict(${i})">Przejdź →</button>
    </div>`).join('');
}

function toggleConflicts() {
  const bar=document.getElementById('conflictBar');
  const list=document.getElementById('conflictList');
  bar.classList.toggle('open');
  list.classList.toggle('show');
}

function gotoConflict(idx) {
  const conflicts=detectConflicts();
  const c=conflicts[idx];
  if(!c)return;
  if(c.clsIds&&c.clsIds[0]){
    switchView('class',document.querySelector('[data-view=class]'));
    document.getElementById('classSelect').value=c.clsIds[0];
    document.getElementById('classDaySelect').value=c.dayIdx;
    renderClassView();
  }
}

// ================================================================
//  EXPORT / IMPORT
// ================================================================
function exportJSON() {
  if(!appState){notify('Brak danych do eksportu');return;}
  const data={version:1,appState,schedData,exportDate:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const y=(appState.year||'').replace('/','_');
  a.href=url;a.download=`planlekcji_${y}_${Date.now()}.json`;
  a.click();URL.revokeObjectURL(url);
  notify('Wyeksportowano plan do JSON');
}

function handleImportFile(file) {
  if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.appState)throw new Error('Nieprawidłowy format pliku');
      appState=data.appState;
      schedData=data.schedData||{};
      _demoMode=false;
      persistAll();
      document.getElementById('welcomeScreen').classList.remove('show');
      showApp();
      notify('Zaimportowano plan: '+appState.name);
    }catch(err){
      notify('Błąd importu: '+err.message);
    }
  };
  reader.readAsText(file);
}

// ================================================================
//  THEME
// ================================================================
function applyTheme(){
  const t=localStorage.getItem(LS.THEME)||'dark';
  document.body.classList.toggle('light',t==='light');
  const btn=document.getElementById('themeBtn');
  if(btn)btn.textContent=t==='light'?'🌙':'☀️';
}
function toggleTheme(){
  const isLight=document.body.classList.toggle('light');
  localStorage.setItem(LS.THEME,isLight?'light':'dark');
  const btn=document.getElementById('themeBtn');
  if(btn)btn.textContent=isLight?'🌙':'☀️';
}

// ================================================================
//  NOTIFY TOAST
// ================================================================
let _notifyTimer=null;
function notify(msg){
  const el=document.getElementById('notify');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_notifyTimer);
  _notifyTimer=setTimeout(()=>el.classList.remove('show'),2500);
}

// ================================================================
//  ESCAPE HTML (XSS protection)
// ================================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================================================================
//  COLOR UTILS
// ================================================================
function hexToRgba(hex,alpha){
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function isDarkColor(hex){
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000 < 128;
}

// ================================================================
//  DEMO DATA
// ================================================================
function buildDemoState() {
  return {
    name:'SP nr 5 im. Jana Pawła II',year:'2025/2026',
    classes:[
      {id:'c1',name:'1a',groups:[]},{id:'c2',name:'1b',groups:[]},
      {id:'c3',name:'2a',groups:['gr1','gr2']},{id:'c4',name:'3a',groups:[]},
    ],
    subjects:[
      {id:'s1',name:'Matematyka',abbr:'MAT',color:'#38bdf8'},
      {id:'s2',name:'Język polski',abbr:'POL',color:'#34d399'},
      {id:'s3',name:'Fizyka',abbr:'FIZ',color:'#fbbf24'},
      {id:'s4',name:'Historia',abbr:'HIS',color:'#a78bfa'},
      {id:'s5',name:'Biologia',abbr:'BIO',color:'#2dd4bf'},
      {id:'s6',name:'Angielski',abbr:'ANG',color:'#f472b6'},
      {id:'s7',name:'WF',abbr:'WF',color:'#fb923c'},
    ],
    teachers:[
      {id:'t1',first:'Anna',last:'Kowalska',abbr:'AKow',hoursTotal:18,hoursExtra:2,
        subjects:['s1','s3'],
        assignments:[
          {classId:'c1',subjectId:'s1',hours:3},{classId:'c2',subjectId:'s1',hours:3},
          {classId:'c3',subjectId:'s1',hours:4},{classId:'c4',subjectId:'s3',hours:2},
        ]},
      {id:'t2',first:'Jan',last:'Nowak',abbr:'JNow',hoursTotal:18,
        subjects:['s2','s4'],
        assignments:[
          {classId:'c1',subjectId:'s2',hours:4},{classId:'c2',subjectId:'s2',hours:4},
          {classId:'c3',subjectId:'s4',hours:2},{classId:'c4',subjectId:'s2',hours:3},
        ]},
      {id:'t3',first:'Maria',last:'Wiśniewska',abbr:'MWis',hoursTotal:20,
        subjects:['s5','s6'],
        assignments:[
          {classId:'c1',subjectId:'s6',hours:3},{classId:'c2',subjectId:'s6',hours:3},
          {classId:'c3',subjectId:'s5',hours:2},{classId:'c4',subjectId:'s6',hours:3},
        ]},
      {id:'t4',first:'Tomasz',last:'Zając',abbr:'TZaj',hoursTotal:16,hoursExtra:3,
        subjects:['s3','s7'],
        assignments:[
          {classId:'c1',subjectId:'s7',hours:2},{classId:'c2',subjectId:'s7',hours:2},
          {classId:'c3',subjectId:'s7',hours:2},{classId:'c4',subjectId:'s3',hours:3},
        ]},
    ],
    buildings:[
      {id:'bld1',name:'Budynek główny',address:'ul. Szkolna 1',color:'#38bdf8',note:''},
      {id:'bld2',name:'Hala sportowa',address:'ul. Sportowa 3',color:'#34d399',note:'5 min pieszo'},
    ],
    rooms:[
      {id:'r1',name:'101',buildingId:'bld1'},{id:'r2',name:'102',buildingId:'bld1'},
      {id:'r3',name:'Sala gym.',buildingId:'bld2'},{id:'r4',name:'Laboratorium',buildingId:'bld1'},
    ],
    hours:[
      {num:1,start:'08:00',end:'08:45'},{num:2,start:'08:55',end:'09:40'},
      {num:3,start:'09:50',end:'10:35'},{num:4,start:'10:45',end:'11:30'},
      {num:5,start:'11:40',end:'12:25'},{num:6,start:'13:00',end:'13:45'},
      {num:7,start:'13:55',end:'14:40'},
    ]
  };
}
function buildDemoSched(){
  // Some sample lessons
  const s={};
  function add(clsId,day,hour,subjId,tchId,roomId){
    s[`${clsId}_${day}_${hour}`]={subjectId:subjId,teacherId:tchId,roomId,groups:[],note:''};
  }
  // class c1
  add('c1',0,1,'s1','t1','r1'); add('c1',0,2,'s2','t2','r2'); add('c1',0,3,'s6','t3','r1');
  add('c1',1,1,'s3','t4','r4'); add('c1',1,2,'s4','t1','r2'); add('c1',1,4,'s7','t4','r3');
  add('c1',2,1,'s2','t2','r1'); add('c1',2,2,'s1','t1','r1'); add('c1',2,5,'s5','t3','r4');
  add('c1',3,1,'s6','t3','r2'); add('c1',3,3,'s1','t1','r1'); add('c1',3,4,'s4','t2','r2');
  add('c1',4,1,'s7','t4','r3'); add('c1',4,2,'s3','t4','r4'); add('c1',4,3,'s2','t2','r1');
  // class c2
  add('c2',0,1,'s2','t2','r2'); add('c2',0,2,'s1','t1','r1'); add('c2',0,4,'s7','t4','r3');
  add('c2',1,1,'s6','t3','r2'); add('c2',1,2,'s5','t3','r4'); add('c2',1,3,'s2','t2','r2');
  add('c2',2,1,'s3','t4','r4'); add('c2',2,2,'s4','t1','r1'); add('c2',2,3,'s7','t4','r3');
  add('c2',3,2,'s1','t1','r1'); add('c2',3,3,'s6','t3','r2'); add('c2',3,5,'s4','t2','r2');
  add('c2',4,1,'s2','t2','r1'); add('c2',4,2,'s5','t3','r4'); add('c2',4,4,'s1','t1','r1');
  // class c3
  add('c3',0,1,'s1','t1','r1'); add('c3',0,3,'s6','t3','r2'); add('c3',0,4,'s4','t2','r2');
  add('c3',1,1,'s2','t2','r1'); add('c3',1,2,'s7','t4','r3'); add('c3',1,5,'s3','t4','r4');
  add('c3',2,2,'s4','t1','r2'); add('c3',2,3,'s1','t1','r1'); add('c3',2,4,'s2','t2','r1');
  return s;
}


// ================================================================
//  TEACHER MODAL
// ================================================================
let _tmId = null; // null = new teacher, id = edit existing
let _tmAssignments = []; // [{classId, subjectId, hours}]
let _tmIndiv = [];

function openAddTeacherModal() {
  _tmId = null;
  _tmAssignments = [];
  document.getElementById('teacherModalTitle').innerHTML = 'Dodaj <span>nauczyciela</span>';
  document.getElementById('tmFirst').value = '';
  document.getElementById('tmLast').value = '';
  document.getElementById('tmAbbr').value = '';
  document.getElementById('tmHoursTotal').value = '';
  document.getElementById('tmHoursExtra').value = '';
  document.getElementById('tmEmployment').value = 'full';
  document.getElementById('tmAbbr')._userEdited = false;
  document.getElementById('tmFraction').value = '';
  document.getElementById('tmFractionWrap').style.display='none';
  _tmIndiv = [];
  tmFillIndivSubject();
  document.getElementById('tmDeleteBtn').style.display = 'none';
  tmRenderAssignments();
  tmFillSelects();
  document.getElementById('teacherModal').classList.add('show');
}

function openEditTeacherModal(id) {
  const t = appState.teachers.find(t => t.id === id);
  if (!t) return;
  _tmId = id;
  _tmAssignments = JSON.parse(JSON.stringify(t.assignments || []));
  document.getElementById('teacherModalTitle').innerHTML = `Edytuj: <span>${escapeHtml(t.first)} ${escapeHtml(t.last)}</span>`;
  document.getElementById('tmFirst').value = t.first || '';
  document.getElementById('tmLast').value = t.last || '';
  const tmAbbrEl = document.getElementById('tmAbbr');
  tmAbbrEl.value = t.abbr || '';
  tmAbbrEl._userEdited = !!(t.abbr);
  document.getElementById('tmHoursTotal').value = t.hoursTotal || '';
  document.getElementById('tmHoursExtra').value = t.hoursExtra || '';
  document.getElementById('tmEmployment').value = t.employment || 'full';
  document.getElementById('tmFraction').value = t.employmentFraction!==undefined&&t.employment==='other' ? t.employmentFraction : '';
  document.getElementById('tmFractionWrap').style.display = t.employment==='other' ? '' : 'none';
  document.getElementById('tmDeleteBtn').style.display = '';
  _tmIndiv = JSON.parse(JSON.stringify(t.individualTeaching || []));
  tmRenderAssignments();
  tmFillSelects();
  niUpdateTeacherBadge(id);
  document.getElementById('teacherModal').classList.add('show');
}

function tmAutoAbbr() {
  const f = document.getElementById('tmFirst').value || '';
  const l = document.getElementById('tmLast').value || '';
  const el = document.getElementById('tmAbbr');
  if(el && !el._userEdited) {
    // Zbierz istniejące skróty z wyjątkiem edytowanego nauczyciela
    const existing = (appState?.teachers||[])
      .filter(t=>t.id!==_tmId)
      .map(t=>t.abbr);
    el.value = uniqueAbbr(f, l, existing);
  }
}

function tmRenderSubjects(selected) {
  const container = document.getElementById('tmSubjectList');
  if (!appState) { container.innerHTML = ''; return; }
  container.innerHTML = sortSubjects(appState.subjects).map(s => `
    <label class="schk ${selected.includes(s.id) ? 'checked' : ''}">
      <input type="checkbox" value="${s.id}" ${selected.includes(s.id) ? 'checked' : ''}
        onchange="this.parentElement.classList.toggle('checked',this.checked)">
      <span class="schk-dot" style="background:${s.color}"></span>
      ${s.name}
    </label>`).join('');
}

function tmFillSelects() {
  if (!appState) return;
  const cls = document.getElementById('tmAddClass');
  cls.innerHTML = '<option value="">— klasa —</option>' +
    sortByName(appState.classes).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const subj = document.getElementById('tmAddSubject');
  subj.innerHTML = '<option value="">— przedmiot —</option>' +
    sortSubjects(appState.subjects).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

function tmRenderAssignments() {
  const tbody = document.getElementById('tmAssignBody');
  if (!appState) { tbody.innerHTML = ''; return; }
  tbody.innerHTML = _tmAssignments.map((a, i) => {
    const cls = appState.classes.find(c => c.id === a.classId);
    const subj = appState.subjects.find(s => s.id === a.subjectId);
    return `<tr>
      <td><strong>${cls ? cls.name : '?'}</strong></td>
      <td>
        <span class="cdot" style="background:${subj ? subj.color : '#888'};margin-right:5px"></span>
        ${subj ? subj.name : '?'}
      </td>
      <td><input class="assign-num" type="number" min="1" max="20" value="${a.hours}"
        onchange="_tmAssignments[${i}].hours=parseInt(this.value)||1"></td>
      <td><span class="tag-del" style="font-size:1rem;cursor:pointer;padding:2px 6px" onclick="_tmAssignments.splice(${i},1);tmRenderAssignments()">×</span></td>
    </tr>`;
  }).join('');
  if (!_tmAssignments.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-m);font-size:.78rem;padding:10px">Brak przydziałów — dodaj klasę, przedmiot i liczbę godzin</td></tr>';
  }
}

function tmAddAssignment() {
  const classId = document.getElementById('tmAddClass').value;
  const subjectId = document.getElementById('tmAddSubject').value;
  const hours = parseInt(document.getElementById('tmAddHours').value) || 1;
  if (!classId) { notify('Wybierz klasę'); return; }
  if (!subjectId) { notify('Wybierz przedmiot'); return; }
  // Check duplicate
  const exists = _tmAssignments.find(a => a.classId === classId && a.subjectId === subjectId);
  if (exists) { notify('Ten przydział już istnieje'); return; }
  _tmAssignments.push({ classId, subjectId, hours });
  // subjects[] nieużywane — wynika z assignments
  document.getElementById('tmAddClass').value = '';
  document.getElementById('tmAddSubject').value = '';
  document.getElementById('tmAddHours').value = '1';
  tmRenderAssignments();
}


// ── Nauczanie indywidualne ──

function tmFillIndivSubject() {
  const sel = document.getElementById('tmIndivSubject');
  if(!sel||!appState) return;
  sel.innerHTML = '<option value="">— dowolny —</option>' +
    sortSubjects(appState.subjects).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

function saveTeacherModal() {
  const first = document.getElementById('tmFirst').value.trim();
  const last = document.getElementById('tmLast').value.trim();
  const abbr = document.getElementById('tmAbbr').value.trim();
  const hoursTotal = parseInt(document.getElementById('tmHoursTotal').value) || 0;
  const hoursExtra = parseInt(document.getElementById('tmHoursExtra').value) || 0;
  if (!first && !last) { notify('Podaj imię lub nazwisko'); return; }
  if (_tmId) {
    const t = appState.teachers.find(t => t.id === _tmId);
    if (t) {
      t.first = first; t.last = last; t.abbr = abbr;
      t.hoursTotal = hoursTotal;
      t.hoursExtra = hoursExtra;
      t.assignments = _tmAssignments;
      t.individualTeaching = _tmIndiv;
    }
  } else {
    appState.teachers.push({
      id: 'tch' + Date.now(),
      first, last, abbr,
      hoursTotal,
      hoursExtra,
      assignments: _tmAssignments,
      individualTeaching: _tmIndiv
    });
  }
  persistAll();
  populateSelects();
  renderSettings();
  closeTeacherModal();
  notify(_tmId ? 'Zaktualizowano nauczyciela' : 'Dodano nauczyciela');
}

function tmDeleteTeacher() {
  if (!_tmId) return;
  const t = appState.teachers.find(t => t.id === _tmId);
  if (!confirm(`Usunąć nauczyciela ${t ? t.first + ' ' + t.last : ''}?`)) return;
  appState.teachers = appState.teachers.filter(t => t.id !== _tmId);
  persistAll();
  populateSelects();
  renderSettings();
  closeTeacherModal();
  notify('Nauczyciel usunięty');
}

function closeTeacherModal() {
  document.getElementById('teacherModal').classList.remove('show');
  _tmId = null;
  _tmAssignments = [];
}

document.getElementById('teacherModal').addEventListener('click', function(e) {
  if (e.target === this) closeTeacherModal();
});

// Skróty nauczycieli — obsługa ręcznej edycji i auto-generowania
document.getElementById('tmAbbr').addEventListener('input', function() {
  this._userEdited = !!this.value;
});
document.getElementById('tmFirst').addEventListener('input', tmAutoAbbr);
document.getElementById('tmEmployment').addEventListener('change', function() {
  document.getElementById('tmFractionWrap').style.display = this.value==='other' ? '' : 'none';
});








// ================================================================
//  DUTY MODAL (edycja dyżurów w ustawieniach)
// ================================================================
// Dyżury dzielą się na:
//   type:'break'  — przerwa między lekcjami (auto z godzin, edytowalna)
//   type:'before' — dyżur przed lekcjami (ręcznie dodawany)
//   type:'after'  — dyżur po lekcjach (ręcznie dodawany)
//   type:'custom' — dowolny inny czas

let _dmId = null;

function openAddDutyModal(prefStart, prefEnd, prefLabel) {
  if(!appState) return;
  _dmId = null;
  document.getElementById('dutyModalTitle').textContent = 'Dodaj dyżur';
  document.getElementById('dmStart').value = prefStart || '';
  document.getElementById('dmEnd').value   = prefEnd   || '';
  document.getElementById('dmLabel').value = prefLabel || '';
  document.getElementById('dmDeleteBtn').style.display = 'none';
  dmBuildPlaces({});
  dmUpdateLabel();
  document.getElementById('dutyModal').classList.add('show');
  setTimeout(()=>document.getElementById('dmStart').focus(), 80);
}

function openEditDutyModal(dutyId) {
  if(!appState) return;
  if(!appState.duties) appState.duties = [];
  const d = appState.duties.find(d=>d.id===dutyId);
  if(!d) return;
  _dmId = dutyId;
  document.getElementById('dutyModalTitle').innerHTML = `Edytuj dyżur <span>${escapeHtml(d.label||d.start+'-'+d.end)}</span>`;
  document.getElementById('dmStart').value = d.start || '';
  document.getElementById('dmEnd').value   = d.end   || '';
  document.getElementById('dmLabel').value = d.label || '';
  document.getElementById('dmDeleteBtn').style.display = d.type==='break' ? 'none' : '';
  dmBuildPlaces(d.places||{});
  dmUpdateLabel();
  document.getElementById('dutyModal').classList.add('show');
}

// _dmPlaces = {mon:[{place,teacherId}], tue:[...], ...}
let _dmPlaces = {};

function dmNormalizePlaces(raw) {
  // Migracja: stary string → [{place,teacherIds:[]}], stary teacherId → teacherIds
  const out = {};
  DUTY_DAY_KEYS.forEach(k => {
    const v = raw[k];
    if(!v) { out[k]=[]; }
    else if(typeof v === 'string') { out[k] = v ? [{place:v,teacherIds:[]}] : []; }
    else if(Array.isArray(v)) {
      out[k] = v.map(r => ({
        place: r.place||'',
        teacherIds: r.teacherIds || (r.teacherId ? [r.teacherId] : [])
      }));
    }
    else { out[k]=[]; }
  });
  return out;
}

function dmBuildPlaces(places) {
  _dmPlaces = dmNormalizePlaces(places||{});
  dmRenderPlaces();
}

function dmRenderPlaces() {
  const grid = document.getElementById('dmPlacesGrid');
  if(!grid) return;
  const teacherOpts = () => '<option value="">— wybierz —</option>' +
    sortTeachers(appState.teachers).map(t=>`<option value="${t.id}">${escapeHtml(t.last)} ${escapeHtml(t.first)} (${escapeHtml(t.abbr)})</option>`).join('');

  grid.innerHTML = DUTY_DAYS.map((day, di) => {
    const key  = DUTY_DAY_KEYS[di];
    const rows = _dmPlaces[key] || [];
    const rowsHtml = rows.map((r,ri) => {
      const tchList = (r.teacherIds||[]).map((tid,ti) => `
        <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
          <select class="mselect" style="flex:1;padding:4px 6px;font-size:.73rem"
            onchange="dmTeacherSet('${key}',${ri},${ti},this.value)">
            ${teacherOpts()}
          </select>
          <button onclick="dmTeacherRemove('${key}',${ri},${ti})"
            style="padding:2px 6px;border:none;background:none;color:var(--red);cursor:pointer;font-size:.9rem;flex-shrink:0">×</button>
        </div>`).join('');
      return `
        <div class="duty-slot-row" style="flex-direction:column;align-items:stretch;gap:4px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="duty-slot-num">${ri+1}</span>
            <input class="minput" style="flex:1;padding:5px 8px;font-size:.78rem" type="text"
              placeholder="Miejsce (np. Korytarz A)"
              value="${escapeHtml(r.place||'')}"
              oninput="dmPlaceSet('${key}',${ri},'place',this.value)">
            <button onclick="dmPlaceRemove('${key}',${ri})"
              style="padding:4px 8px;border:none;background:none;color:var(--red);cursor:pointer;font-size:1rem;flex-shrink:0">×</button>
          </div>
          <div style="padding-left:24px">
            ${tchList}
            <button onclick="dmTeacherAdd('${key}',${ri})"
              style="font-size:.68rem;color:var(--accent);background:none;border:1px dashed var(--accent);
                     border-radius:5px;padding:2px 7px;cursor:pointer;margin-top:3px">
              + nauczyciel
            </button>
          </div>
        </div>`;
    }).join('');
    return `<div class="duty-day-block">
      <div class="duty-day-block-title">${day}</div>
      ${rowsHtml}
      <button onclick="dmPlaceAdd('${key}')"
        style="font-size:.72rem;color:var(--accent);background:none;border:1px dashed var(--accent);
               border-radius:6px;padding:4px 10px;cursor:pointer;align-self:flex-start;margin-top:2px">
        + dodaj miejsce
      </button>
    </div>`;
  }).join('');

  // Ustaw wartości selectów nauczycieli
  const allSlotRows = grid.querySelectorAll('.duty-slot-row');
  let slotIdx = 0;
  DUTY_DAY_KEYS.forEach(key => {
    (_dmPlaces[key]||[]).forEach(r => {
      const slotRow = allSlotRows[slotIdx];
      if(slotRow) {
        const sels = slotRow.querySelectorAll('select');
        (r.teacherIds||[]).forEach((tid,ti) => { if(sels[ti]) sels[ti].value = tid; });
      }
      slotIdx++;
    });
  });
}

function dmAddToAllDays() {
  // Pyta o nazwę miejsca i dodaje do wszystkich dni
  const place = prompt('Nazwa miejsca dyżuru (np. Korytarz A):','');
  if(place === null) return; // anulowano
  DUTY_DAY_KEYS.forEach(key => {
    if(!_dmPlaces[key]) _dmPlaces[key] = [];
    _dmPlaces[key].push({place: place.trim(), teacherIds: []});
  });
  dmRenderPlaces();
  notify('Dodano miejsce do wszystkich dni');
}

function dmCopyFromFirst() {
  const src = _dmPlaces['mon'] || [];
  if(!src.length) { notify('Brak miejsc w Poniedziałek — najpierw dodaj miejsca tam', 'warn'); return; }
  DUTY_DAY_KEYS.forEach((key, i) => {
    if(i === 0) return; // pomiń poniedziałek
    _dmPlaces[key] = src.map(r => ({place: r.place, teacherIds: [...(r.teacherIds||[])]}));
  });
  dmRenderPlaces();
  notify('Skopiowano miejsca z Poniedziałku do pozostałych dni');
}

function dmCopyToAllDuties() {
  if(!appState.duties || appState.duties.length <= 1) {
    notify('Brak innych dyżurów do skopiowania', 'warn'); return;
  }
  // Zbierz miejsca z aktualnego stanu _dmPlaces (bieżący modal)
  const srcPlaces = {};
  DUTY_DAY_KEYS.forEach(k => {
    srcPlaces[k] = (_dmPlaces[k]||[]).filter(r => r.place||(r.teacherIds||[]).length)
                                      .map(r => ({place: r.place, teacherIds: [...(r.teacherIds||[])]}));
  });
  const hasAny = DUTY_DAY_KEYS.some(k => srcPlaces[k].length > 0);
  if(!hasAny) { notify('Brak miejsc do skopiowania — najpierw dodaj miejsca', 'warn'); return; }

  const others = appState.duties.filter(d => d.id !== _dmId);
  const withTeacher = confirm(
    `Skopiować miejsca do ${others.length} pozostałych dyżurów?

OK = kopiuj razem z nauczycielami
Anuluj = kopiuj tylko miejsca (bez nauczycieli)`
  );
  if(withTeacher === null) return;

  others.forEach(d => {
    if(!d.places) d.places = {};
    DUTY_DAY_KEYS.forEach(k => {
      d.places[k] = srcPlaces[k].map(r => ({
        place: r.place,
        teacherIds: withTeacher ? [...(r.teacherIds||[])] : []
      }));
    });
  });

  persistAll();
  notify(`Skopiowano miejsca do ${others.length} dyżurów`);
}

function dmPlaceAdd(dayKey) {
  if(!_dmPlaces[dayKey]) _dmPlaces[dayKey]=[];
  _dmPlaces[dayKey].push({place:'',teacherIds:[]});
  dmRenderPlaces();
}

function dmTeacherAdd(dayKey, ri) {
  if(!_dmPlaces[dayKey]?.[ri]) return;
  if(!_dmPlaces[dayKey][ri].teacherIds) _dmPlaces[dayKey][ri].teacherIds=[];
  _dmPlaces[dayKey][ri].teacherIds.push('');
  dmRenderPlaces();
}

function dmTeacherRemove(dayKey, ri, ti) {
  _dmPlaces[dayKey]?.[ri]?.teacherIds?.splice(ti,1);
  dmRenderPlaces();
}

function dmTeacherSet(dayKey, ri, ti, val) {
  if(_dmPlaces[dayKey]?.[ri]?.teacherIds) _dmPlaces[dayKey][ri].teacherIds[ti]=val;
}

function dmPlaceRemove(dayKey, ri) {
  if(_dmPlaces[dayKey]) _dmPlaces[dayKey].splice(ri,1);
  dmRenderPlaces();
}

function dmPlaceSet(dayKey, ri, field, val) {
  if(!_dmPlaces[dayKey]?.[ri]) return;
  if(field === 'place') _dmPlaces[dayKey][ri].place = val;
}

function dmUpdateLabel() {
  const s = document.getElementById('dmStart').value;
  const e = document.getElementById('dmEnd').value;
  const info = document.getElementById('dmTimeInfo');
  if(s && e) {
    const dur = timeToMins(e) - timeToMins(s);
    if(dur > 0) {
      info.style.display = '';
      info.textContent = `Czas trwania: ${dur} min`;
    } else {
      info.style.display = '';
      info.textContent = '⚠ Koniec musi być późniejszy niż początek';
      info.style.color = 'var(--red)';
    }
  } else {
    info.style.display = 'none';
  }
}

function saveDutyModal() {
  const start = document.getElementById('dmStart').value;
  const end   = document.getElementById('dmEnd').value;
  const label = document.getElementById('dmLabel').value.trim();
  if(!start||!end){ notify('Podaj godziny dyżuru'); return; }
  if(timeToMins(end) <= timeToMins(start)){ notify('Koniec musi być późniejszy niż początek'); return; }

  // Zbierz miejsca z _dmPlaces (nowy format tablicowy)
  const places = {};
  DUTY_DAY_KEYS.forEach(k => {
    places[k] = (_dmPlaces[k]||[])
      .filter(r => r.place || (r.teacherIds||[]).length)
      .map(r => ({place:r.place, teacherIds:(r.teacherIds||[]).filter(Boolean)}));
  });

  if(!appState.duties) appState.duties = [];

  if(_dmId) {
    const d = appState.duties.find(d=>d.id===_dmId);
    if(d) { d.start=start; d.end=end; d.label=label; d.places=places;
            d.durMins=timeToMins(end)-timeToMins(start); }
  } else {
    appState.duties.push({
      id: 'duty_custom_' + Date.now(),
      type: 'custom',
      start, end, label,
      durMins: timeToMins(end) - timeToMins(start),
      places
    });
  }

  // Sortuj dyżury po czasie
  appState.duties.sort((a,b) => timeToMins(a.start) - timeToMins(b.start));
  persistAll();
  renderSettings();
  if(document.getElementById('view-duty')?.classList.contains('active')) renderDuties();
  closeDutyModal();
  notify(_dmId ? 'Zaktualizowano dyżur' : 'Dodano dyżur');
}

function dmDelete() {
  if(!_dmId) return;
  const d = appState.duties.find(d=>d.id===_dmId);
  // Nie pozwól usunąć auto-generowanych przerw między lekcjami
  if(d?.type==='break'){notify('Przerwy między lekcjami są generowane automatycznie');return;}
  if(!confirm('Usunąć ten dyżur?')) return;
  appState.duties = appState.duties.filter(d=>d.id!==_dmId);
  persistAll(); renderSettings();
  if(document.getElementById('view-duty')?.classList.contains('active')) renderDuties();
  closeDutyModal();
  notify('Dyżur usunięty');
}

function closeDutyModal() {
  document.getElementById('dutyModal').classList.remove('show');
  _dmId = null;
}
document.getElementById('dutyModal').addEventListener('click', function(e){
  if(e.target===this) closeDutyModal();
});

// ================================================================
//  BUILDING MODAL
// ================================================================
const BLD_COLORS = [
  '#38bdf8','#34d399','#fbbf24','#f87171',
  '#a78bfa','#2dd4bf','#fb923c','#f472b6',
  '#818cf8','#4ade80','#e879f9','#67e8f9'
];
let _bmId     = null;
let _bmColor  = BLD_COLORS[0];
let _bmFloors = []; // [{id, label, segments:[{id,label}]}]

// ── Zakładki ──
function bmTab(name, btn) {
  document.querySelectorAll('.bm-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.bm-tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('bmPanel-'+name).classList.add('active');
}

// ── Otwieranie ──
function openAddBuildingModal() {
  if(!appState) return;
  _bmId    = null;
  _bmColor = BLD_COLORS[(appState.buildings||[]).length % BLD_COLORS.length];
  _bmFloors = [];
  document.getElementById('buildingModalTitle').textContent = 'Dodaj budynek / lokalizację';
  document.getElementById('bmName').value    = '';
  document.getElementById('bmAddress').value = '';
  document.getElementById('bmNote').value    = '';
  document.getElementById('bmDeleteBtn').style.display = 'none';
  bmTab('basic', document.querySelector('.bm-tab'));
  bmBuildColors();
  bmRenderStruct();
  bmBuildRooms(null);
  document.getElementById('buildingModal').classList.add('show');
  setTimeout(()=>document.getElementById('bmName').focus(), 80);
}

function openEditBuildingModal(id) {
  if(!appState) return;
  const b = (appState.buildings||[]).find(b=>b.id===id);
  if(!b) return;
  _bmId    = id;
  _bmColor = b.color || BLD_COLORS[0];
  _bmFloors = JSON.parse(JSON.stringify(b.floors||[]));
  document.getElementById('buildingModalTitle').innerHTML = `Edytuj <span>${escapeHtml(b.name)}</span>`;
  document.getElementById('bmName').value    = b.name    || '';
  document.getElementById('bmAddress').value = b.address || '';
  document.getElementById('bmNote').value    = b.note    || '';
  document.getElementById('bmDeleteBtn').style.display = '';
  bmTab('basic', document.querySelector('.bm-tab'));
  bmBuildColors();
  bmRenderStruct();
  bmBuildRooms(id);
  document.getElementById('buildingModal').classList.add('show');
}

// ── Kolory ──
function bmBuildColors() {
  document.getElementById('bmColorRow').innerHTML = BLD_COLORS.map(c =>
    `<div class="bld-color-sw ${c===_bmColor?'sel':''}" style="background:${c}"
      onclick="bmPickColor('${c}')"></div>`
  ).join('');
}
function bmPickColor(c) { _bmColor=c; bmBuildColors(); }

// ── Struktura: piętra i segmenty ──
function bmAddFloor() {
  const inp = document.getElementById('bmNewFloorLabel');
  const label = inp.value.trim();
  if(!label){ notify('Podaj nazwę piętra'); return; }
  _bmFloors.push({ id:'fl_'+Date.now(), label, segments:[] });
  inp.value = '';
  bmRenderStruct();
}

function bmRemoveFloor(fid) {
  _bmFloors = _bmFloors.filter(f=>f.id!==fid);
  bmRenderStruct();
  bmBuildRooms(_bmId); // odśwież selecty lokalizacji w salach
}

function bmAddSegment(fid) {
  const inp = document.getElementById('bmSegInp_'+fid);
  const label = inp?.value.trim();
  if(!label){ notify('Podaj nazwę segmentu'); return; }
  const fl = _bmFloors.find(f=>f.id===fid);
  if(fl){ fl.segments.push({id:'seg_'+Date.now(), label}); inp.value=''; }
  bmRenderStruct();
  bmBuildRooms(_bmId);
}

function bmRemoveSegment(fid, sid) {
  const fl = _bmFloors.find(f=>f.id===fid);
  if(fl) fl.segments = fl.segments.filter(s=>s.id!==sid);
  bmRenderStruct();
  bmBuildRooms(_bmId);
}

function bmRenderStruct() {
  const list = document.getElementById('bmStructList');
  if(!list) return;
  if(!_bmFloors.length) {
    list.innerHTML = `<div style="font-size:.8rem;color:var(--text-m);padding:8px 0;text-align:center">
      Brak pięter — dodaj pierwsze piętro poniżej.<br>
      <span style="font-size:.72rem">Przykłady: Parter, I piętro, II piętro, Piwnica, Skrzydło A</span>
    </div>`;
    return;
  }
  list.innerHTML = _bmFloors.map(fl => `
    <div class="bld-floor">
      <div class="bld-floor-header">
        <span class="bld-floor-label">🏢 ${fl.label}</span>
        <span style="font-size:.7rem;color:var(--text-d)">${fl.segments.length} segmentów</span>
        <button onclick="bmRemoveFloor('${fl.id}')"
          style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.85rem;padding:2px 6px">✕</button>
      </div>
      <div class="bld-floor-body">
        <div style="display:flex;flex-wrap:wrap;gap:5px;min-height:20px">
          ${fl.segments.map(s=>`
            <div class="bld-seg-chip">
              <span>${s.label}</span>
              <button onclick="bmRemoveSegment('${fl.id}','${s.id}')">×</button>
            </div>`).join('')}
          ${!fl.segments.length ? `<span style="font-size:.72rem;color:var(--text-d);font-style:italic">brak segmentów</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input class="minput" id="bmSegInp_${fl.id}"
            placeholder="Nazwa segmentu (np. Skrzydło A, Sala nr, Pracownie)"
            style="flex:1;padding:5px 8px;font-size:.75rem"
            onkeydown="if(event.key==='Enter')bmAddSegment('${fl.id}')">
          <button class="bld-add-seg" onclick="bmAddSegment('${fl.id}')">+ Segment</button>
        </div>
      </div>
    </div>`).join('');
}

// ── Sale z przypisaniem do piętra/segmentu ──
function bmLocOptions(roomId) {
  // Opcje lokalizacji: piętro + opcjonalnie segment
  if(!_bmFloors.length) return '';
  let opts = '<option value="">— brak lokalizacji —</option>';
  _bmFloors.forEach(fl => {
    opts += `<option value="floor:${fl.id}">📍 ${fl.label}</option>`;
    fl.segments.forEach(s => {
      opts += `<option value="seg:${fl.id}:${s.id}">↳ ${escapeHtml(fl.label)} › ${escapeHtml(s.label)}</option>`;
    });
  });
  return opts;
}

function bmLocLabel(locStr) {
  if(!locStr) return '';
  const parts = locStr.split(':');
  if(parts[0]==='floor') {
    const fl = _bmFloors.find(f=>f.id===parts[1]);
    return fl ? fl.label : '';
  }
  if(parts[0]==='seg') {
    const fl = _bmFloors.find(f=>f.id===parts[1]);
    const seg = fl?.segments.find(s=>s.id===parts[2]);
    return (fl&&seg) ? `${fl.label} › ${seg.label}` : '';
  }
  return '';
}

function bmBuildRooms(bldId) {
  const container = document.getElementById('bmRoomsList');
  if(!container) return;
  if(!(appState.rooms||[]).length) {
    container.innerHTML = '<span style="font-size:.78rem;color:var(--text-m)">Brak sal w systemie — dodaj sale w ustawieniach.</span>';
    return;
  }
  const hasStruct = _bmFloors.length > 0;
  container.innerHTML = sortByName(appState.rooms).map(r => {
    const rt       = ROOM_TYPES[r.type] || ROOM_TYPES.full;
    const checked  = r.buildingId === bldId && bldId !== null;
    const otherBld = (!checked && r.buildingId)
      ? (appState.buildings||[]).find(b=>b.id===r.buildingId) : null;
    const locStr   = checked ? (r.locationStr||'') : '';
    const locLbl   = locStr ? bmLocLabel(locStr) : '';

    return `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:4px">
      <label class="bld-room-check ${checked?'checked':''} ${locLbl?'with-loc':''}">
        <input type="checkbox" value="${r.id}" ${checked?'checked':''}
          onchange="this.closest('.bld-room-check').classList.toggle('checked',this.checked);bmRefreshLocSelect('${r.id}',this.checked)">
        <span class="bld-room-icon">${rt.icon}</span>
        <span class="bld-room-name">${r.name}</span>
        <span class="bld-room-type">${rt.label}${r.capacity?' · '+r.capacity+' os.':''}</span>
        ${otherBld ? `<span style="font-size:.68rem;color:var(--text-d)">(${otherBld.name})</span>` : ''}
        ${locLbl ? `<span class="bld-room-loc">${locLbl}</span>` : ''}
      </label>
      ${hasStruct && checked ? `
        <div id="bmLocRow_${r.id}" style="padding-left:32px">
          <select class="mselect" style="font-size:.74rem;padding:4px 8px"
            id="bmLocSel_${r.id}"
            onchange="bmRoomLocChange('${r.id}',this.value)">
            ${bmLocOptions(r.id)}
          </select>
        </div>` : `<div id="bmLocRow_${r.id}" style="display:none"></div>`}
    </div>`;
  }).join('');

  // Ustaw wartości selectów lokalizacji
  sortByName(appState.rooms).filter(r=>r.buildingId===bldId).forEach(r => {
    const sel = document.getElementById('bmLocSel_'+r.id);
    if(sel) sel.value = r.locationStr||'';
  });
}

function bmRefreshLocSelect(roomId, checked) {
  const row = document.getElementById('bmLocRow_'+roomId);
  if(!row) return;
  if(checked && _bmFloors.length) {
    row.style.display = '';
    if(!row.querySelector('select')) {
      row.innerHTML = `<select class="mselect" style="font-size:.74px;padding:4px 8px"
        id="bmLocSel_${roomId}" onchange="bmRoomLocChange('${roomId}',this.value)">
        ${bmLocOptions(roomId)}
      </select>`;
    }
  } else {
    row.style.display = 'none';
  }
}

function bmRoomLocChange(roomId, locStr) {
  // Zapisujemy tymczasowo do _bmRoomLocs żeby save mógł to odczytać
  if(!window._bmRoomLocs) window._bmRoomLocs = {};
  window._bmRoomLocs[roomId] = locStr;
}

// ── Zapis ──
function saveBuildingModal() {
  const name    = document.getElementById('bmName').value.trim();
  if(!name){ notify('Podaj nazwę budynku'); return; }
  const address = document.getElementById('bmAddress').value.trim();
  const note    = document.getElementById('bmNote').value.trim();

  const checkedRoomIds = [...document.querySelectorAll('#bmRoomsList input:checked')].map(i=>i.value);
  const uncheckedRoomIds = [...document.querySelectorAll('#bmRoomsList input:not(:checked)')].map(i=>i.value);

  let bldId;
  if(_bmId) {
    const b = appState.buildings.find(b=>b.id===_bmId);
    if(b){ b.name=name; b.address=address; b.note=note; b.color=_bmColor; b.floors=_bmFloors; }
    bldId = _bmId;
  } else {
    bldId = 'bld' + Date.now();
    if(!appState.buildings) appState.buildings = [];
    appState.buildings.push({ id:bldId, name, address, note, color:_bmColor, floors:_bmFloors });
  }

  // Lokalizacje z selectów
  const roomLocs = window._bmRoomLocs || {};
  // Też odczytaj aktualne wartości selectów z DOM
  document.querySelectorAll('[id^="bmLocSel_"]').forEach(sel => {
    const rid = sel.id.replace('bmLocSel_','');
    roomLocs[rid] = sel.value;
  });

  appState.rooms.forEach(r => {
    if(checkedRoomIds.includes(r.id)) {
      r.buildingId  = bldId;
      r.locationStr = roomLocs[r.id] || r.locationStr || '';
    }
    if(uncheckedRoomIds.includes(r.id) && r.buildingId===bldId) {
      r.buildingId  = null;
      r.locationStr = '';
    }
  });

  window._bmRoomLocs = {};
  persistAll(); populateSelects(); renderSettings(); closeBuildingModal();
  notify(_bmId ? 'Zaktualizowano: '+name : 'Dodano: '+name);
}

// ── Usuń ──
function bmDelete() {
  if(!_bmId) return;
  const b = (appState.buildings||[]).find(b=>b.id===_bmId);
  if(!confirm(`Usunąć budynek "${b?b.name:''}"? Sale pozostaną, ale stracą przypisanie do budynku.`)) return;
  appState.buildings = appState.buildings.filter(b=>b.id!==_bmId);
  appState.rooms.forEach(r=>{ if(r.buildingId===_bmId){ r.buildingId=null; r.locationStr=''; } });
  persistAll(); populateSelects(); renderSettings(); closeBuildingModal();
  notify('Budynek usunięty');
}

function closeBuildingModal() {
  document.getElementById('buildingModal').classList.remove('show');
  _bmId = null; _bmFloors = [];
  window._bmRoomLocs = {};
}
document.getElementById('buildingModal').addEventListener('click', function(e){
  if(e.target===this) closeBuildingModal();
});

// ================================================================
//  HOUR MODAL
// ================================================================
let _hmNum = null; // null = nowa, liczba = edycja

function openAddHourModal() {
  if(!appState) return;
  _hmNum = null;
  const last = appState.hours.length
    ? appState.hours[appState.hours.length - 1] : null;
  document.getElementById('hourModalTitle').textContent = 'Dodaj godzinę lekcyjną';
  // Zaproponuj następny nr i czas
  const nextNum = last ? last.num + 1 : 1;
  document.getElementById('hmNum').value   = nextNum;
  document.getElementById('hmDuration').value = '45';
  document.getElementById('hmDeleteBtn').style.display = 'none';
  if(last) {
    // start = koniec poprzedniej + 10 min przerwy
    const [eh,em] = last.end.split(':').map(Number);
    const sm = eh*60 + em + 10;
    const startStr = minsToTime(sm);
    document.getElementById('hmStart').value = startStr;
    document.getElementById('hmEnd').value   = minsToTime(sm + 45);
  } else {
    document.getElementById('hmStart').value = '08:00';
    document.getElementById('hmEnd').value   = '08:45';
  }
  document.getElementById('hourModal').classList.add('show');
  setTimeout(()=>document.getElementById('hmStart').focus(), 80);
}

function openEditHourModal(num) {
  if(!appState) return;
  const h = appState.hours.find(h=>h.num===num);
  if(!h) return;
  _hmNum = num;
  document.getElementById('hourModalTitle').innerHTML = `Edytuj <span>godz. ${num}</span>`;
  document.getElementById('hmNum').value      = h.num;
  document.getElementById('hmStart').value    = h.start;
  document.getElementById('hmEnd').value      = h.end;
  const [sh,sm2] = h.start.split(':').map(Number);
  const [eh,em]  = h.end.split(':').map(Number);
  document.getElementById('hmDuration').value = eh*60+em - (sh*60+sm2);
  document.getElementById('hmDeleteBtn').style.display = '';
  document.getElementById('hourModal').classList.add('show');
}

function minsToTime(m) {
  m = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}
function timeToMins(t) {
  const [h,m] = (t||'0:0').split(':').map(Number); return h*60+m;
}
function hmAutoEnd() {
  const dur = parseInt(document.getElementById('hmDuration').value)||45;
  const start = document.getElementById('hmStart').value;
  if(start) document.getElementById('hmEnd').value = minsToTime(timeToMins(start) + dur);
}
function hmCalcEnd() {
  hmAutoEnd();
}

function saveHourModal() {
  const num   = parseInt(document.getElementById('hmNum').value);
  const start = document.getElementById('hmStart').value;
  const end   = document.getElementById('hmEnd').value;
  if(num===null||num===undefined||isNaN(num)||!start||!end){ notify('Uzupełnij wszystkie pola'); return; }
  if(timeToMins(end) <= timeToMins(start)){ notify('Koniec musi być późniejszy niż początek'); return; }

  if(_hmNum !== null) {
    // Edycja — usuń stary rekord, dodaj nowy (mógł zmienić numer)
    appState.hours = appState.hours.filter(h=>h.num!==_hmNum);
  }
  // Nadpisz jeśli nr już istnieje
  appState.hours = appState.hours.filter(h=>h.num!==num);
  appState.hours.push({num, start, end});
  appState.hours.sort((a,b)=>a.num-b.num);
  // Odśwież dyżury (generuj automatycznie z nowych przerw)
  regenerateDuties();
  persistAll(); populateSelects(); renderSettings();
  closeHourModal();
  notify(_hmNum !== null ? 'Zaktualizowano godz. '+num : 'Dodano godz. '+num);
}

function hmDelete() {
  if(_hmNum === null) return;
  if(!confirm(`Usunąć godzinę lekcyjną nr ${_hmNum}?`)) return;
  appState.hours = appState.hours.filter(h=>h.num!==_hmNum);
  regenerateDuties();
  persistAll(); populateSelects(); renderCurrentView(); renderSettings();
  closeHourModal();
  notify('Godzina usunięta');
}

function closeHourModal() {
  document.getElementById('hourModal').classList.remove('show');
  _hmNum = null;
}
document.getElementById('hourModal').addEventListener('click', function(e){
  if(e.target===this) closeHourModal();
});

// ================================================================
//  DUTIES (DYŻURY)
// ================================================================
// Dyżury są generowane automatycznie z przerw między godzinami lekcyjnymi.
// Struktura: appState.duties = [{id, breakAfterHour, start, end, places:{mon:[],tue:[],...}}]
// places[dayKey] = string z nazwą miejsca (lub '')

const DUTY_DAYS = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
const DUTY_DAY_KEYS = ['mon','tue','wed','thu','fri'];

function regenerateDuties() {
  if(!appState) return;
  const hours = [...appState.hours].sort((a,b)=>a.num-b.num);
  if(!appState.duties) appState.duties = [];

  // Zachowaj istniejące miejsca
  const existingPlaces = {};
  appState.duties.forEach(d => { existingPlaces[d.breakAfterHour] = d.places||{}; });

  // Zachowaj dyżury niestandardowe (before/after/custom)
  const customDuties = appState.duties.filter(d => d.type && d.type !== 'break');
  appState.duties = [];
  for(let i=0; i<hours.length-1; i++) {
    const cur  = hours[i];
    const next = hours[i+1];
    const breakStart = cur.end;
    const breakEnd   = next.start;
    const durMins    = timeToMins(breakEnd) - timeToMins(breakStart);
    if(durMins <= 0) continue; // brak przerwy
    appState.duties.push({
      id: 'duty_' + cur.num,
      type: 'break',
      breakAfterHour: cur.num,
      label: 'Przerwa po lekcji ' + cur.num,
      start: breakStart,
      end:   breakEnd,
      durMins,
      places: existingPlaces[cur.num] || {}
    });
  }
  // Przywróć dyżury niestandardowe i posortuj
  appState.duties = [...appState.duties, ...customDuties]
    .sort((a,b) => timeToMins(a.start) - timeToMins(b.start));
}

function renderDuties() {
  const wrap = document.getElementById('dutyContent');
  if(!wrap) return;
  if(!appState) { wrap.innerHTML=''; return; }
  if(!appState.duties || !appState.duties.length) regenerateDuties();
  if(!appState.duties.length) {
    wrap.innerHTML=`<div class="empty-state"><div class="empty-state-icon">☕</div>
      <div class="empty-state-title">Brak przerw między lekcjami</div>
      <div class="empty-state-sub">Dodaj co najmniej dwie godziny lekcyjne.</div></div>`;
    return;
  }

  const dayVal = wrap.dataset.activeDay || 'all';

  // Selektor dnia
  let html = `<div class="view-selector" style="margin-bottom:12px">
    <span class="view-selector-label">Dzień:</span>
    <select class="vs-select" onchange="dutySetDay(this.value)">
      <option value="all" ${dayVal==='all'?'selected':''}>Cały tydzień</option>
      ${DUTY_DAYS.map((d,i)=>`<option value="${i}" ${dayVal==i?'selected':''}>${d}</option>`).join('')}
    </select>
    <button onclick="openAddDutyModal()" class="wbtn wbtn-ghost"
      style="margin-left:auto;padding:6px 14px;font-size:.78rem">+ Dodaj dyżur</button>
  </div>`;

  const duties = appState.duties.slice().sort((a,b)=>timeToMins(a.start)-timeToMins(b.start));
  const days   = dayVal==='all' ? [0,1,2,3,4] : [parseInt(dayVal)];

  // Zbierz wszystkie unikalne miejsca ze wszystkich dyżurów i dni
  const allPlaces = [];
  duties.forEach(d => {
    days.forEach(di => {
      const slots = d.places[DUTY_DAY_KEYS[di]] || [];
      slots.forEach(s => {
        if(s.place && !allPlaces.includes(s.place)) allPlaces.push(s.place);
      });
    });
  });
  // Jeśli brak miejsc — pokaż uproszczony widok
  if(!allPlaces.length) {
    html += `<div class="empty-state" style="margin-top:20px">
      <div class="empty-state-icon">📍</div>
      <div class="empty-state-title">Brak przypisanych miejsc dyżurów</div>
      <div class="empty-state-sub">Edytuj dyżury i dodaj miejsca oraz nauczycieli.</div>
    </div>`;
    wrap.innerHTML = html;
    return;
  }

  // Buduj tabelę: wiersze = dni × dyżury, kolumny = miejsca
  html += `<div class="grid-wrap-outer">
    <table class="sched-grid${dayVal==='all'?' with-day-col':''}"><thead><tr>`;
  if(dayVal==='all') html += `<th class="day-label-hdr"></th>`;
  html += `<th class="hour-header">Godzina</th>`;
  allPlaces.forEach(p => html += `<th class="day-header" style="min-width:110px">${escapeHtml(p)}</th>`);
  html += `</tr></thead><tbody>`;

  days.forEach(di => {
    const dayKey = DUTY_DAY_KEYS[di];
    duties.forEach((d, dIdx) => {
      const slots = d.places[dayKey] || [];
      // Buduj mapę miejsce → nauczyciele
      const placeMap = {};
      slots.forEach(s => {
        if(s.place) placeMap[s.place] = (s.teacherIds||[]);
      });

      html += `<tr>`;
      // Etykieta dnia — tylko przy pierwszym dyżurze każdego dnia
      if(dayVal==='all' && dIdx===0) {
        html += `<td class="day-label-cell" rowspan="${duties.length}">${DUTY_DAYS[di]}</td>`;
      }
      // Komórka godziny
        const label = d.label || (d.start+'–'+d.end);
      html += `<td class="hour-cell">
        <div style="font-size:.72rem;font-family:var(--mono);font-weight:600">${d.start}</div>
        <div style="font-size:.62rem;color:var(--text-d)">${d.end}</div>
        <div style="font-size:.6rem;color:var(--text-d);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52px" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      </td>`;
      // Komórki miejsc
      allPlaces.forEach(p => {
        const tchIds = placeMap[p] || [];
        const tchs = tchIds.map(id=>appState.teachers.find(t=>t.id===id)).filter(Boolean);
        if(tchs.length) {
          html += `<td style="vertical-align:middle;cursor:pointer" onclick="openEditDutyModal('${d.id}')">
            <div style="display:flex;flex-direction:column;gap:2px;padding:4px">
              ${tchs.map(t=>`<span style="font-size:.72rem;background:var(--accent-g);color:var(--accent);
                border-radius:5px;padding:2px 6px;font-weight:600;white-space:nowrap">${escapeHtml(t.abbr)}</span>`).join('')}
            </div>
          </td>`;
        } else if(slots.some(s=>s.place===p)) {
          // Miejsce istnieje ale brak nauczyciela
          html += `<td class="empty-cell" onclick="openEditDutyModal('${d.id}')" style="text-align:center;color:var(--text-d);font-size:.7rem">—</td>`;
        } else {
          // Miejsce nieprzypisane do tego dyżuru/dnia
          html += `<td style="background:var(--s2)"></td>`;
        }
      });
      html += `</tr>`;
    });
  });

  html += `</tbody></table></div>`;

  // Przycisk edytuj każdy dyżur — mały pasek pod tabelą
  html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">`;
  duties.forEach(d => {
    html += `<button onclick="openEditDutyModal('${d.id}')" class="wbtn wbtn-ghost"
      style="font-size:.7rem;padding:4px 10px">
      ✎ ${d.start}–${d.end}${d.label?' · '+escapeHtml(d.label):''}
    </button>`;
  });
  html += `</div>`;

  wrap.innerHTML = html;
}


function dutySetDay(val) {
  const wrap = document.getElementById('dutyContent');
  if(wrap) { wrap.dataset.activeDay = val; renderDuties(); }
}

// ================================================================
//  SUBJECT MODAL
// ================================================================
let _smId    = null;
let _smColor = SUBJ_COLORS[0];

function openAddSubjectModal() {
  if(!appState) return;
  _smId    = null;
  _smColor = SUBJ_COLORS[appState.subjects.length % SUBJ_COLORS.length];
  document.getElementById('subjectModalTitle').textContent = 'Dodaj przedmiot';
  document.getElementById('smName').value  = '';
  document.getElementById('smAbbr').value  = '';
  document.getElementById('smDeleteBtn').style.display = 'none';
  _smDuration = 'year';
  _smClasses  = [];
  smFillClasses([]);
  smSetDuration('year');
  smBuildPalette();
  smUpdatePreview();
  document.getElementById('subjectModal').classList.add('show');
  setTimeout(()=>document.getElementById('smName').focus(), 80);
}

function openEditSubjectModal(id) {
  if(!appState) return;
  const s = appState.subjects.find(s=>s.id===id);
  if(!s) return;
  _smId    = id;
  _smColor = s.color || SUBJ_COLORS[0];
  document.getElementById('subjectModalTitle').innerHTML = `Edytuj <span>${escapeHtml(s.name)}</span>`;
  document.getElementById('smName').value  = s.name || '';
  document.getElementById('smAbbr').value  = s.abbr || '';
  document.getElementById('smDeleteBtn').style.display = '';
  _smDuration = s.duration || 'year';
  _smClasses  = s.classes  || [];
  smFillClasses(_smClasses);
  smSetDuration(_smDuration);
  smBuildPalette();
  smUpdatePreview();
  document.getElementById('subjectModal').classList.add('show');
}

// ── Stan klas i czasu realizacji w modalu przedmiotu ──
let _smDuration = 'year';
let _smClasses  = [];

function smFillClasses(selected) {
  const wrap = document.getElementById('smClassesWrap');
  if(!wrap) return;
  const classes = sortByName(appState.classes||[]);
  if(!classes.length) {
    wrap.innerHTML='<span style="font-size:.72rem;color:var(--text-d)">Brak klas — dodaj klasy w Ustawieniach</span>';
    return;
  }
  wrap.innerHTML = classes.map(c => {
    const on = (selected||[]).includes(c.id);
    return `<div class="gen-pill ${on?'active':''}" style="cursor:pointer"
      onclick="smToggleClass('${c.id}')">${c.name}</div>`;
  }).join('');
}

function smToggleClass(clsId) {
  const i = _smClasses.indexOf(clsId);
  if(i>=0) _smClasses.splice(i,1); else _smClasses.push(clsId);
  smFillClasses(_smClasses);
}

function smSelectAllClasses(all) {
  _smClasses = all ? (appState.classes||[]).map(c=>c.id) : [];
  smFillClasses(_smClasses);
}

function smSetDuration(val) {
  _smDuration = val;
  ['year','sem1','sem2'].forEach(v => {
    const el = document.getElementById('smDur'+v.charAt(0).toUpperCase()+v.slice(1));
    if(el) el.classList.toggle('active', v===val);
  });
}

function smBuildPalette() {
  const pal = document.getElementById('smColorPalette');
  pal.innerHTML = SUBJ_COLORS.map(c =>
    `<div class="cp-swatch ${c===_smColor?'sel':''}" style="background:${c}"
      onclick="smPickColor('${c}')"></div>`
  ).join('');
}

function smPickColor(c) {
  _smColor = c;
  smBuildPalette();
  smUpdatePreview();
}

function smAutoAbbr() {
  const name = document.getElementById('smName').value.trim();
  const abbr = document.getElementById('smAbbr');
  // Auto tylko jeśli pole skrótu jest puste lub nadal pasuje do auto-generowanego
  if(!abbr._userEdited) {
    const words = name.split(/\s+/).filter(Boolean);
    let auto = '';
    if(words.length >= 2) auto = words.map(w=>w[0]).join('').toUpperCase().slice(0,4);
    else auto = name.slice(0,3).toUpperCase();
    abbr.value = auto;
  }
  smUpdatePreview();
}

function smUpdatePreview() {
  const name  = document.getElementById('smName').value.trim() || 'Przedmiot';
  const abbr  = document.getElementById('smAbbr').value.trim() || '?';
  const prev  = document.getElementById('smPreview');
  const isDark = isDarkColor(_smColor);
  prev.style.background = hexToRgba(_smColor, .18);
  prev.style.borderLeft = `4px solid ${_smColor}`;
  prev.style.color      = _smColor;
  document.getElementById('smPreviewAbbr').textContent = abbr;
  document.getElementById('smPreviewName').textContent = name;
}

// Oznacz że użytkownik ręcznie edytował skrót
document.getElementById('smAbbr').addEventListener('input', function() {
  this._userEdited = !!this.value;
  smUpdatePreview();
});

function saveSubjectModal() {
  const name     = document.getElementById('smName').value.trim();
  const abbr     = document.getElementById('smAbbr').value.trim().toUpperCase();
  const duration = _smDuration || 'year';
  const classes  = _smClasses || [];
  if(!name){ notify('Podaj nazwę przedmiotu'); return; }
  if(!abbr){ notify('Podaj skrót'); return; }
  if(_smId) {
    const s = appState.subjects.find(s=>s.id===_smId);
    if(s){ s.name=name; s.abbr=abbr; s.color=_smColor; s.duration=duration; s.classes=classes; }
  } else {
    appState.subjects.push({ id:'subj'+Date.now(), name, abbr, color:_smColor, duration, classes });
  }
  persistAll(); populateSelects(); renderSettings(); closeSubjectModal();
  notify(_smId ? 'Zaktualizowano: '+name : 'Dodano: '+name);
}

function smDelete() {
  if(!_smId) return;
  const s = appState.subjects.find(s=>s.id===_smId);
  if(!confirm(`Usunąć przedmiot "${s?s.name:''}"?`)) return;
  appState.subjects = appState.subjects.filter(s=>s.id!==_smId);
  persistAll(); populateSelects(); renderSettings(); closeSubjectModal();
  notify('Przedmiot usunięty');
}

function closeSubjectModal() {
  document.getElementById('subjectModal').classList.remove('show');
  _smId = null;
}

document.getElementById('subjectModal').addEventListener('click', function(e){
  if(e.target===this) closeSubjectModal();
});

// ================================================================
//  ROOM MODAL
// ================================================================
const ROOM_TYPES = {
  full:    { label:'Cała klasa',       icon:'🏫', cls:'full'  },
  group:   { label:'Grupowa',          icon:'👥', cls:'group' },
  indiv:   { label:'Indywidualna',     icon:'👤', cls:'indiv' },
  special: { label:'Specjalistyczna',  icon:'⚗️', cls:'group' },
};
let _rmId = null;
let _rmType = 'full';

function openAddRoomModal() {
  if(!appState) return;
  _rmId   = null;
  _rmType = 'full';
  document.getElementById('roomModalTitle').textContent = 'Dodaj salę';
  document.getElementById('rmName').value     = '';
  document.getElementById('rmCapacity').value = '';
  document.getElementById('rmNote').value     = '';
  document.getElementById('rmDeleteBtn').style.display = 'none';
  rmFillBuilding(null);
  rmFillCustodian([]);
  rmFillSubjects([]);
  rmSetType('full');
  document.getElementById('roomModal').classList.add('show');
  setTimeout(()=>document.getElementById('rmName').focus(), 80);
}

function openEditRoomModal(id) {
  if(!appState) return;
  const r = appState.rooms.find(r=>r.id===id);
  if(!r) return;
  _rmId   = id;
  _rmType = r.type || 'full';
  document.getElementById('roomModalTitle').innerHTML = `Edytuj salę <span>${escapeHtml(r.name)}</span>`;
  document.getElementById('rmName').value     = r.name     || '';
  document.getElementById('rmCapacity').value = r.capacity || '';
  document.getElementById('rmNote').value     = r.note     || '';
  document.getElementById('rmDeleteBtn').style.display = '';
  rmFillBuilding(r.buildingId || null);
  // Obsługa wsteczna: custodianId (stary) lub custodians (nowy format)
  const custodiansList = r.custodians || (r.custodianId ? [r.custodianId] : []);
  rmFillCustodian(custodiansList);
  rmFillSubjects(r.preferredSubjects || []);
  rmSetType(_rmType);
  document.getElementById('roomModal').classList.add('show');
}

function rmFillBuilding(selectedId) {
  const sel = document.getElementById('rmBuilding');
  if(!sel) return;
  sel.innerHTML = '<option value="">— brak / budynek główny —</option>' +
    (appState.buildings||[]).map(b=>
      `<option value="${b.id}" ${b.id===selectedId?'selected':''}>${escapeHtml(b.name)}</option>`
    ).join('');
}

// _rmCustodians: [{teacherId}]
let _rmCustodians = [];

function rmFillCustodian(custodians) {
  _rmCustodians = (custodians||[]).map(id=>({teacherId:id}));
  rmRenderCustodians();
}

function rmRenderCustodians() {
  const wrap = document.getElementById('rmCustodiansWrap');
  if(!wrap) return;
  const opts = '<option value="">— wybierz —</option>' +
    sortTeachers(appState.teachers||[]).map(t=>
      `<option value="${t.id}">${escapeHtml(t.last)} ${escapeHtml(t.first)} (${escapeHtml(t.abbr)})</option>`
    ).join('');
  wrap.innerHTML = _rmCustodians.map((c,i) => `
    <div style="display:flex;align-items:center;gap:6px">
      <select class="mselect" style="flex:1;padding:5px 8px;font-size:.78rem"
        onchange="_rmCustodians[${i}].teacherId=this.value">
        ${opts}
      </select>
      <button onclick="rmRemoveCustodian(${i})"
        style="padding:4px 8px;border:none;background:none;color:var(--red);cursor:pointer;font-size:1rem;flex-shrink:0">×</button>
    </div>`).join('');
  // Ustaw wartości selectów
  wrap.querySelectorAll('select').forEach((sel,i) => {
    sel.value = _rmCustodians[i]?.teacherId || '';
  });
}

function rmAddCustodian() {
  _rmCustodians.push({teacherId:''});
  rmRenderCustodians();
}

function rmRemoveCustodian(i) {
  _rmCustodians.splice(i,1);
  rmRenderCustodians();
}

function rmFillSubjects(selected) {
  const wrap = document.getElementById('rmSubjectsWrap');
  if(!wrap) return;
  const subjects = sortSubjects(appState.subjects||[]);
  if(!subjects.length) { wrap.innerHTML='<span style="font-size:.72rem;color:var(--text-d)">Brak zdefiniowanych przedmiotów</span>'; return; }
  wrap.innerHTML = subjects.map(s => {
    const checked = (selected||[]).includes(s.id) ? 'checked' : '';
    const color = s.color||'#38bdf8';
    return `<label style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;
                          border:1px solid ${color};background:${checked?color+'22':'transparent'};
                          cursor:pointer;font-size:.72rem;user-select:none;transition:background .15s"
                   onclick="this.style.background=this.querySelector('input').checked?'transparent':'${color}22'">
      <input type="checkbox" value="${s.id}" ${checked} style="accent-color:${color};width:13px;height:13px">
      <span style="color:var(--text)">${s.name}</span>
    </label>`;
  }).join('');
}

function rmSetType(type) {
  _rmType = type;
  document.querySelectorAll('#rmTypeBtns .room-type-btn').forEach(btn=>{
    btn.classList.toggle('sel', btn.dataset.type === type);
  });
}

function saveRoomModal() {
  const name = document.getElementById('rmName').value.trim();
  if(!name){ notify('Podaj nazwę sali'); return; }
  const capacity   = parseInt(document.getElementById('rmCapacity').value)||null;
  const note       = document.getElementById('rmNote').value.trim();
  const buildingId = document.getElementById('rmBuilding').value || null;
  const custodians = _rmCustodians.map(c=>c.teacherId).filter(Boolean);
  const preferredSubjects = Array.from(
    document.querySelectorAll('#rmSubjectsWrap input[type=checkbox]:checked')
  ).map(cb => cb.value);

  if(_rmId) {
    const r = appState.rooms.find(r=>r.id===_rmId);
    if(r){ r.name=name; r.type=_rmType; r.capacity=capacity; r.note=note;
           r.buildingId=buildingId; r.custodians=custodians; r.preferredSubjects=preferredSubjects; }
  } else {
    appState.rooms.push({ id:'room'+Date.now(), name, type:_rmType, capacity, note,
                          buildingId, custodians, preferredSubjects });
  }
  persistAll(); populateSelects(); renderSettings(); closeRoomModal();
  notify(_rmId ? 'Zaktualizowano salę '+name : 'Dodano salę '+name);
}

function rmDelete() {
  if(!_rmId) return;
  const r = appState.rooms.find(r=>r.id===_rmId);
  if(!confirm(`Usunąć salę ${r?r.name:''}?`)) return;
  appState.rooms = appState.rooms.filter(r=>r.id!==_rmId);
  persistAll(); populateSelects(); renderSettings(); closeRoomModal();
  notify('Sala usunięta');
}

function closeRoomModal() {
  document.getElementById('roomModal').classList.remove('show');
  _rmId = null;
}

document.getElementById('roomModal').addEventListener('click', function(e){
  if(e.target===this) closeRoomModal();
});

// ================================================================
//  CLASS MODAL
// ================================================================
let _cmId = null;
let _cmGroups = [];

function openAddClassModal() {
  if(!appState) return;
  _cmId = null;
  _cmGroups = [];
  try {
    document.getElementById('classModalTitle').innerHTML = 'Dodaj <span>klasę</span>';
    document.getElementById('cmName').value = '';
    document.getElementById('cmDeleteBtn').style.display = 'none';
    document.getElementById('cmStudentCount').value = '';
    cmRenderGroups();
    cmFillHomeroom(null);
    cmFillGroupTeachers();
    cmGroupTypeChange();
    cmRenderRooms([]);
    cmRenderTeachers(null);
    _cmOptSubjects = [];
    cmRenderOptSubjects();
  } catch(e) { console.error('classModal init error:', e); }
  document.getElementById('classModal').classList.add('show');
  setTimeout(()=>{ try{document.getElementById('cmName').focus();}catch(_){} }, 80);
}

function openEditClassModal(id) {
  const c = appState.classes.find(c => c.id === id);
  if (!c) return;
  _cmId = id;
  // Migruj stare grupy (string) do nowego formatu (obiekt)
  _cmGroups = (c.groups || []).map(g =>
    typeof g === 'string'
      ? { id:'grp'+Date.now()+Math.random().toString(36).slice(2,5), name:g, type:'group', studentCount:0, teacherId:null, subjects:[] }
      : {...g, subjects: g.subjects||[]}
  );
  document.getElementById('classModalTitle').innerHTML = `Edytuj klasę <span>${escapeHtml(c.name)}</span>`;
  document.getElementById('cmName').value = c.name || '';
  document.getElementById('cmStudentCount').value = c.studentCount || '';
  document.getElementById('cmDeleteBtn').style.display = '';
  cmRenderGroups();
  cmFillHomeroom(c.homeroomTeacherId || null);
  cmFillGroupTeachers();
  cmGroupTypeChange();
  cmRenderRooms(c.homeRooms || []);
  cmRenderTeachers(id);
  _cmOptSubjects = (c.optionalSubjects || []).map(o=>({...o}));
  cmRenderOptSubjects();
  document.getElementById('classModal').classList.add('show');
}

function cmFillHomeroom(selectedId) {
  const sel = document.getElementById('cmHomeroom');
  if(!sel) return;
  sel.innerHTML = '<option value="">— brak —</option>' +
    (appState.teachers||[]).map(t =>
      `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${escapeHtml(t.first)} ${escapeHtml(t.last)} (${escapeHtml(t.abbr)})</option>`
    ).join('');
}

function cmGroupTypeChange() {
  const type = document.getElementById('cmGroupType').value;
  const countWrap = document.getElementById('cmGroupCountWrap');
  const countEl   = document.getElementById('cmGroupCount');
  if(type === 'small') {
    countWrap.style.display = '';
    countEl.max = 5; countEl.min = 2; countEl.value = Math.max(2, parseInt(countEl.value)||2);
  } else if(type === 'indiv') {
    countWrap.style.display = '';
    countEl.max = 1; countEl.min = 1; countEl.value = 1;
  } else {
    countWrap.style.display = 'none';
  }
}

function cmFillGroupTeachers() {
  const sel = document.getElementById('cmGroupTeacher');
  if(!sel) return;
  sel.innerHTML = '<option value="">— brak —</option>' +
    sortTeachers(appState.teachers||[]).map(t =>
      `<option value="${t.id}">${escapeHtml(t.last)} ${escapeHtml(t.first)} (${escapeHtml(t.abbr)})</option>`
    ).join('');
}

function cmRenderGroups() {
  const el = document.getElementById('cmGroupList');
  if(!_cmGroups.length) {
    el.innerHTML = '<span style="font-size:.75rem;color:var(--text-d)">Brak grup — dodaj poniżej</span>';
    return;
  }
  const ICONS  = {group:'👥', small:'👤👤', indiv:'👤'};
  const LABELS = {group:'Podgrupa', small:'Mała grupa', indiv:'NI'};
  const subjects = appState.subjects||[];
  const allClasses = sortClasses(appState.classes||[]).filter(c=>c.id!==_cmId);

  el.innerHTML = _cmGroups.map((g, i) => {
    const tch    = g.teacherId ? (appState.teachers||[]).find(t=>t.id===g.teacherId) : null;
    const icon   = ICONS[g.type||'group'];
    const badge  = LABELS[g.type||'group'];
    const isNI   = g.type === 'indiv';
    const isGrp  = g.type === 'group' || g.type === 'small';

    // NI: przedmioty
    const grpSubjects = (g.subjects||[]).map(sid => subjects.find(s=>s.id===sid)).filter(Boolean);
    const subjChips = grpSubjects.map(s =>
      `<span style="font-size:.6rem;padding:1px 5px;border-radius:8px;
        background:${s.color}22;color:${s.color};border:1px solid ${s.color}44">${s.abbr||s.name}</span>`
    ).join('');
    const modeLabel = isNI && grpSubjects.length > 0
      ? `<span style="font-size:.62rem;color:var(--orange);padding:1px 5px;border-radius:6px;
           background:var(--orange)15">NI tylko: ${subjChips}</span>
         <span style="font-size:.62rem;color:var(--text-d)">· reszta z klasą</span>`
      : isNI ? `<span style="font-size:.62rem;color:var(--text-d)">wszystkie przedmioty NI</span>` : '';

    // Połączenia między klasami (tylko dla grup type=group/small)
    const linked = g.linkedWith||[];
    const linkedChips = linked.map(lw => {
      const cls = allClasses.find(c=>c.id===lw.clsId);
      const grp = (cls?.groups||[]).find(gg=>gg.id===lw.grpId);
      return cls&&grp
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.65rem;
            padding:1px 6px;border-radius:8px;background:var(--accent-g);color:var(--accent);
            border:1px solid var(--accent)33">
            ${escapeHtml(cls.name)} / ${escapeHtml(grp.name)}
            <span onclick="cmUnlinkGroup(${i},'${lw.clsId}','${lw.grpId}')"
              style="cursor:pointer;margin-left:2px;color:var(--red);font-size:.75rem;line-height:1">×</span>
          </span>`
        : '';
    }).filter(Boolean).join('');

    // Dropdown: lista grup z innych klas do połączenia
    const linkOptions = allClasses.flatMap(cls =>
      (cls.groups||[])
        .filter(gg => (gg.type==='group'||gg.type==='small') && !linked.some(lw=>lw.clsId===cls.id&&lw.grpId===gg.id))
        .map(gg => `<option value="${cls.id}|${gg.id}">${escapeHtml(cls.name)} / ${escapeHtml(gg.name)}</option>`)
    );

    const isEdge = !!(g.edgePosition);

    const edgeRow = isGrp ? `
      <div style="display:flex;align-items:center;gap:6px;padding-top:5px;border-top:1px dashed var(--border)">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.7rem;color:var(--text-m)">
          <input type="checkbox" ${isEdge?'checked':''}
            onchange="_cmGroups[${i}].edgePosition=this.checked;cmRenderGroups()"
            style="accent-color:var(--accent);width:14px;height:14px">
          ⇔ Skrajne godziny (pierwsza lub ostatnia lekcja klasy)
        </label>
      </div>` : '';

    const linkRow = isGrp && allClasses.length ? `
      <div style="display:flex;align-items:center;gap:6px;padding-top:5px;border-top:1px dashed var(--border);flex-wrap:wrap">
        <span style="font-size:.67rem;color:var(--text-m);white-space:nowrap">🔗 Połącz z:</span>
        ${linkedChips}
        ${linkOptions.length ? `<select class="mselect" style="font-size:.68rem;padding:2px 6px;min-width:0;flex:1;max-width:200px"
          onchange="cmLinkGroup(${i},this.value);this.value=''">
          <option value="">+ dodaj połączenie…</option>
          ${linkOptions.join('')}
        </select>` : `<span style="font-size:.65rem;color:var(--text-d)">brak innych grup</span>`}
      </div>` : '';

    return `<div style="display:flex;flex-direction:column;gap:5px;padding:8px 10px;
      background:var(--s2);border-radius:8px;
      border:1px solid ${isNI?'var(--accent)33':linked.length?'var(--green)44':'var(--border)'}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:.85rem">${icon}</span>
        <span style="font-weight:600;font-size:.8rem">${escapeHtml(g.name)}</span>
        <span style="font-size:.65rem;padding:1px 6px;border-radius:8px;
          background:${isNI?'var(--accent-g)':linked.length?'rgba(16,185,129,.12)':'var(--s3)'};
          color:${isNI?'var(--accent)':linked.length?'var(--green)':'var(--text-m)'}">
          ${badge}${g.studentCount&&g.studentCount>1?' ('+g.studentCount+' ucz.)':''}
          ${linked.length?` · 🔗 ${linked.length} powiązanie`:''}
        </span>
        ${tch ? `<span style="font-size:.7rem;color:var(--text-m);font-family:var(--mono)">${escapeHtml(tch.abbr)}</span>` : ''}
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
          ${isNI ? `<button onclick="cmEditGroupSubjects(${i})"
            style="font-size:.62rem;padding:1px 7px;border-radius:5px;
                   background:none;border:1px solid var(--border);cursor:pointer;color:var(--text-m)"
            title="Wybierz które przedmioty uczeń realizuje w trybie NI">
            📚 Przedmioty NI
          </button>` : ''}
          <button onclick="_cmGroups.splice(${i},1);cmRenderGroups()"
            style="background:none;border:none;cursor:pointer;color:var(--text-d);font-size:.9rem;padding:0 4px">×</button>
        </div>
      </div>
      ${modeLabel ? `<div style="display:flex;align-items:center;gap:5px;padding-left:28px;flex-wrap:wrap">${modeLabel}</div>` : ''}
      ${edgeRow}
      ${linkRow}
    </div>`;
  }).join('');
}

function cmLinkGroup(grpIdx, val) {
  if(!val) return;
  const [clsId, grpId] = val.split('|');
  if(!clsId||!grpId) return;
  const g = _cmGroups[grpIdx];
  if(!g.linkedWith) g.linkedWith = [];
  if(!g.linkedWith.some(lw=>lw.clsId===clsId&&lw.grpId===grpId))
    g.linkedWith.push({clsId, grpId});
  cmRenderGroups();
}

function cmUnlinkGroup(grpIdx, clsId, grpId) {
  const g = _cmGroups[grpIdx];
  if(!g.linkedWith) return;
  g.linkedWith = g.linkedWith.filter(lw=>!(lw.clsId===clsId&&lw.grpId===grpId));
  cmRenderGroups();
}

// Edytuj które przedmioty uczeń z NI realizuje indywidualnie
function cmEditGroupSubjects(grpIdx) {
  const g = _cmGroups[grpIdx];
  if(!g) return;
  const subjects = sortSubjects(appState.subjects||[]);
  const selected = g.subjects||[];

  // Prosty overlay z checkboxami
  const existing = document.getElementById('cmGrpSubjOverlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cmGrpSubjOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:700;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--s1);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:420px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)';

  box.innerHTML = `
    <div style="font-size:.95rem;font-weight:800;margin-bottom:4px">📚 Przedmioty NI — ${escapeHtml(g.name)}</div>
    <div style="font-size:.72rem;color:var(--text-m);margin-bottom:16px;line-height:1.5">
      Zaznacz <strong>tylko te przedmioty</strong>, które uczeń realizuje w trybie nauczania indywidualnego
      (z osobnym nauczycielem, poza klasą).<br>
      <span style="color:var(--orange)">Niezaznaczone</span> = uczeń uczęszcza na te lekcje razem z klasą.
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <button onclick="document.querySelectorAll('#cmGrpSubjOverlay input').forEach(el=>el.checked=true)"
        style="font-size:.7rem;padding:3px 10px;border-radius:5px;background:none;border:1px solid var(--border);cursor:pointer;color:var(--text-m)">
        Zaznacz wszystkie
      </button>
      <button onclick="document.querySelectorAll('#cmGrpSubjOverlay input').forEach(el=>el.checked=false)"
        style="font-size:.7rem;padding:3px 10px;border-radius:5px;background:none;border:1px solid var(--border);cursor:pointer;color:var(--text-m)">
        Odznacz wszystkie
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px" id="cmGrpSubjList">
      ${subjects.map(s => `
        <label style="display:flex;align-items:center;gap:10px;padding:7px 10px;
          border-radius:7px;background:var(--s2);cursor:pointer;border:1px solid var(--border)">
          <input type="checkbox" value="${s.id}" ${selected.includes(s.id)?'checked':''}
            style="accent-color:${s.color};width:16px;height:16px">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
          <span style="font-size:.8rem;font-weight:600">${s.name}</span>
          <span style="font-size:.7rem;color:var(--text-d);font-family:var(--mono)">${s.abbr||''}</span>
        </label>`).join('')}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('cmGrpSubjOverlay').remove()"
        style="padding:8px 16px;border-radius:var(--radius);border:1px solid var(--border);background:transparent;color:var(--text-m);font-family:var(--font);cursor:pointer">
        Anuluj
      </button>
      <button onclick="cmSaveGroupSubjects(${grpIdx})"
        style="padding:8px 18px;border-radius:var(--radius);border:none;background:var(--accent);color:#fff;font-family:var(--font);font-weight:700;cursor:pointer">
        Zapisz
      </button>
    </div>`;

  overlay.appendChild(box);
  overlay.onclick = (e) => { if(e.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

function cmSaveGroupSubjects(grpIdx) {
  const g = _cmGroups[grpIdx];
  if(!g) return;
  const checked = [...document.querySelectorAll('#cmGrpSubjOverlay input:checked')].map(el=>el.value);
  g.subjects = checked;
  document.getElementById('cmGrpSubjOverlay').remove();
  cmRenderGroups();
  notify(checked.length ? `Zapisano: ${checked.length} przedmiotów NI` : 'Wszystkie przedmioty w trybie NI');
}

function cmAddGroup() {
  const inp   = document.getElementById('cmGroupInput');
  const type  = document.getElementById('cmGroupType').value;
  const count = parseInt(document.getElementById('cmGroupCount').value)||1;
  const tchId = document.getElementById('cmGroupTeacher').value||null;
  const val   = inp.value.trim();
  if (!val) return;

  val.split(',').map(v => v.trim()).filter(Boolean).forEach(name => {
    if (!_cmGroups.some(g => g.name === name)) {
      _cmGroups.push({
        id: 'grp' + Date.now() + Math.random().toString(36).slice(2,5),
        name,
        type,
        studentCount: type==='indiv' ? 1 : (type==='small' ? Math.min(count,5) : 0),
        teacherId: tchId || null,
        subjects: [],  // puste = wszystkie w NI; niepuste = tylko wybrane w NI, reszta z klasą
      });
    }
  });
  inp.value = '';
  cmRenderGroups();
}

function cmRenderRooms(selectedIds) {
  const container = document.getElementById('cmRoomList');
  if(!container) return;
  if (!(appState.rooms||[]).length) {
    container.innerHTML = '<span style="font-size:.75rem;color:var(--text-m)">Brak sal w systemie</span>';
    return;
  }
  // Grupuj wg budynku
  const hasBld = (appState.buildings || []).length > 0;
  let html = '';
  if (hasBld) {
    const groups = [];
    appState.buildings.forEach(b => {
      const bRooms = appState.rooms.filter(r => r.buildingId === b.id);
      if (bRooms.length) groups.push({ label: b.name, color: b.color, rooms: bRooms });
    });
    const noB = appState.rooms.filter(r => !r.buildingId);
    if (noB.length) groups.push({ label: 'Budynek główny', color: '#888', rooms: noB });
    groups.forEach(g => {
      html += `<div style="grid-column:1/-1;font-size:.68rem;font-weight:700;color:var(--text-m);
        letter-spacing:.05em;text-transform:uppercase;margin-top:4px;display:flex;align-items:center;gap:5px">
        <span class="cdot" style="background:${g.color}"></span>${g.label}</div>`;
      g.rooms.forEach(r => {
        const chk = selectedIds.includes(r.id);
        html += `<label class="room-check ${chk ? 'checked' : ''}">
          <input type="checkbox" value="${r.id}" ${chk ? 'checked' : ''}
            onchange="this.parentElement.classList.toggle('checked',this.checked)">
          <span class="room-check-dot"></span>
          ${r.name}
        </label>`;
      });
    });
  } else {
    appState.rooms.forEach(r => {
      const chk = selectedIds.includes(r.id);
      html += `<label class="room-check ${chk ? 'checked' : ''}">
        <input type="checkbox" value="${r.id}" ${chk ? 'checked' : ''}
          onchange="this.parentElement.classList.toggle('checked',this.checked)">
        <span class="room-check-dot"></span>
        ${r.name}
      </label>`;
    });
  }
  container.innerHTML = html;
}

function cmRenderTeachers(clsId) {
  const container = document.getElementById('cmTeacherList');
  if (!clsId) {
    container.innerHTML = '<div class="cls-tch-empty">Zapisz klasę, a następnie przypisz nauczycieli w ich kartach.</div>';
    return;
  }
  const teachers = appState.teachers.filter(t =>
    (t.assignments || []).some(a => a.classId === clsId)
  );
  if (!teachers.length) {
    container.innerHTML = '<div class="cls-tch-empty">Brak przypisanych nauczycieli — dodaj przydziały w kartach nauczycieli.</div>';
    return;
  }
  container.innerHTML = teachers.map(t => {
    const asgn = (t.assignments || []).filter(a => a.classId === clsId);
    const totalH = asgn.reduce((s, a) => s + (a.hours || 0), 0);
    const subjDots = asgn.map(a => {
      const s = appState.subjects.find(s => s.id === a.subjectId);
      return s ? `<span class="cdot" style="background:${s.color}" title="${escapeHtml(s.name)}"></span>` : '';
    }).join('');
    const subjNames = asgn.map(a => {
      const s = appState.subjects.find(s => s.id === a.subjectId);
      return s ? `<span style="color:${s.color};font-size:.72rem">${escapeHtml(s.abbr)} (${a.hours}h)</span>` : '';
    }).join('');
    return `<div class="cls-tch-row" onclick="closeClassModal();setTimeout(()=>openEditTeacherModal('${t.id}'),120)" title="Kliknij aby edytować nauczyciela">
      <div class="cls-tch-abbr">${escapeHtml(t.abbr)}</div>
      <div class="cls-tch-name">${escapeHtml(t.first)} ${escapeHtml(t.last)}</div>
      <div class="cls-tch-subj">${subjDots} ${subjNames}</div>
      <div class="cls-tch-hrs">${totalH} godz.</div>
    </div>`;
  }).join('');
}

function saveClassModal() {
  const name = document.getElementById('cmName').value.trim();
  if (!name) { notify('Podaj nazwę klasy'); return; }
  const studentCount = parseInt(document.getElementById('cmStudentCount').value)||0;
  const homeroomTeacherId = document.getElementById('cmHomeroom').value || null;
  const homeRooms = [...document.querySelectorAll('#cmRoomList input:checked')].map(i => i.value);

  if (_cmId) {
    const c = appState.classes.find(c => c.id === _cmId);
    if (c) {
      c.name = name;
      c.studentCount = studentCount;
      c.groups = _cmGroups;
      c.homeroomTeacherId = homeroomTeacherId;
      c.homeRooms = homeRooms;
      c.optionalSubjects = _cmOptSubjects.filter(o=>o.subjId);
    }
  } else {
    appState.classes.push({
      id: 'cls' + Date.now(),
      name,
      studentCount,
      groups: _cmGroups,
      homeroomTeacherId,
      homeRooms,
      optionalSubjects: _cmOptSubjects.filter(o=>o.subjId)
    });
  }
  persistAll();
  populateSelects();
  renderSettings();
  closeClassModal();
  notify(_cmId ? 'Zaktualizowano klasę ' + name : 'Dodano klasę ' + name);
}

function cmDeleteClass() {
  if (!_cmId) return;
  const c = appState.classes.find(c => c.id === _cmId);
  if (!confirm(`Usunąć klasę ${c ? c.name : ''}? Lekcje tej klasy zostaną usunięte.`)) return;
  appState.classes = appState.classes.filter(c => c.id !== _cmId);
  Object.keys(schedData).filter(k => k.startsWith(_cmId + '_')).forEach(k => delete schedData[k]);
  persistAll();
  populateSelects();
  populateRoomBuildingFilter();
  renderCurrentView();
  renderSettings();
  closeClassModal();
  notify('Klasa usunięta');
}

function closeClassModal() {
  document.getElementById('classModal').classList.remove('show');
  _cmId = null;
  _cmGroups = [];
  _cmOptSubjects = [];
  // Reset pól grupy
  const gtEl = document.getElementById('cmGroupType');
  if(gtEl) gtEl.value = 'group';
  const gwEl = document.getElementById('cmGroupCountWrap');
  if(gwEl) gwEl.style.display = 'none';
}

document.getElementById('classModal').addEventListener('click', function(e) {
  if (e.target === this) closeClassModal();
});

// ── Przedmioty opcjonalne klasy ──
let _cmOptSubjects = []; // [{subjId, count}]

function cmRenderOptSubjects() {
  const wrap = document.getElementById('cmOptSubjList');
  if(!wrap) return;
  const subjects = sortSubjects(appState.subjects||[]);
  if(!subjects.length) {
    wrap.innerHTML='<span style="font-size:.72rem;color:var(--text-d)">Brak przedmiotów — dodaj je w Ustawieniach</span>';
    return;
  }

  if(!_cmOptSubjects.length) {
    wrap.innerHTML='<span style="font-size:.72rem;color:var(--text-d)">Brak — kliknij „+ dodaj" poniżej</span>';
    return;
  }

  // Inne klasy dostępne do łączenia (wszystkie oprócz tej edytowanej)
  const otherClasses = sortByName((appState.classes||[]).filter(c => c.id !== _cmId));

  wrap.innerHTML = _cmOptSubjects.map((o,i) => {
    const subj    = subjects.find(s=>s.id===o.subjId);
    const dot     = subj ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
      background:${subj.color};flex-shrink:0"></span>` : '';
    const pos     = o.position||'any';
    const mergeWith = o.mergeWith||[];

    // Chipy klas do łączenia
    const mergeChips = otherClasses.map(c => {
      const on = mergeWith.includes(c.id);
      // Znajdź ten sam przedmiot opcjonalny w tamtej klasie (info o liczbie uczniów)
      const theirEntry = (c.optionalSubjects||[]).find(x=>x.subjId===o.subjId);
      const theirCount = theirEntry?.count ? ` (${theirEntry.count})` : '';
      return `<div class="gen-pill ${on?'active':''}" style="font-size:.68rem"
        onclick="cmToggleMerge(${i},'${c.id}')">${c.name}${theirCount}</div>`;
    }).join('');

    const mergeTotal = mergeWith.reduce((sum, cid) => {
      const cls = (appState.classes||[]).find(c=>c.id===cid);
      const entry = (cls?.optionalSubjects||[]).find(x=>x.subjId===o.subjId);
      return sum + (entry?.count||0);
    }, o.count||0);

    return `<div style="display:flex;flex-direction:column;gap:7px;padding:10px 12px;
                background:var(--s2);border-radius:8px;border:1px solid var(--border)">
      <!-- Wiersz 1: przedmiot + liczba uczniów -->
      <div style="display:flex;align-items:center;gap:8px">
        ${dot}
        <select class="mselect" style="flex:2;padding:5px 8px;font-size:.76rem"
          onchange="_cmOptSubjects[${i}].subjId=this.value;cmRenderOptSubjects()">
          ${subjects.map(s=>`<option value="${s.id}" ${s.id===o.subjId?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
        <span style="font-size:.72rem;color:var(--text-m);white-space:nowrap">Uczniów:</span>
        <input type="number" min="1" max="999" class="minput"
          style="width:64px;padding:5px 8px;font-size:.78rem;text-align:center"
          value="${o.count||''}" placeholder="np. 2"
          onchange="_cmOptSubjects[${i}].count=parseInt(this.value)||0">
        <button onclick="_cmOptSubjects.splice(${i},1);cmRenderOptSubjects()"
          style="padding:4px 8px;border:none;background:none;color:var(--red);
                 cursor:pointer;font-size:1rem;flex-shrink:0">×</button>
      </div>
      <!-- Wiersz 2: skrajne godziny -->
      <div style="display:flex;align-items:center;gap:8px;padding-left:16px">
        <span style="font-size:.7rem;color:var(--text-m);white-space:nowrap">Pozycja w planie:</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.72rem">
          <input type="checkbox" ${pos==='edge'?'checked':''}
            onchange="_cmOptSubjects[${i}].position=this.checked?'edge':'any';cmRenderOptSubjects()"
            style="accent-color:var(--accent);width:15px;height:15px">
          Skrajne godziny (pierwsza lub ostatnia lekcja klasy)
        </label>
      </div>
      <!-- Wiersz 3: łączenie z innymi klasami -->
      ${otherClasses.length ? `<div style="padding-left:16px;border-top:1px dashed var(--border);padding-top:7px">
        <div style="font-size:.7rem;color:var(--text-m);margin-bottom:5px">
          Łącz z klasami (wspólna lekcja, jeden nauczyciel):
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${mergeChips}
        </div>
        ${mergeWith.length ? `<div style="font-size:.68rem;color:var(--accent);margin-top:5px">
          Razem: ${mergeTotal} uczniów z ${mergeWith.length+1} klas
        </div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');
}

function cmToggleMerge(optIdx, clsId) {
  if(!_cmOptSubjects[optIdx].mergeWith) _cmOptSubjects[optIdx].mergeWith = [];
  const arr = _cmOptSubjects[optIdx].mergeWith;
  const i = arr.indexOf(clsId);
  if(i>=0) arr.splice(i,1); else arr.push(clsId);
  cmRenderOptSubjects();
}

function cmAddOptSubj() {
  // Zaproponuj pierwszy przedmiot który nie jest jeszcze na liście
  const used  = _cmOptSubjects.map(o=>o.subjId);
  const first = (appState.subjects||[]).find(s=>!used.includes(s.id));
  _cmOptSubjects.push({subjId: first?.id||'', count: 0, position: 'any'});
  cmRenderOptSubjects();
}


// ================================================================
//  SYSTEM POMOCY
// ================================================================
const HELP = {
  class: {
    title:'📚 Widok klas',
    sub:'Plan lekcji dla wybranej klasy',
    sections:[
      {t:'Jak korzystać', items:[
        '<strong>Wybierz klasę</strong> z listy rozwijanej, potem dzień (lub cały tydzień)',
        '<strong>Kliknij pustą komórkę</strong> aby dodać lekcję — wybierz przedmiot, nauczyciela i salę',
        '<strong>Przeciągnij lekcję</strong> żeby przenieść ją na inną godzinę lub dzień',
        '<strong>Kliknij lekcję</strong> aby edytować lub usunąć',
      ]},
      {t:'Konflikty', items:[
        'Czerwona ramka = nauczyciel ma jednocześnie dwie lekcje lub sala jest podwójnie zajęta',
        'Pasek konfliktów na górze pokazuje wszystkie konflikty z przyciskiem "Przejdź →"',
      ]},
      {t:'Wskazówka', tip:'Najpierw skonfiguruj nauczycieli (przydziel im klasy i godziny) w Ustawieniach — wtedy dodawanie lekcji będzie znacznie szybsze.'},
    ]
  },
  teacher: {
    title:'👩‍🏫 Widok nauczycieli',
    sub:'Plan lekcji dla wybranego nauczyciela',
    sections:[
      {t:'Jak korzystać', items:[
        'Wybierz nauczyciela z listy — widoczne są wszystkie jego klasy',
        'Szare (przyciemnione) komórki to lekcje innych nauczycieli w tej klasie',
        'Kliknij pustą komórkę żeby dodać lekcję — nauczyciel będzie pre-wybrany',
      ]},
      {t:'Wskazówka', tip:'Widok nauczyciela dobrze pokazuje okienka (wolne godziny między lekcjami). Minimalizuj okienka — nauczyciel nie powinien czekać bez lekcji.'},
    ]
  },
  room: {
    title:'🏫 Widok sal',
    sub:'Obłożenie wybranej sali w ciągu tygodnia',
    sections:[
      {t:'Jak korzystać', items:[
        'Wybierz salę — widzisz które klasy i kiedy z niej korzystają',
        'Kliknij pustą komórkę aby dodać lekcję z pre-wybraną salą',
      ]},
      {t:'Wskazówka', tip:'Ustaw "Preferowane przedmioty" sali w Ustawieniach → Sale — generator będzie przydzielać salę komputerową tylko do informatyki.'},
    ]
  },
  matrix: {
    title:'🔲 Macierz szkoły',
    sub:'Przegląd całego planu szkoły w jednym widoku',
    sections:[
      {t:'Tryby wyświetlania', items:[
        '<strong>Klasy × Godziny</strong> — kolumny to klasy, wiersze to godziny. Idealny do sprawdzenia kolizji sal',
        '<strong>Nauczyciele × Godziny</strong> — kolumny to nauczyciele. Widać kto kiedy ma lekcje i kto ma okienka',
      ]},
      {t:'Wskazówka', tip:'Macierz jest tylko do przeglądania i edycji. Drukuj ją jako "Przegląd szkoły".'},
    ]
  },
  duty: {
    title:'🚨 Dyżury',
    sub:'Zarządzanie dyżurami nauczycieli',
    sections:[
      {t:'Jak działa', items:[
        'Dyżury przerywowe są generowane automatycznie na podstawie godzin lekcyjnych',
        'Kliknij komórkę w tabeli aby przypisać nauczyciela do miejsca dyżuru',
        'Użyj "Kopiuj z poniedziałku" aby powielić układ na cały tydzień',
      ]},
      {t:'Dodawanie dyżurów', items:[
        'W Ustawieniach → Dyżury dodajesz dyżury niestandardowe (przed lekcjami, po lekcjach)',
        'Każdy dyżur ma miejsce (korytarz, brama) i możesz przypisać kilku nauczycieli',
      ]},
    ]
  },
  stats: {
    title:'📊 Statystyki',
    sub:'Podsumowanie planu i obciążenia nauczycieli',
    sections:[
      {t:'Co pokazuje', items:[
        '<strong>Realizacja etatu</strong> — porównuje przydzielone godziny do pensum każdego nauczyciela',
        '<strong>Rozkład przedmiotów</strong> — ile godzin każdego przedmiotu jest w planie',
        'Kolor paska: zielony = OK, żółty = za mało, czerwony = przekroczone pensum',
      ]},
    ]
  },
  generator: {
    title:'⚡ Generator planu',
    sub:'Automatyczne układanie planu z warunkami',
    sections:[
      {t:'Jak działa', items:[
        '<strong>Krok 1:</strong> Skonfiguruj warunki — dostępność nauczycieli, bloki, pozycje przedmiotów',
        '<strong>Krok 2:</strong> Kliknij "Generuj plan" — solver działa w tle (Web Worker)',
        '<strong>Krok 3:</strong> Sprawdź raport — ile lekcji ułożono, co nie pasuje',
        '<strong>Krok 4:</strong> Zastosuj lub wróć do warunków i generuj ponownie',
      ]},
      {t:'Warunki', items:[
        '<strong>Dostępność nauczycieli</strong> — zablokuj godziny gdy nauczyciel nie może mieć lekcji',
        '<strong>Bloki</strong> — ustaw czy przedmiot może mieć podwójne lekcje (2h z rzędu)',
        '<strong>Pozycja</strong> — WF na końcu dnia, religia na początku lub końcu',
        '<strong>Grupy</strong> — podział klasy na grupy (np. języki obce)',
      ]},
      {t:'Wskazówka', tip:'Zanim użyjesz generatora: upewnij się że nauczyciele mają przypisane klasy i godziny w Ustawieniach → Nauczyciele. Bez przydziałów generator nie ma co układać.'},
    ]
  },
  settings: {
    title:'⚙️ Ustawienia',
    sub:'Konfiguracja szkoły, nauczycieli, sal i godzin',
    sections:[
      {t:'Kolejność konfiguracji', items:[
        '1. <strong>Klasy</strong> — dodaj klasy, grupy, liczbę uczniów',
        '2. <strong>Przedmioty</strong> — nadaj kolory, skróty, przypisz do klas',
        '3. <strong>Nauczyciele</strong> — dodaj pensum, przydziel klasy i godziny',
        '4. <strong>Sale</strong> — pojemność, typ, preferowane przedmioty',
        '5. <strong>Godziny lekcyjne</strong> — harmonogram godzin',
        '6. <strong>Dyżury</strong> — przypisz nauczycieli do miejsc dyżurów',
      ]},
      {t:'Wskazówka', tip:'Wypełnij "Przydział godzin" w karcie każdego nauczyciela — to jest podstawa dla generatora. Bez przydziałów generator nie wie ile lekcji dać nauczycielowi.'},
    ]
  },
};

// Pomoc w kreatorze
const WIZ_HELP = [
  {t:'Szkoła', items:['Podaj nazwę i rok szkolny — pojawią się w nagłówku wydruku','Rok szkolny ustaw też w Ustawieniach → Szkoła po zakończeniu kreatora']},
  {t:'Budynki', items:['Budynki są opcjonalne — pomiń jeśli szkoła jest w jednym budynku','Dodaj budynki jeśli chcesz przypisywać sale do konkretnych lokalizacji']},
  {t:'Klasy', items:['Wpisz nazwy klas jak: 1a, 1b, 2a... lub importuj listą: 1a;1b;2a;2b','Grupy dodaj teraz lub później w Ustawieniach → Klasy','Liczbę uczniów i wychowawcę ustaw w Ustawieniach po zakończeniu']},
  {t:'Przedmioty', items:['Każdy przedmiot dostaje unikalny kolor — ułatwia czytanie planu','Skrót (np. MAT, POL) pojawia się w komórkach planu','Religia, etyka i inne opcjonalne dodaj tutaj — szczegóły (które klasy) ustaw później']},
  {t:'Nauczyciele', items:['Format importu masowego: Imię;Nazwisko;Skrót;Pensum;Nadgodziny','Skrót generuje się automatycznie (np. AKow dla Anna Kowalska)','Przydział godzin (kto uczy co w której klasie) ustaw po zakończeniu kreatora w kartach nauczycieli']},
  {t:'Sale', items:['Możesz dodać sale teraz i uzupełnić szczegóły (pojemność, typ) później w Ustawieniach','Sale specjalistyczne (komputerowa, gimnastyczna) oznacz odpowiednim typem']},
  {t:'Godziny', items:['Użyj "Generuj godziny" wpisując godzinę startu, czas lekcji i przerwy','Typowo: lekcja 45 min, przerwa 10 min, 8 lekcji od 8:00']},
];

function openHelp(view) {
  const v = view || _currentView || 'class';
  const data = HELP[v];
  if(!data) return;
  document.getElementById('helpTitle').textContent = data.title;
  document.getElementById('helpSub').textContent = data.sub||'';
  let html = '';
  (data.sections||[]).forEach(sec => {
    html += `<div class="help-section">`;
    if(sec.t) html += `<div class="help-section-title">${sec.t}</div>`;
    if(sec.items) sec.items.forEach(item => {
      html += `<div class="help-item">${item}</div>`;
    });
    if(sec.tip) html += `<div class="help-tip">💡 ${sec.tip}</div>`;
    html += `</div>`;
  });
  document.getElementById('helpContent').innerHTML = html;
  document.getElementById('helpOverlay').classList.add('show');
}

function closeHelp() {
  document.getElementById('helpOverlay').classList.remove('show');
}

function openWizHelp(step) {
  const data = WIZ_HELP[step];
  if(!data) return;
  document.getElementById('helpTitle').textContent = '❓ Pomoc — '+data.t;
  document.getElementById('helpSub').textContent = 'Kreator — krok '+(step+1);
  let html = `<div class="help-section"><div class="help-section-title">Wskazówki</div>`;
  (data.items||[]).forEach(item => { html += `<div class="help-item">${item}</div>`; });
  html += '</div>';
  document.getElementById('helpContent').innerHTML = html;
  document.getElementById('helpOverlay').classList.add('show');
}


// ================================================================
//  DRUKOWANIE
// ================================================================
function openPrintPanel() {
  if(!appState) { notify('Brak planu do drukowania'); return; }
  const classes  = sortClasses(appState.classes||[]);
  const teachers = sortTeachers(appState.teachers||[]);
  const niStuds  = appState.niStudents||[];

  // Helper: sekcja z przełącznikiem pojedynczy/płachta
  const section = (icon, label, id, itemsHtml, sheetFn) => `
    <div style="margin-bottom:14px;border-top:1px solid var(--border);padding-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.04em">
          ${icon} ${label}
        </div>
        ${sheetFn ? `<button onclick="${sheetFn}"
          style="font-size:.68rem;padding:3px 10px;border-radius:5px;border:1px solid var(--border);
                 background:var(--s2);color:var(--text-m);cursor:pointer;white-space:nowrap"
          title="Drukuj wszystkie na jednej płachcie (A3 landscape)">
          📄 Płachta wszystkich
        </button>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${itemsHtml}
      </div>
    </div>`;

  const btnRow = (onclick, label) =>
    `<button class="wbtn wbtn-ghost" style="text-align:left;padding:6px 12px;font-size:.78rem"
      onclick="${onclick}">${label}</button>`;

  let html = `
    <div style="margin-bottom:12px">
      <div style="font-size:.72rem;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Widok aktualny</div>
      <button class="wbtn wbtn-primary" style="width:100%;padding:8px" onclick="doPrint('current')">
        🖨️ Drukuj aktualny widok aplikacji
      </button>
    </div>`;

  // ── Klasy ──
  html += section('📚', 'Plany klas',
    'class',
    classes.map(c => btnRow(`doPrint('class','${c.id}')`, `📚 Klasa ${c.name}`)).join(''),
    classes.length > 1 ? `doPrint('class',null,'sheet')` : null
  );

  // ── Nauczyciele ──
  html += section('👩‍🏫', 'Plany nauczycieli',
    'teacher',
    teachers.map(t => btnRow(
      `doPrint('teacher','${t.id}')`,
      `👩‍🏫 ${t.last} ${t.first} <span style="font-family:var(--mono);color:var(--text-d)">(${t.abbr})</span>`
    )).join(''),
    teachers.length > 1 ? `doPrint('teacher',null,'sheet')` : null
  );

  // ── Uczniowie NI ──
  html += section('👤', 'Plany uczniów NI',
    'ni',
    niStuds.length
      ? niStuds.map(s => {
          const cls = classes.find(c=>c.id===s.classId);
          return btnRow(
            `doPrintNI('${s.id}')`,
            `👤 ${s.name}${cls?' ('+cls.name+')':''}`
          );
        }).join('')
      : `<div style="font-size:.75rem;color:var(--text-d);padding:6px">Brak uczniów NI w systemie</div>`,
    null
  );

  // ── Inne ──
  html += `<div style="border-top:1px solid var(--border);padding-top:12px">
    <div style="font-size:.72rem;font-weight:700;color:var(--text-m);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Inne</div>
    ${btnRow("doPrint('matrix')", '🔲 Macierz szkoły')}
    ${btnRow("doPrint('stats')", '📊 Statystyki obciążenia')}
  </div>`;

  document.getElementById('printContent').innerHTML = html;
  document.getElementById('printOverlay').classList.add('show');
}

function closePrintPanel() {
  document.getElementById('printOverlay').classList.remove('show');
}

// ================================================================
//  SYSTEM DRUKOWANIA — nowe okno z dedykowanym HTML
// ================================================================

// ── Główna funkcja — otwiera dedykowane okno druku ──
function doPrint(type, id, mode) {
  // mode: 'single' (domyślny) | 'sheet' (płachta wszystkich)
  closePrintPanel();
  if(!appState) return;

  if(type === 'current') {
    // Stary tryb — drukuj aktualny widok aplikacji
    addPrintHeader();
    window.print();
    return;
  }

  if(type === 'ni' && id) {
    doPrintNI(id);
    return;
  }

  // Zbierz dane do druku
  let items = [];
  if(type === 'class') {
    items = id
      ? [(appState.classes||[]).find(c=>c.id===id)].filter(Boolean)
      : sortClasses(appState.classes||[]);
  } else if(type === 'teacher') {
    items = id
      ? [(appState.teachers||[]).find(t=>t.id===id)].filter(Boolean)
      : sortTeachers(appState.teachers||[]);
  }

  if(!items.length) return;

  const isSheet  = mode === 'sheet'; // płachta = wszystko na raz
  const html     = buildPrintHTML(type, items, isSheet);
  openPrintWindow(html);
}

async function doPrintAll(type) {
  // Legacy — teraz wywołuje doPrint z sheet
  doPrint(type, null, 'sheet');
}

// ── Buduj HTML do druku ──
function buildPrintHTML(type, items, isSheet) {
  const school = escapeHtml(appState.name||'');
  const year   = escapeHtml(appState.schoolYear||appState.year||'');
  const hours  = appState.hours||[];

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #111; background: #fff; }
    .page { padding: 10mm; }
    .page-header { margin-bottom: 6px; border-bottom: 2px solid #333; padding-bottom: 4px; }
    .page-title { font-size: 13px; font-weight: bold; }
    .page-sub   { font-size: 9px; color: #555; margin-top: 2px; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #ccc; padding: 2px 3px; vertical-align: top; font-size: 9px; }
    th { background: #f0f0f0; font-weight: bold; text-align: center; }
    .hour-cell { background: #f8f8f8; text-align: center; width: 38px; color: #555; }
    .lesson { border-radius: 2px; padding: 1px 3px; }
    .subj-name { font-weight: bold; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .subj-meta { font-size: 8px; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .empty-cell { background: #fafafa; }
    .page-break { page-break-after: always; }
    .sheet-label { font-size: 8px; font-weight: bold; text-align: center;
                   background: #e8e8e8; padding: 2px; border-bottom: 1px solid #ccc; }
    @page { margin: 8mm; }
    @media print {
      body { font-size: 9px; }
      .page { padding: 0; }
    }
  `;

  // Jeśli płachta — dodaj CSS dla układu boku do boku
  const sheetCss = isSheet ? `
    .sheet-wrap { display: grid; gap: 6mm; }
    @media print {
      @page { size: A3 landscape; margin: 6mm; }
      .sheet-wrap { grid-template-columns: repeat(auto-fill, minmax(180mm, 1fr)); }
    }
    @media screen {
      .sheet-wrap { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); max-width: 100%; }
    }
  ` : `
    @media print {
      @page { size: A4 landscape; margin: 8mm; }
    }
  `;

  // Nagłówek dokumentu
  const header = `<!DOCTYPE html><html lang="pl"><head>
    <meta charset="UTF-8">
    <title>${school} — Plan ${type==='class'?'klas':'nauczycieli'} ${year}</title>
    <style>${css}${sheetCss}</style>
  </head><body>`;

  // Buduj siatki
  let body = '';

  if(isSheet) {
    // PŁACHTA — wszystkie plany obok siebie
    body += `<div class="page">
      <div class="page-header">
        <div class="page-title">${school}</div>
        <div class="page-sub">${year} · ${type==='class'?'Plany wszystkich klas':'Plany wszystkich nauczycieli'} · Rok szkolny ${appState.activeSem===1?'sem. 1':'sem. 2'}</div>
      </div>
      <div class="sheet-wrap">`;

    items.forEach(item => {
      body += `<div>
        <div class="sheet-label">${type==='class'?item.name:item.last+' '+item.first+' ('+item.abbr+')'}</div>
        ${buildGrid(type, item, hours, DAYS, true)}
      </div>`;
    });

    body += `</div></div>`;

  } else {
    // INDYWIDUALNIE — każdy plan na osobnej stronie
    items.forEach((item, idx) => {
      const label = type==='class'
        ? escapeHtml(item.name)
        : escapeHtml(item.last+' '+item.first+' ('+item.abbr+')');
      const subLabel = type==='class'
        ? `Wychowawca: ${escapeHtml(getHomeroomName(item))}`
        : `Pensum: ${item.hoursTotal||'—'} godz./tydz.`;

      body += `<div class="page${idx < items.length-1 ? ' page-break' : ''}">
        <div class="page-header">
          <div class="page-title">${school} · ${year} · ${type==='class'?'Klasa':'Nauczyciel'}: ${label}</div>
          <div class="page-sub">${subLabel}</div>
        </div>
        ${buildGrid(type, item, hours, DAYS, false)}
      </div>`;
    });
  }

  return header + body + '</body></html>';
}

// ── Buduj siatkę godzinową dla jednej klasy/nauczyciela ──
function buildGrid(type, item, hours, DAYS, compact) {
  const subjects = appState.subjects||[];
  const teachers = appState.teachers||[];
  const rooms    = appState.rooms||[];
  const fsize    = compact ? '8px' : '9px';

  let html = `<table style="font-size:${fsize}">
    <thead><tr>
      <th class="hour-cell">Nr</th>
      ${DAYS.map(d=>`<th>${d}</th>`).join('')}
    </tr></thead><tbody>`;

  hours.forEach(h => {
    html += `<tr>
      <td class="hour-cell">${h.num}<br><span style="font-size:7px;color:#888">${h.start}</span></td>`;

    for(let di=0; di<5; di++) {
      let lesson = null;

      if(type === 'class') {
        lesson = getLesson(item.id, di, h.num);
      } else {
        // Nauczyciel — znajdź lekcję gdzie jest prowadzącym lub wspomagającym
        const entry = Object.entries(schedData).find(([k,v]) => {
          const p = k.split('_');
          return parseInt(p[1])===di && parseInt(p[2])===h.num && v.teacherId===item.id;
        });
        if(entry) {
          const clsId = entry[0].split('_')[0];
          lesson = {...entry[1], _clsId: clsId};
        }
      }

      if(lesson) {
        const subj = lesson.subjectId ? subjects.find(s=>s.id===lesson.subjectId) : null;
        const tch  = lesson.teacherId ? teachers.find(t=>t.id===lesson.teacherId) : null;
        const room = lesson.roomId    ? rooms.find(r=>r.id===lesson.roomId)       : null;
        const cls  = lesson._clsId   ? appState.classes.find(c=>c.id===lesson._clsId) : null;
        const color = subj?.color ? hexToRgba(subj.color, 0.15) : '#f5f5f5';
        const bcolor = subj?.color || '#ccc';

        const line1 = subj?.abbr || '?';
        const line2 = type==='class'
          ? [tch?.abbr, room?.name].filter(Boolean).join(' · ')
          : [cls?.name, room?.name].filter(Boolean).join(' · ');
        const groups = lesson.groups?.length ? '('+lesson.groups.join('/')+')' : '';

        html += `<td style="padding:1px 2px">
          <div class="lesson" style="background:${color};border-left:2px solid ${bcolor}">
            <div class="subj-name" style="color:${bcolor}">${line1}${groups?' <span style="font-size:7px">'+groups+'</span>':''}</div>
            ${line2?`<div class="subj-meta">${line2}</div>`:''}
          </div>
        </td>`;
      } else {
        html += `<td class="empty-cell"></td>`;
      }
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

// ── Pomocnicza: wychowawca klasy ──
function getHomeroomName(cls) {
  if(!cls.homeroomTeacherId) return '—';
  const t = (appState.teachers||[]).find(t=>t.id===cls.homeroomTeacherId);
  return t ? t.last+' '+t.first : '—';
}

// ── Otwórz okno druku ──
function openPrintWindow(html) {
  const win = window.open('', '_blank');
  if(!win) { notify('Zablokowano otwieranie okna — zezwól na pop-upy'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function addPrintHeader(label) {
  document.querySelectorAll('.print-header').forEach(el=>el.remove());
  const h = document.createElement('div');
  h.className = 'print-header';
  const schoolName = appState?.name||'';
  const year = appState?.schoolYear||appState?.year||'';
  h.innerHTML = `<strong>${escapeHtml(schoolName)}</strong>${year?' · '+escapeHtml(year):''} ${label?' · '+escapeHtml(label):''}`;
  const main = document.querySelector('.main-content');
  if(main) main.insertBefore(h, main.firstChild);
}



// ================================================================
//  INFORMACJA O DANYCH / CONSENT
// ================================================================
function initConsent() {
  if(!localStorage.getItem(LS.CONSENT)) {
    const banner = document.getElementById('lsBanner');
    if(banner) banner.style.display = 'flex';
  }
}

function acceptConsent() {
  localStorage.setItem(LS.CONSENT, '1');
  const banner = document.getElementById('lsBanner');
  if(banner) banner.style.display = 'none';
}


// ================================================================
//  MODAL DOKUMENTÓW
// ================================================================
const DOC_CONTENT = {
  regulamin:     "<h1 style=\"font-size:1.05rem;font-weight:700;margin:18px 0 5px;color:var(--text)\">\ud83d\udcc4 Regulamin aplikacji PlanLekcji</h1>\n\n<p style=\"margin:3px 0\"><strong>Wersja 1.0 \u00b7 obowi\u0105zuje od 1 marca 2025 r.</strong></p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a71. Postanowienia og\u00f3lne</h2>\n\n<p style=\"margin:3px 0\">Niniejszy Regulamin okre\u015bla zasady korzystania z aplikacji internetowej <strong>PlanLekcji \u2014 Uk\u0142adanie plan\u00f3w lekcji</strong> (dalej: \u201eAplikacja\"), udost\u0119pnianej pod adresem <strong>https://krzjur-oss.github.io/Plan-lekcji/</strong>.</p>\n\n<p style=\"margin:3px 0\">W\u0142a\u015bcicielem i tw\u00f3rc\u0105 Aplikacji jest <strong>Krzysztof Jureczek</strong> (dalej: \u201eAutor\"). Korzystanie z Aplikacji jest r\u00f3wnoznaczne z akceptacj\u0105 niniejszego Regulaminu.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a72. Przeznaczenie Aplikacji</h2>\n\n<p style=\"margin:3px 0\">Aplikacja przeznaczona jest wy\u0142\u0105cznie do <strong>niekomercyjnego u\u017cytku w plac\u00f3wkach o\u015bwiatowych</strong> (szko\u0142y podstawowe, licea, technika, szko\u0142y bran\u017cowe, przedszkola oraz inne plac\u00f3wki kszta\u0142cenia). Umo\u017cliwia planowanie tygodniowego planu lekcji \u2014 przypisywanie nauczycieli, klas, sal i przedmiot\u00f3w do poszczeg\u00f3lnych godzin lekcyjnych.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a73. Warunki korzystania</h2>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Aplikacja jest bezp\u0142atna i dost\u0119pna dla ka\u017cdego u\u017cytkownika posiadaj\u0105cego dost\u0119p do przegl\u0105darki internetowej.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>U\u017cytkownik zobowi\u0105zuje si\u0119 korzysta\u0107 z Aplikacji zgodnie z jej przeznaczeniem oraz obowi\u0105zuj\u0105cym prawem.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Zabronione jest u\u017cywanie Aplikacji w celach komercyjnych bez pisemnej zgody Autora.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Zabronione jest podejmowanie dzia\u0142a\u0144 mog\u0105cych zak\u0142\u00f3ci\u0107 dzia\u0142anie Aplikacji lub narazi\u0107 innych u\u017cytkownik\u00f3w na szkod\u0119.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>U\u017cytkownik ponosi pe\u0142n\u0105 odpowiedzialno\u015b\u0107 za dane wprowadzone do Aplikacji.</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a74. Prawa autorskie i licencja</h2>\n\n<p style=\"margin:3px 0\">Wszelkie prawa do Aplikacji \u2014 w tym kod \u017ar\u00f3d\u0142owy, interfejs graficzny, projekt wizualny oraz dokumentacja \u2014 nale\u017c\u0105 wy\u0142\u0105cznie do Autora i s\u0105 chronione przepisami prawa autorskiego (ustawa z dnia 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych).</p>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">\u274c **Zabronione**</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Kopiowanie, modyfikowanie, dekompilowanie, rozpowszechnianie lub sprzeda\u017c Aplikacji b\u0105d\u017a jej cz\u0119\u015bci bez pisemnej zgody Autora</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\u2705 **Dozwolone**</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Korzystanie z Aplikacji zgodnie z jej przeznaczeniem, zapisywanie i eksportowanie w\u0142asnych danych, udost\u0119pnianie linku do Aplikacji innym osobom</td></tr>\n</table>\n\n<p style=\"margin:3px 0\">W sprawach licencjonowania komercyjnego prosimy o kontakt z Autorem poprzez repozytorium GitHub.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a75. Dane i prywatno\u015b\u0107</h2>\n\n<p style=\"margin:3px 0\">Aplikacja <strong>nie zbiera, nie przesy\u0142a ani nie przechowuje</strong> \u017cadnych danych u\u017cytkownika na zewn\u0119trznych serwerach. Wszelkie dane przechowywane s\u0105 wy\u0142\u0105cznie lokalnie w pami\u0119ci przegl\u0105darki u\u017cytkownika (<code style=\"background:var(--s2);padding:1px 4px;border-radius:3px;font-size:.85em\">localStorage</code>) na jego urz\u0105dzeniu.</p>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Zasady przetwarzania danych</h3>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Dane <strong>nie opuszczaj\u0105</strong> urz\u0105dzenia u\u017cytkownika.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Aplikacja <strong>nie u\u017cywa</strong> plik\u00f3w cookie, narz\u0119dzi analitycznych, sieci reklamowych ani us\u0142ug zewn\u0119trznych (z wyj\u0105tkiem Google Fonts do \u0142adowania czcionek Syne i DM Mono).</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor <strong>nie ma dost\u0119pu</strong> do \u017cadnych danych wprowadzonych przez u\u017cytkownika.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>U\u017cytkownik mo\u017ce w ka\u017cdej chwili usun\u0105\u0107 swoje dane, czyszcz\u0105c dane witryny w ustawieniach przegl\u0105darki lub korzystaj\u0105c z funkcji \u201eResetuj ca\u0142\u0105 aplikacj\u0119\" w Ustawieniach aplikacji.</div>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Klucze localStorage u\u017cywane przez Aplikacj\u0119</h3>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">Klucz</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Zawarto\u015b\u0107</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Kiedy zapisywany</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_state`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Konfiguracja szko\u0142y (klasy, nauczyciele, sale, przedmioty, godziny)</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Po ka\u017cdej zmianie konfiguracji</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_sched`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">U\u0142o\u017cony plan lekcji (przypisania lekcji do godzin)</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Po ka\u017cdej zmianie planu</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_wiz`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Autozapis kreatora konfiguracji</td><td style=\"border:1px solid var(--border);padding:5px 8px\">W trakcie korzystania z kreatora</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_theme`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Wybrany motyw kolorystyczny (ciemny/jasny)</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Po zmianie motywu</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_consent`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Potwierdzenie zapoznania si\u0119 z informacj\u0105 o danych</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Po klikni\u0119ciu \u201eRozumiem\"</td></tr>\n</table>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Dane osobowe nauczycieli</h3>\n\n<p style=\"margin:3px 0\">Plan lekcji zawiera imiona i nazwiska nauczycieli \u2014 stanowi\u0105 one dane osobowe w rozumieniu RODO (Rozporz\u0105dzenie Parlamentu Europejskiego i Rady (UE) 2016/679). Poniewa\u017c dane s\u0105 przetwarzane <strong>wy\u0142\u0105cznie lokalnie na urz\u0105dzeniu u\u017cytkownika</strong> i nie s\u0105 przekazywane \u017cadnej osobie trzeciej ani do \u017cadnego serwera, zastosowanie ma wy\u0142\u0105czenie z art. 2 ust. 2 lit. c RODO (przetwarzanie przez osob\u0119 fizyczn\u0105 w ramach czynno\u015bci o czysto osobistym lub domowym charakterze).</p>\n\n<p style=\"margin:3px 0\">U\u017cytkownik, kt\u00f3ry przetwarza dane nauczycieli w imieniu szko\u0142y jako instytucji, jest zobowi\u0105zany do przestrzegania wewn\u0119trznych procedur ochrony danych osobowych obowi\u0105zuj\u0105cych w danej plac\u00f3wce.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a76. Odpowiedzialno\u015b\u0107</h2>\n\n<p style=\"margin:3px 0\">Aplikacja udost\u0119pniana jest w stanie \u201etakim, jakim jest\" (<em>as is</em>), bez jakichkolwiek gwarancji \u2014 w szczeg\u00f3lno\u015bci gwarancji przydatno\u015bci do okre\u015blonego celu, poprawno\u015bci wygenerowanych plan\u00f3w ani nieprzerwanego dzia\u0142ania.</p>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor nie ponosi odpowiedzialno\u015bci za <strong>utrat\u0119 danych</strong> wynikaj\u0105c\u0105 z wyczyszczenia danych przegl\u0105darki, awarii urz\u0105dzenia, aktualizacji systemu operacyjnego lub innych przyczyn niezale\u017cnych od Autora.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor nie ponosi odpowiedzialno\u015bci za <strong>b\u0142\u0119dy w u\u0142o\u017conym planie lekcji</strong> \u2014 w tym konflikty, naruszenie przepis\u00f3w o\u015bwiatowych lub inne nieprawid\u0142owo\u015bci wynikaj\u0105ce z niepoprawnie wprowadzonych danych lub ogranicze\u0144 algorytmu generatora.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor nie ponosi odpowiedzialno\u015bci za szkody wynikaj\u0105ce z <strong>nieprawid\u0142owego korzystania</strong> z Aplikacji.</div>\n\n<p style=\"margin:3px 0\"><strong>Zalecenie:</strong> Regularnie tw\u00f3rz kopie zapasowe danych za pomoc\u0105 funkcji <strong>Eksportuj JSON</strong> dost\u0119pnej w topbarze aplikacji.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a77. Dost\u0119pno\u015b\u0107 i aktualizacje</h2>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor dok\u0142ada stara\u0144, aby Aplikacja dzia\u0142a\u0142a poprawnie i by\u0142a dost\u0119pna przez ca\u0142\u0105 dob\u0119, jednak nie gwarantuje ci\u0105g\u0142o\u015bci dzia\u0142ania.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Autor zastrzega sobie prawo do <strong>modyfikowania, aktualizowania lub zaprzestania</strong> udost\u0119pniania Aplikacji w dowolnym momencie bez wcze\u015bniejszego powiadamiania.</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Aktualizacje Aplikacji s\u0105 wdra\u017cane automatycznie poprzez mechanizm Service Worker \u2014 u\u017cytkownik mo\u017ce by\u0107 poproszony o od\u015bwie\u017cenie strony w celu za\u0142adowania nowej wersji.</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a78. Zmiany Regulaminu</h2>\n\n<p style=\"margin:3px 0\">Autor zastrzega sobie prawo do zmiany niniejszego Regulaminu. O istotnych zmianach u\u017cytkownicy b\u0119d\u0105 informowani poprzez komunikat wy\u015bwietlany w Aplikacji lub aktualizacj\u0119 niniejszego pliku. Dalsze korzystanie z Aplikacji po opublikowaniu zmian oznacza akceptacj\u0119 nowej wersji Regulaminu.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u00a79. Postanowienia ko\u0144cowe</h2>\n\n<p style=\"margin:3px 0\">W sprawach nieuregulowanych niniejszym Regulaminem zastosowanie maj\u0105 przepisy prawa polskiego, w szczeg\u00f3lno\u015bci:</p>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Kodeksu cywilnego (ustawa z dnia 23 kwietnia 1964 r.),</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Ustawy o prawie autorskim i prawach pokrewnych (ustawa z dnia 4 lutego 1994 r.),</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Rozporz\u0105dzenia RODO (UE) 2016/679.</div>\n\n<p style=\"margin:3px 0\">Wszelkie pytania dotycz\u0105ce Aplikacji lub niniejszego Regulaminu mo\u017cna kierowa\u0107 do Autora za po\u015brednictwem repozytorium GitHub projektu:</p>\n\n<p style=\"margin:3px 0\">\ud83d\udd17 <strong>https://github.com/krzjur-oss/Plan-lekcji</strong></p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<p style=\"margin:3px 0\"><em>\u00a9 2025 Krzysztof Jureczek \u00b7 Wszelkie prawa zastrze\u017cone</em></p>\n",
  licencja:      "<pre style=\"background:var(--s2);padding:14px;border-radius:8px;font-size:.75rem;line-height:1.6;white-space:pre-wrap\">Copyright (c) 2025 Krzysztof Jureczek. All rights reserved.\n\nPROJECT NAME: PlanLekcji\nAUTHOR: Krzysztof Jureczek\nURL: https://krzjur-oss.github.io/Plan-lekcji/\n\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION:\n\n1. Ownership: All visual interfaces, graphics, design, compilation, information,\n   computer code (including source code or object code), products, software,\n   services, and all other elements of the PlanLekcji application provided by\n   the Author are protected by intellectual property and proprietary rights.\n\n2. Restriction of Use: Permission is hereby NOT granted to any person obtaining\n   a copy of this software and associated documentation files to deal in the\n   Software without restriction. This includes, without limitation, the rights\n   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell\n   copies of the Software.\n\n3. Personal Use: You may access and use the application strictly for its\n   intended purpose (creating school timetables / lesson plans). Any reverse\n   engineering or unauthorized reproduction of the source code is\n   strictly prohibited.\n\n4. Educational Use: The application is intended exclusively for non-commercial\n   use in educational institutions (schools, kindergartens, educational\n   facilities). Any commercial use requires prior written consent from the Author.\n\n5. No Warranty: THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\n   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\n   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\n   IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\n   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\n   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER\n   DEALINGS IN THE SOFTWARE.\n\n6. Data: The application stores all data exclusively in the user's browser\n   (localStorage). No data is transmitted to external servers. The Author\n   has no access to any data entered by users.\n\nFor inquiries regarding commercial use or licensing, please contact the Author\nvia the GitHub repository: https://github.com/krzjur-oss/Plan-lekcji\n</pre>",
  dokumentacja:  "<h1 style=\"font-size:1.05rem;font-weight:700;margin:18px 0 5px;color:var(--text)\">\ud83d\udcc5 PlanLekcji \u2014 Uk\u0142adanie plan\u00f3w lekcji</h1>\n\n<p style=\"margin:3px 0\">Aplikacja PWA do uk\u0142adania i zarz\u0105dzania planem lekcji szkolnych. Dzia\u0142a w ca\u0142o\u015bci w przegl\u0105darce \u2014 <strong>bez serwera, bez instalacji, bez zbierania danych</strong>. Mo\u017cna j\u0105 zainstalowa\u0107 na komputerze lub tablecie jak aplikacj\u0119 natywn\u0105.</p>\n\n<p style=\"margin:3px 0\">\ud83d\udd17 <strong>Aplikacja:</strong> https://krzjur-oss.github.io/Plan-lekcji/</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u2728 Funkcje</h2>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83d\ude80 Strona powitalna</h3>\n\n<p style=\"margin:3px 0\">Przy pierwszym uruchomieniu wy\u015bwietla si\u0119 strona powitalna z opcjami:</p>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">Opcja</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Opis</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\u2728 Nowy plan</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Kreator konfiguracji szko\u0142y \u2014 7 krok\u00f3w</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udccb Kontynuuj</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Wr\u00f3\u0107 do istniej\u0105cego planu</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udd04 Wr\u00f3\u0107 do kreatora</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Kontynuuj przerwan\u0105 konfiguracj\u0119 (autozapis)</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udcc2 Importuj</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Wczytaj plan z pliku `.json`</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83c\udf93 Demo</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Przyk\u0142adowy plan szko\u0142y \u2014 dane nie s\u0105 zapisywane</td></tr>\n</table>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83d\udcda Widoki planu</h3>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">Widok</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Opis</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udcda Klasy</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Plan wybranej klasy \u2014 ca\u0142y tydzie\u0144 lub wybrany dzie\u0144</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udc69\u200d\ud83c\udfeb Nauczyciele</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Plan wybranego nauczyciela z widokiem wszystkich klas</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83c\udfeb Sale</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Ob\u0142o\u017cenie wybranej sali w ci\u0105gu tygodnia</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udd32 Macierz</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Przegl\u0105d ca\u0142ej szko\u0142y (Klasy \u00d7 Godziny lub Nauczyciele \u00d7 Godziny)</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udea8 Dy\u017cury</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Zarz\u0105dzanie dy\u017curami nauczycieli na przerwach</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\ud83d\udcca Statystyki</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Realizacja etatu, obci\u0105\u017cenie nauczycieli, rozk\u0142ad przedmiot\u00f3w</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\u26a1 Generator</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Automatyczne uk\u0142adanie planu z konfigurowaln\u0105 list\u0105 warunk\u00f3w</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">\u2699\ufe0f Ustawienia</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Konfiguracja szko\u0142y, klas, nauczycieli, sal i godzin</td></tr>\n</table>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\u26a1 Generator planu</h3>\n\n<p style=\"margin:3px 0\">Automatyczny solver uk\u0142adaj\u0105cy plan na podstawie zdefiniowanych warunk\u00f3w:</p>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Dost\u0119pno\u015b\u0107 nauczycieli</strong> \u2014 blokady, okienka, godziny preferowane</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Bloki lekcji</strong> \u2014 podw\u00f3jne lub potr\u00f3jne godziny z rz\u0119du</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Pozycja przedmiot\u00f3w</strong> \u2014 WF na ko\u0144cu dnia, religia na pocz\u0105tku lub ko\u0144cu (skrajne)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Podzia\u0142 na grupy</strong> \u2014 r\u00f3wnoleg\u0142e lekcje dla grup klasy</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Przedmioty opcjonalne</strong> \u2014 religia/etyka z automatycznym podzia\u0142em grupy, mo\u017cliwo\u015b\u0107 \u0142\u0105czenia ma\u0142ych grup mi\u0119dzy klasami</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Analiza sal</strong> \u2014 sprawdza czy liczba sal wystarczy na szczyt ob\u0142o\u017cenia</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Max dziennie</strong> \u2014 ograniczenie liczby wyst\u0105pie\u0144 przedmiotu w ci\u0105gu dnia</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Max dni z rz\u0119du</strong> \u2014 ograniczenie kolejnych dni z tym samym przedmiotem</div>\n\n<p style=\"margin:3px 0\">Solver dzia\u0142a jako <strong>Web Worker</strong> (w\u0105tek w tle) \u2014 interfejs nie zamiera podczas generowania. Algorytm: Greedy + Simulated Annealing.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83c\udfeb Konfiguracja szko\u0142y</h3>\n\n<p style=\"margin:3px 0\"><strong>Klasy:</strong></p>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Grupy (podgrupy klasy)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Liczba uczni\u00f3w</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Wychowawca, sale gospodarz</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Przedmioty opcjonalne (religia, etyka, mniejszo\u015bci) z liczb\u0105 uczni\u00f3w i \u0142\u0105czeniem grup mi\u0119dzy klasami</div>\n\n<p style=\"margin:3px 0\"><strong>Nauczyciele:</strong></p>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Pensum i nadgodziny sta\u0142e</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Wymiar etatu (pe\u0142ny, p\u00f3\u0142, inny u\u0142amek)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Przydzia\u0142 godzin do klas i przedmiot\u00f3w</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Nauczanie indywidualne</div>\n\n<p style=\"margin:3px 0\"><strong>Przedmioty:</strong></p>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Kolor, skr\u00f3t</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Czas realizacji (ca\u0142y rok / semestr 1 / semestr 2)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Przypisanie do konkretnych klas</div>\n\n<p style=\"margin:3px 0\"><strong>Sale:</strong></p>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Typ (pe\u0142na klasa, grupowa, indywidualna, specjalistyczna)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Pojemno\u015b\u0107</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Przypisanie do budynku i pi\u0119tra</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Opiekunowie, preferowane przedmioty (np. sala komputerowa \u2192 Informatyka)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Ograniczenia wiekowe (sala dla klas 1\u20133)</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83d\udda8\ufe0f Drukowanie</h3>\n\n<p style=\"margin:3px 0\">Przycisk \ud83d\udda8\ufe0f w topbarze otwiera panel drukowania:</p>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Aktualny widok</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Plan wybranej klasy / wszystkich klas po kolei</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Plan wybranego nauczyciela / wszystkich nauczycieli po kolei</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Macierz szko\u0142y</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Statystyki</div>\n\n<p style=\"margin:3px 0\">Wydruk zawiera nag\u0142\u00f3wek z nazw\u0105 szko\u0142y, rokiem szkolnym i nazw\u0105 klasy/nauczyciela.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83d\udcbe Eksport i import danych</h3>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Eksportuj JSON</strong> \u2014 pe\u0142na kopia zapasowa planu i konfiguracji</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Importuj JSON</strong> \u2014 wczytaj plan z pliku <code style=\"background:var(--s2);padding:1px 4px;border-radius:3px;font-size:.85em\">.json</code></div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Tryb demo \u2014 przegl\u0105daj przyk\u0142adowy plan bez zapisywania zmian</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83e\uddd9 Kreator konfiguracji (7 krok\u00f3w)</h3>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">Krok</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Zawarto\u015b\u0107</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">1 \u2014 Szko\u0142a</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Nazwa szko\u0142y, rok szkolny</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">2 \u2014 Budynki</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Budynki, pi\u0119tra, segmenty (opcjonalne)</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">3 \u2014 Klasy</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Lista klas z grupami, import masowy</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">4 \u2014 Przedmioty</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Nazwy, skr\u00f3ty, kolory, import masowy</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">5 \u2014 Nauczyciele</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Imi\u0119, nazwisko, skr\u00f3t, pensum, import masowy</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">6 \u2014 Sale</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Nazwa, typ, pojemno\u015b\u0107, budynek</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">7 \u2014 Godziny</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Harmonogram godzin lekcyjnych lub generator automatyczny</td></tr>\n</table>\n\n<p style=\"margin:3px 0\">Kreator <strong>autozapisuje</strong> post\u0119p \u2014 mo\u017cna bezpiecznie zamkn\u0105\u0107 przegl\u0105dark\u0119 i wr\u00f3ci\u0107 do konfiguracji.</p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">\ud83d\udd12 Prywatno\u015b\u0107 i dane</h3>\n\n<p style=\"margin:3px 0\">Aplikacja <strong>nie zbiera, nie wysy\u0142a ani nie przechowuje</strong> \u017cadnych danych zewn\u0119trznie. Wszystkie dane wy\u0142\u0105cznie w <code style=\"background:var(--s2);padding:1px 4px;border-radius:3px;font-size:.85em\">localStorage</code> przegl\u0105darki.</p>\n\n<table style=\"border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem\">\n<tr><th style=\"border:1px solid var(--border);padding:5px 8px\">Klucz</th><th style=\"border:1px solid var(--border);padding:5px 8px\">Zawarto\u015b\u0107</th></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_state`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Konfiguracja szko\u0142y (klasy, nauczyciele, sale, przedmioty)</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_sched`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">U\u0142o\u017cony plan lekcji</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_wiz`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Autozapis kreatora</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_theme`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Wybrany motyw (ciemny/jasny)</td></tr>\n<tr><td style=\"border:1px solid var(--border);padding:5px 8px\">`pl_consent`</td><td style=\"border:1px solid var(--border);padding:5px 8px\">Potwierdzenie informacji o danych</td></tr>\n</table>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\ud83d\udcf2 PWA \u2014 instalacja jako aplikacja</h2>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Chrome / Edge (Windows, Android)</h3>\n<p style=\"margin:3px 0\">Kliknij ikon\u0119 \u2295 w pasku adresu przegl\u0105darki lub baner instalacji.</p>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Safari (iOS / macOS)</h3>\n<p style=\"margin:3px 0\">Udost\u0119pnij \u2192 <strong>Dodaj do ekranu g\u0142\u00f3wnego</strong></p>\n\n<h3 style=\"font-size:.9rem;font-weight:700;margin:10px 0 5px;color:var(--text)\">Po instalacji</h3>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Pe\u0142ny tryb offline \u2014 Service Worker cache'uje wszystkie pliki</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span>Dzia\u0142a jak aplikacja natywna \u2014 bez paska przegl\u0105darki</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\ud83d\udcd6 Jak zacz\u0105\u0107</h2>\n\n<p style=\"margin:3px 0\">1. Otw\u00f3rz aplikacj\u0119 \u2192 pojawi si\u0119 strona powitalna</p>\n<p style=\"margin:3px 0\">2. Wybierz <strong>\u2728 Nowy plan</strong> i przejd\u017a przez kreator (7 krok\u00f3w)</p>\n<p style=\"margin:3px 0\">3. W Ustawieniach \u2192 Nauczyciele przypisz ka\u017cdemu nauczycielowi klasy i godziny</p>\n<p style=\"margin:3px 0\">4. Uk\u0142adaj plan r\u0119cznie (przeci\u0105gaj lekcje) lub u\u017cyj Generatora</p>\n<p style=\"margin:3px 0\">5. Regularnie eksportuj kopi\u0119 zapasow\u0105: przycisk \ud83d\udcbe \u2192 <strong>Eksportuj JSON</strong></p>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\ud83d\uddc2 Struktura repozytorium</h2>\n\n<pre style=\"background:var(--s2);padding:10px 14px;border-radius:8px;font-size:.78rem;overflow-x:auto\"><code>\nPlan-lekcji/\n\u251c\u2500\u2500 index.html      # Ca\u0142a aplikacja (HTML + CSS + JS, ~290 KB)\n\u251c\u2500\u2500 manifest.json   # PWA manifest\n\u251c\u2500\u2500 sw.js           # Service Worker (cache offline)\n\u251c\u2500\u2500 icon-*.png      # Ikony PWA (72\u2013512 px)\n\u251c\u2500\u2500 LICENSE         # Licencja i prawa autorskie\n\u251c\u2500\u2500 REGULAMIN.md    # Regulamin korzystania z aplikacji\n\u2514\u2500\u2500 README.md       # Dokumentacja (ten plik)\n</code></pre>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\ud83d\udee0 Technologie</h2>\n\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Frontend:</strong> czysty HTML + CSS + JavaScript \u2014 zero zewn\u0119trznych bibliotek</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Dane:</strong> <code style=\"background:var(--s2);padding:1px 4px;border-radius:3px;font-size:.85em\">localStorage</code> przegl\u0105darki</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Offline:</strong> Service Worker (Cache API)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Standard:</strong> PWA (Web App Manifest)</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Solver:</strong> Web Worker + Greedy Algorithm + Simulated Annealing</div>\n<div style=\"padding:2px 0 2px 14px;position:relative\"><span style=\"position:absolute;left:0;color:var(--accent)\">\u00b7</span><strong>Czcionki:</strong> Syne (800) + DM Mono \u2014 Google Fonts</div>\n\n<hr style=\"border:none;border-top:1px solid var(--border);margin:12px 0\">\n\n<h2 style=\"font-size:1rem;font-weight:700;margin:14px 0 5px;color:var(--text)\">\u2696\ufe0f Licencja i prawa autorskie</h2>\n\n<p style=\"margin:3px 0\">\u00a9 2025 Krzysztof Jureczek. Wszelkie prawa zastrze\u017cone.</p>\n\n<p style=\"margin:3px 0\">Szczeg\u00f3\u0142owe warunki u\u017cytkowania w pliku <a href=\"LICENSE\" target=\"_blank\" style=\"color:var(--accent)\"><code style=\"background:var(--s2);padding:1px 4px;border-radius:3px;font-size:.85em\">LICENSE</code></a>. Aplikacja przeznaczona wy\u0142\u0105cznie do niekomercyjnego u\u017cytku w plac\u00f3wkach o\u015bwiatowych.</p>\n"
}

function openDocModal(tab) {
  const overlay = document.getElementById('docOverlay');
  if(!overlay) return;
  overlay.style.display = 'flex';
  showDoc(tab||'regulamin');
}

function closeDocModal() {
  const overlay = document.getElementById('docOverlay');
  if(overlay) overlay.style.display = 'none';
}

function showDoc(tab) {
  // Aktywna zakładka
  ['regulamin','licencja','dokumentacja'].forEach(t => {
    const btn = document.getElementById('docTab-'+t);
    if(!btn) return;
    btn.style.background = t===tab ? 'var(--accent)' : 'var(--s2)';
    btn.style.color = t===tab ? '#fff' : 'var(--text-m)';
  });
  const el = document.getElementById('docContent');
  if(el) el.innerHTML = DOC_CONTENT[tab]||'';
}

function showPrivacyModal() {
  document.getElementById('privacyOverlay').style.display = 'flex';
}

function closePrivacyModal() {
  document.getElementById('privacyOverlay').style.display = 'none';
}


// ================================================================
//  MODAL NAUCZANIA INDYWIDUALNEGO (NI)
// ================================================================
// Struktura danych — appState.niStudents: [{
//   id, name, classId, form, studentCount,
//   subjects: [{
//     subjId,
//     mode: 'indiv' | 'class' | 'split',
//       indiv  = wszystkie godziny indywidualnie
//       class  = wszystkie godziny z klasą
//       split  = część indywidualnie, część z klasą (np. EW)
//     teacherId: null | id,        // nauczyciel NI (indiv/split)
//     hours: number,               // godz. NI tygodniowo (indiv/split)
//     hoursClass: number,          // godz. z klasą (tylko split)
//     supportTeacherId: null | id  // nauczyciel wspomagający (class/split)
//   }]
// }]

let _niEditId   = null;  // null = nowy, string = edycja
let _niSubjRows = [];    // [{subjId, mode, teacherId, hours}] - stan edycji

// ── Inicjalizacja stanu ──
function niEnsureState() {
  if(!appState) return false;
  if(!appState.niStudents) appState.niStudents = [];
  return true;
}

// ── Migracja ze starych struktur ──
function niMigrate() {
  if(!appState) return;
  niEnsureState();

  // Migruj z individualTeaching nauczycieli
  (appState.teachers||[]).forEach(t => {
    (t.individualTeaching||[]).forEach(item => {
      // Sprawdź czy już nie zmigrowany
      const exists = appState.niStudents.some(s =>
        s.name === item.name && s._srcTch === t.id
      );
      if(exists) return;
      const newStud = {
        id: 'ni_' + Date.now() + Math.random().toString(36).slice(2,6),
        name: item.name,
        classId: null,
        form: item.form || 'indywidualne',
        studentCount: item.students || 1,
        _srcTch: t.id,
        subjects: item.subjectId ? [{
          subjId: item.subjectId,
          mode: 'indiv',
          teacherId: t.id,
          hours: item.hours || 1,
          hoursClass: 0,
          supportTeacherId: null
        }] : []
      };
      appState.niStudents.push(newStud);
    });
  });

  // Migruj z grup klas (type='indiv')
  (appState.classes||[]).forEach(cls => {
    (cls.groups||[]).filter(g => g.type === 'indiv').forEach(g => {
      const exists = appState.niStudents.some(s =>
        s.name === g.name && s.classId === cls.id
      );
      if(exists) return;
      const newStud = {
        id: 'ni_' + Date.now() + Math.random().toString(36).slice(2,6),
        name: g.name,
        classId: cls.id,
        form: 'indywidualne',
        studentCount: 1,
        subjects: (g.subjects||[]).map(sid => ({
          subjId: sid, mode: 'indiv',
          teacherId: g.teacherId || null, hours: 1
        }))
      };
      appState.niStudents.push(newStud);
      // Usuń z grup klasy
      cls.groups = cls.groups.filter(gg => gg.id !== g.id);
    });
  });
}

// ── Otwórz modal główny ──
function openNIModal(fromTchId, fromClsId) {
  if(!appState) { notify('Najpierw utwórz plan'); return; }
  niEnsureState();
  niMigrate();

  // Wypełnij filtr klas
  const cf = document.getElementById('niClassFilter');
  if(cf) {
    cf.innerHTML = '<option value="">Wszystkie klasy</option>' +
      sortClasses(appState.classes||[]).map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
      ).join('');
    if(fromClsId) cf.value = fromClsId;
  }

  niRender();
  document.getElementById('niModal').classList.add('show');
}

function closeNIModal() {
  document.getElementById('niModal').classList.remove('show');
}

// ── Renderuj listę uczniów NI ──
function niRender() {
  const clsFilter = document.getElementById('niClassFilter')?.value || '';
  const list = document.getElementById('niStudentList');
  if(!list) return;
  niEnsureState();

  let students = appState.niStudents;
  if(clsFilter) students = students.filter(s => s.classId === clsFilter);

  if(!students.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-d)">
      <div style="font-size:2rem;margin-bottom:10px">👤</div>
      <div style="font-weight:700;margin-bottom:6px;color:var(--text-m)">Brak uczniów NI</div>
      <div style="font-size:.78rem">Kliknij "+ Dodaj ucznia NI" aby zacząć</div>
    </div>`;
    return;
  }

  const subjects = appState.subjects||[];
  const classes  = appState.classes||[];
  const teachers = appState.teachers||[];

  list.innerHTML = students.map(stud => {
    const cls  = classes.find(c => c.id === stud.classId);
    const indivSubjs = (stud.subjects||[]).filter(s=>s.mode==='indiv');
    const splitSubjs = (stud.subjects||[]).filter(s=>s.mode==='split');
    const classSubjs = (stud.subjects||[]).filter(s=>s.mode==='class');
    const totalHours = [...indivSubjs,...splitSubjs].reduce((s,r)=>s+(r.hours||0),0);

    const makeChip = (r, badge) => {
      const subj = subjects.find(s=>s.id===r.subjId);
      const tch  = r.teacherId ? teachers.find(t=>t.id===r.teacherId) : null;
      const supp = r.supportTeacherId ? teachers.find(t=>t.id===r.supportTeacherId) : null;
      return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;
        border-radius:10px;background:${subj?.color||'#888'}22;
        border:1px solid ${subj?.color||'#888'}44;font-size:.67rem;margin:1px">
        <span style="width:6px;height:6px;border-radius:50%;background:${subj?.color||'#888'};display:inline-block"></span>
        ${subj?.abbr||'?'}${badge?`<span style="color:var(--yellow);font-size:.6rem">${badge}</span>`:''}
        ${tch?`<span style="color:var(--text-d)">(${tch.abbr})</span>`:''}
        ${r.hours?`<span style="color:var(--text-d)">${r.hours}h</span>`:''}
        ${supp?`<span style="color:var(--teal)">+${supp.abbr}</span>`:''}
      </span>`;
    };

    const indivChips = indivSubjs.map(r=>makeChip(r,'')).join('');
    const splitChips = splitSubjs.map(r=>makeChip(r,'½')).join('');
    const classChips = classSubjs.map(r => {
      const subj = subjects.find(s=>s.id===r.subjId);
      const supp = r.supportTeacherId ? teachers.find(t=>t.id===r.supportTeacherId) : null;
      return `<span style="font-size:.65rem;color:var(--text-d);padding:1px 5px;
        border-radius:8px;background:var(--s3)">${escapeHtml(subj?.abbr||'?')}${supp?` <span style="color:var(--teal)">+${escapeHtml(supp.abbr)}</span>`:''}</span>`;
    }).join(' ');

    const formBadge = stud.form ? `<span style="font-size:.65rem;padding:1px 7px;border-radius:8px;
      background:var(--accent-g);color:var(--accent)">${escapeHtml(stud.form)}</span>` : '';

    return `<div style="padding:12px 14px;background:var(--s2);border:1px solid var(--border);
      border-radius:10px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:.88rem">👤 ${escapeHtml(stud.name)}</span>
            ${cls?`<span style="font-size:.7rem;background:var(--s3);padding:1px 7px;border-radius:6px;color:var(--text-m)">${escapeHtml(cls.name)}</span>`:''}
            ${formBadge}
            ${stud.studentCount>1?`<span style="font-size:.65rem;color:var(--text-d)">${stud.studentCount} ucz.</span>`:''}
            ${totalHours?`<span style="font-family:var(--mono);font-size:.72rem;color:var(--accent)">${totalHours}h NI/tydz.</span>`:''}
          </div>
          ${indivChips?`<div style="margin-bottom:3px"><span style="font-size:.6rem;color:var(--text-d)">NI: </span>${indivChips}</div>`:''}
          ${splitChips?`<div style="margin-bottom:3px"><span style="font-size:.6rem;color:var(--yellow)">½ </span>${splitChips}</div>`:''}
          ${classChips?`<div><span style="font-size:.6rem;color:var(--text-d)">Z klasą: </span>${classChips}</div>`:''}
          ${!indivChips&&!splitChips&&!classChips?`<span style="font-size:.72rem;color:var(--text-d)">Brak przypisanych przedmiotów</span>`:''}
        </div>
        <button onclick="niOpenEdit('${stud.id}')"
          style="flex-shrink:0;padding:5px 12px;border-radius:6px;
                 border:1px solid var(--border);background:transparent;
                 color:var(--text-m);font-family:var(--font);font-size:.72rem;cursor:pointer">
          Edytuj
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Dodaj nowego ucznia ──
function niAddStudent() {
  if(!appState) { notify('Najpierw utwórz lub załaduj plan'); return; }
  const clsFilter = document.getElementById('niClassFilter')?.value || '';
  niOpenEdit(null, clsFilter);
}

// ── Otwórz edycję ucznia ──
function niOpenEdit(studId, prefClsId) {
  if(!appState) { notify('Najpierw utwórz lub załaduj plan'); return; }
  if(!niEnsureState()) return;
  _niEditId = studId || null;

  const stud = studId ? appState.niStudents.find(s=>s.id===studId) : null;

  document.getElementById('niEditTitle').innerHTML =
    stud ? `Edytuj: <span style="color:var(--accent)">${escapeHtml(stud.name)}</span>` : 'Nowy uczeń NI';
  document.getElementById('niDeleteBtn').style.display = stud ? '' : 'none';

  // Wypełnij pola
  document.getElementById('niStudName').value  = stud?.name || '';
  document.getElementById('niStudForm').value  = stud?.form || 'indywidualne';
  document.getElementById('niStudCount').value = stud?.studentCount || 1;
  document.getElementById('niStudInPensum').checked = !!(stud?.inPensum);

  // Wypełnij select klas
  const clsSel = document.getElementById('niStudClass');
  clsSel.innerHTML = '<option value="">— brak przypisania —</option>' +
    sortClasses(appState.classes||[]).map(c =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join('');
  clsSel.value = stud?.classId || prefClsId || '';

  // Załaduj wiersze przedmiotów
  _niSubjRows = JSON.parse(JSON.stringify(stud?.subjects || []));
  niEditClassChange();

  document.getElementById('niEditModal').classList.add('show');
}

function closeNIEditModal() {
  document.getElementById('niEditModal').classList.remove('show');
  _niEditId = null;
  _niSubjRows = [];
}

// ── Zmiana klasy — przeładuj tabelę przedmiotów ──
function niEditClassChange() {
  const clsId = document.getElementById('niStudClass').value;
  const cls   = clsId ? (appState.classes||[]).find(c=>c.id===clsId) : null;
  const subjects = sortSubjects(appState.subjects||[]);
  const teachers = sortTeachers(appState.teachers||[]);

  // Które przedmioty są przypisane do tej klasy (lub wszystkie jeśli brak klasy)
  const clsSubjs = cls
    ? subjects.filter(s => !(s.classes||[]).length || (s.classes||[]).includes(clsId))
    : subjects;

  // Uzupełnij _niSubjRows — dodaj brakujące, zachowaj istniejące
  clsSubjs.forEach(s => {
    if(!_niSubjRows.find(r=>r.subjId===s.id)) {
      _niSubjRows.push({ subjId:s.id, mode:'class', teacherId:null, hours:1 });
    }
  });
  // Usuń przedmioty których nie ma w tej klasie (chyba że były ręcznie ustawione)
  _niSubjRows = _niSubjRows.filter(r => clsSubjs.some(s=>s.id===r.subjId));

  renderNISubjTable(clsSubjs, teachers);
  niEditSummary();
}

// ── Renderuj tabelę przedmiotów ──
function renderNISubjTable(clsSubjs, teachers) {
  const container = document.getElementById('niSubjTable');
  if(!container) return;

  if(!clsSubjs.length) {
    container.innerHTML = `<div style="color:var(--text-d);font-size:.78rem;padding:10px">
      Wybierz klasę aby zobaczyć przedmioty</div>`;
    return;
  }

  const clsId = document.getElementById('niStudClass').value;
  const allTchs = teachers;

  // Nauczyciele przypisani do tej klasy (ogólnie)
  const clsTchs = clsId
    ? teachers.filter(t=>(t.assignments||[]).some(a=>a.classId===clsId))
    : teachers;

  container.innerHTML = clsSubjs.map((subj) => {
    const row = _niSubjRows.find(r=>r.subjId===subj.id) ||
      { subjId:subj.id, mode:'class', teacherId:null, hours:1, hoursClass:0, supportTeacherId:null };
    const mode = row.mode || 'class';
    const isIndiv = mode === 'indiv';
    const isSplit = mode === 'split';
    const isClass = mode === 'class';

    // Nauczyciele prowadzący ten przedmiot w tej klasie
    const subjTchs = clsId
      ? teachers.filter(t=>(t.assignments||[]).some(a=>a.classId===clsId&&a.subjectId===subj.id))
      : teachers;

    // Helper: buduj select nauczyciela
    const tchSelect = (fieldName, selected, label, small=false) => {
      const relevant = subjTchs.length ? subjTchs : clsTchs;
      const others   = allTchs.filter(t=>!relevant.includes(t));
      return `<select class="mselect"
        style="font-size:.7rem;padding:3px 6px;${small?'min-width:110px':'min-width:130px'}"
        onchange="niSetField('${subj.id}','${fieldName}',this.value)"
        title="${escapeHtml(label)}">
        <option value="">— ${escapeHtml(label)} —</option>
        ${relevant.map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${escapeHtml(t.last)} ${escapeHtml(t.first)} (${escapeHtml(t.abbr)})</option>`).join('')}
        ${others.length?`<optgroup label="Inni nauczyciele">
          ${others.map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${escapeHtml(t.last)} ${escapeHtml(t.first)} (${escapeHtml(t.abbr)})</option>`).join('')}
        </optgroup>`:''}
      </select>`;
    };

    // Helper: input godzin
    const hrsInput = (fieldName, val, title) =>
      `<input type="number" min="0" max="30" value="${val||0}"
        style="width:40px;padding:3px 4px;border:1px solid var(--border);
               border-radius:5px;background:var(--s2);color:var(--text);
               font-size:.72rem;text-align:center"
        onchange="niSetField('${subj.id}','${fieldName}',parseInt(this.value)||0)"
        title="${escapeHtml(title)}">`;

    // Kolorystyka wiersza
    const bg = isIndiv ? 'var(--accent-g2)' : isSplit ? 'rgba(251,191,36,.06)' : 'var(--s2)';
    const border = isIndiv ? 'var(--accent)33' : isSplit ? 'rgba(251,191,36,.3)' : 'var(--border)';

    return `<div style="padding:8px 10px;background:${bg};
      border:1px solid ${border};border-radius:8px;margin-bottom:4px">

      <!-- Wiersz 1: przedmiot + przełącznik trybu -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:5px;min-width:120px;flex:1">
          <span style="width:8px;height:8px;border-radius:50%;
            background:${subj.color||'#888'};flex-shrink:0"></span>
          <span style="font-size:.8rem;font-weight:600">${subj.name}</span>
          <span style="font-size:.65rem;color:var(--text-d);font-family:var(--mono)">${subj.abbr||''}</span>
        </div>

        <!-- Trzyprzyciskowy przełącznik -->
        <div style="display:flex;border:1px solid var(--border);border-radius:7px;
          overflow:hidden;flex-shrink:0;font-size:.7rem">
          <button onclick="niSetMode('${subj.id}','class')"
            style="padding:4px 8px;border:none;cursor:pointer;font-weight:600;
                   background:${isClass?'var(--accent)':'var(--s3)'};
                   color:${isClass?'#fff':'var(--text-m)'}">
            🏫 Z klasą
          </button>
          <button onclick="niSetMode('${subj.id}','split')"
            style="padding:4px 8px;border:none;cursor:pointer;font-weight:600;
                   border-left:1px solid var(--border);border-right:1px solid var(--border);
                   background:${isSplit?'var(--yellow)':'var(--s3)'};
                   color:${isSplit?'#000':'var(--text-m)'}">
            ½ Podzielone
          </button>
          <button onclick="niSetMode('${subj.id}','indiv')"
            style="padding:4px 8px;border:none;cursor:pointer;font-weight:600;
                   background:${isIndiv?'var(--accent)':'var(--s3)'};
                   color:${isIndiv?'#fff':'var(--text-m)'}">
            👤 NI
          </button>
        </div>
      </div>

      <!-- Wiersz 2: szczegóły (zależne od trybu) -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;padding-top:6px;
        border-top:1px solid ${border};align-items:center;font-size:.7rem">

        ${isIndiv ? `
          <span style="color:var(--text-m)">Nauczyciel NI:</span>
          ${tchSelect('teacherId', row.teacherId, 'nauczyciel NI')}
          ${hrsInput('hours', row.hours||1, 'Godziny NI/tydz.')}
          <span style="color:var(--text-d)">h NI/tydz.</span>
        ` : ''}

        ${isSplit ? `
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <span style="color:var(--accent);font-weight:600">NI:</span>
            ${tchSelect('teacherId', row.teacherId, 'nauczyciel NI', true)}
            ${hrsInput('hours', row.hours||1, 'Godziny NI/tydz.')}
            <span style="color:var(--text-d)">h</span>
          </div>
          <span style="color:var(--text-d)">+</span>
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <span style="color:var(--text-m);font-weight:600">Z klasą:</span>
            ${hrsInput('hoursClass', row.hoursClass||1, 'Godziny z klasą/tydz.')}
            <span style="color:var(--text-d)">h</span>
          </div>
        ` : ''}

        ${isClass || isSplit ? `
          <div style="display:flex;align-items:center;gap:4px;margin-left:${isClass?0:8}px;
            padding-left:${isClass?0:8}px;${isSplit?'border-left:1px solid '+border:''}">
            <span style="color:var(--text-m)">Wspomagający:</span>
            ${tchSelect('supportTeacherId', row.supportTeacherId, 'naucz. wspomagający', true)}
            <span style="font-size:.62rem;color:var(--text-d)">(opcjonalnie)</span>
          </div>
        ` : ''}

      </div>
    </div>`;
  }).join('');
}


// ── Zmiana trybu przedmiotu ──
function niSetMode(subjId, mode) {
  let row = _niSubjRows.find(r=>r.subjId===subjId);
  if(!row) {
    row = {subjId, mode:'class', teacherId:null, hours:1, hoursClass:1, supportTeacherId:null};
    _niSubjRows.push(row);
  }
  row.mode = mode;
  // Defaults przy zmianie trybu
  if(mode==='indiv' && !row.hours) row.hours = 1;
  if(mode==='split' && !row.hours) row.hours = 1;
  if(mode==='split' && !row.hoursClass) row.hoursClass = 1;
  niReloadSubjTable();
  niEditSummary();
}

// Ustaw dowolne pole wiersza
function niSetField(subjId, field, value) {
  let row = _niSubjRows.find(r=>r.subjId===subjId);
  if(!row) { row = {subjId,mode:'class',teacherId:null,hours:1,hoursClass:0,supportTeacherId:null}; _niSubjRows.push(row); }
  row[field] = value || null;
  niEditSummary();
}

// Przeładuj tabelę (zachowaj select klasy)
function niReloadSubjTable() {
  const clsId   = document.getElementById('niStudClass').value;
  const cls      = clsId ? (appState.classes||[]).find(c=>c.id===clsId) : null;
  const subjects = sortSubjects(appState.subjects||[]);
  const teachers = sortTeachers(appState.teachers||[]);
  const clsSubjs = cls
    ? subjects.filter(s => !(s.classes||[]).length || (s.classes||[]).includes(clsId))
    : subjects;
  renderNISubjTable(clsSubjs, teachers);
}

// ── Podsumowanie edycji ──
function niEditSummary() {
  const el = document.getElementById('niEditSummary');
  if(!el) return;
  const indiv  = _niSubjRows.filter(r=>r.mode==='indiv');
  const split  = _niSubjRows.filter(r=>r.mode==='split');
  const cls    = _niSubjRows.filter(r=>r.mode==='class');
  const support= _niSubjRows.filter(r=>r.supportTeacherId);
  const hNI    = indiv.reduce((s,r)=>s+(r.hours||0),0)
               + split.reduce((s,r)=>s+(r.hours||0),0);
  const hCls   = split.reduce((s,r)=>s+(r.hoursClass||0),0);
  const noTch  = [...indiv,...split].filter(r=>!r.teacherId);

  const parts = [];
  if(indiv.length)   parts.push(`<span>👤 NI: <strong style="color:var(--accent)">${indiv.length}</strong> przedm. · ${hNI}h/tydz.</span>`);
  if(split.length)   parts.push(`<span>½ Podzielone: <strong style="color:var(--yellow)">${split.length}</strong> przedm. (${hNI}h NI + ${hCls}h z klasą)</span>`);
  if(cls.length)     parts.push(`<span>🏫 Z klasą: <strong>${cls.length}</strong> przedm.</span>`);
  if(support.length) parts.push(`<span style="color:var(--teal)">👥 Wspomagający: ${support.length} przedm.</span>`);
  if(noTch.length)   parts.push(`<span style="color:var(--red)">⚠ ${noTch.length} bez nauczyciela NI</span>`);

  el.innerHTML = `<div style="padding:8px 12px;background:var(--s2);border-radius:8px;
    font-size:.72rem;color:var(--text-m);display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
    ${parts.join('')}
  </div>`;
}

// ── Zapisz ucznia ──
function niSaveStudent() {
  const name = document.getElementById('niStudName').value.trim();
  if(!name) { notify('Podaj imię i nazwisko ucznia'); return; }

  const stud = {
    id: _niEditId || ('ni_' + Date.now() + Math.random().toString(36).slice(2,6)),
    name,
    classId:      document.getElementById('niStudClass').value || null,
    form:         document.getElementById('niStudForm').value,
    studentCount: parseInt(document.getElementById('niStudCount').value)||1,
    inPensum:     document.getElementById('niStudInPensum').checked,
    subjects:     _niSubjRows.map(r=>({
      subjId:           r.subjId,
      mode:             r.mode||'class',
      teacherId:        r.teacherId||null,
      hours:            r.hours||0,
      hoursClass:       r.hoursClass||0,
      supportTeacherId: r.supportTeacherId||null
    }))
  };

  niEnsureState();
  if(_niEditId) {
    const idx = appState.niStudents.findIndex(s=>s.id===_niEditId);
    if(idx>=0) appState.niStudents[idx] = stud;
  } else {
    appState.niStudents.push(stud);
  }

  // Synchronizuj z polami klas i nauczycieli których solver potrzebuje
  niSyncToAppState(stud);

  persistAll();
  closeNIEditModal();
  niRender();
  notify(_niEditId ? 'Zapisano zmiany' : 'Dodano ucznia NI: ' + name);
}

// ── Synchronizuj do appState (solver) ──
function niSyncToAppState(stud) {
  // Zaktualizuj grupy klasy (nie ma już indiv w grupach)
  if(stud.classId) {
    const cls = (appState.classes||[]).find(c=>c.id===stud.classId);
    if(cls) {
      cls.groups = (cls.groups||[]).filter(g=>g.type!=='indiv'||!g._niId||g._niId!==stud.id);
    }
  }
  // Synchronizuj niStudentSubjects do nauczycieli
  // (solver czyta appState.niStudents bezpośrednio)
}

// ── Usuń ucznia ──
function niDeleteStudent() {
  if(!_niEditId) return;
  const stud = appState.niStudents?.find(s=>s.id===_niEditId);
  if(!stud) return;
  if(!confirm(`Usunąć ucznia NI "${stud.name}"?`)) return;
  appState.niStudents = appState.niStudents.filter(s=>s.id!==_niEditId);
  persistAll();
  closeNIEditModal();
  niRender();
  notify('Usunięto ucznia NI');
}

// ── Zamknij klikając tło ──
document.getElementById('niModal').addEventListener('click', function(e){
  if(e.target===this) closeNIModal();
});
document.getElementById('niEditModal').addEventListener('click', function(e){
  if(e.target===this) closeNIEditModal();
});

// ── Aktualizuj badge NI w modalu nauczyciela ──
function niUpdateTeacherBadge(tchId) {
  if(!tchId || !appState?.niStudents) return;
  const box = document.getElementById('tmIndivSummaryBox');
  if(!box) return;
  const subjects = appState.subjects||[];
  const niRows = [];
  appState.niStudents.forEach(stud => {
    (stud.subjects||[]).filter(r=>r.mode==='indiv'&&r.teacherId===tchId).forEach(r=>{
      const subj = subjects.find(s=>s.id===r.subjId);
      niRows.push(`${stud.name} · ${subj?.abbr||'?'} · ${r.hours||1}h`);
    });
  });
  if(niRows.length) {
    box.style.display='';
    box.innerHTML = `<strong>👤 Ten nauczyciel prowadzi NI:</strong><br>` +
      niRows.map(r=>`<span style="font-size:.72rem;color:var(--text-m)">${r}</span>`).join('<br>');
  } else {
    box.style.display='none';
  }
}


// ================================================================
//  NI — SEKCJA W USTAWIENIACH
// ================================================================
function niSettingsSection() {
  if(!appState) return '';
  niEnsureState();
  const students  = appState.niStudents||[];
  const classes   = appState.classes||[];
  const subjects  = appState.subjects||[];
  const teachers  = appState.teachers||[];

  const totalHours = students.reduce((sum, s) =>
    sum + (s.subjects||[]).filter(r=>r.mode==='indiv').reduce((h,r)=>h+(r.hours||0),0), 0);

  let html = `<div class="settings-card" style="grid-column:1/-1">
    <div class="settings-card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>👤 Nauczanie indywidualne i zajęcia w małych grupach</span>
      <button class="mbtn mbtn-primary" style="padding:6px 14px;font-size:.75rem"
        onclick="openNIModal()">+ Dodaj ucznia NI</button>
    </div>
    <div style="font-size:.72rem;color:var(--text-m);margin-bottom:12px;line-height:1.5">
      Uczniowie realizujący część lub wszystkie przedmioty poza klasą
      (nauczanie indywidualne, rewalidacja, zajęcia grupowe do 5 os.).
      Solver traktuje każdego ucznia NI jak osobną wirtualną klasę
      i układa dla niego osobne sloty w planie.
    </div>`;

  if(!students.length) {
    html += `<div style="padding:24px;text-align:center;color:var(--text-d);
      border:1px dashed var(--border);border-radius:8px">
      <div style="font-size:1.6rem;margin-bottom:8px">👤</div>
      <div style="font-size:.82rem">Brak uczniów NI — kliknij "+ Dodaj ucznia NI"</div>
    </div>`;
  } else {
    html += `<div style="font-size:.72rem;color:var(--text-m);margin-bottom:10px">
      ${students.length} uczniów · ${totalHours} godz. NI/tydz.
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">`;

    students.forEach(stud => {
      const cls       = classes.find(c=>c.id===stud.classId);
      const indivRows = (stud.subjects||[]).filter(r=>r.mode==='indiv');
      const classRows = (stud.subjects||[]).filter(r=>r.mode==='class');
      const hours     = indivRows.reduce((s,r)=>s+(r.hours||0),0);

      const pensumBadge = stud.inPensum
        ? `<span style="font-size:.62rem;padding:1px 6px;border-radius:6px;background:var(--green)22;color:var(--green);border:1px solid var(--green)44;margin-left:4px">✓ w pensum</span>`
        : '';
      const indivChips = indivRows.map(r => {
        const s = subjects.find(s=>s.id===r.subjId);
        const t = r.teacherId ? teachers.find(t=>t.id===r.teacherId) : null;
        return `<span style="display:inline-flex;align-items:center;gap:3px;
          padding:2px 7px;border-radius:10px;font-size:.67rem;
          background:${s?.color||'#888'}22;border:1px solid ${s?.color||'#888'}44">
          <span style="width:6px;height:6px;border-radius:50%;
            background:${s?.color||'#888'};display:inline-block"></span>
          ${s?.abbr||'?'}${t?' · '+t.abbr:''}
          <span style="color:var(--text-d)">${r.hours||1}h</span>
        </span>`;
      }).join('');

      const classChips = classRows.map(r => {
        const s = subjects.find(s=>s.id===r.subjId);
        return `<span style="font-size:.65rem;color:var(--text-d);padding:1px 5px;
          border-radius:8px;background:var(--s3)">${escapeHtml(s?.abbr||'?')}</span>`;
      }).join(' ');

      html += `<div style="display:flex;align-items:flex-start;gap:10px;
        padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:.85rem">👤 ${escapeHtml(stud.name)}</span>
            ${cls?`<span style="font-size:.68rem;background:var(--s3);padding:1px 6px;
              border-radius:5px;color:var(--text-m)">${escapeHtml(cls.name)}</span>`:''}
            <span style="font-size:.68rem;color:var(--accent);font-family:var(--mono)">${hours}h NI/tydz.</span>
            ${pensumBadge}
          </div>
          ${indivChips?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px">
            <span style="font-size:.62rem;color:var(--text-d)">NI:</span>${indivChips}
          </div>`:''}
          ${classChips?`<div>
            <span style="font-size:.62rem;color:var(--text-d)">Z klasą:</span> ${classChips}
          </div>`:''}
        </div>
        <button onclick="niOpenEdit('${stud.id}')"
          style="flex-shrink:0;padding:4px 10px;border-radius:6px;
            border:1px solid var(--border);background:transparent;
            color:var(--text-m);font-family:var(--font);font-size:.7rem;cursor:pointer">
          Edytuj
        </button>
      </div>`;
    });

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}


// ── Drukuj plan ucznia NI ──
function doPrintNI(studId) {
  closePrintPanel();
  if(!appState) return;
  const stud    = (appState.niStudents||[]).find(s=>s.id===studId);
  if(!stud) return;
  const cls     = stud.classId ? appState.classes.find(c=>c.id===stud.classId) : null;
  const hours   = appState.hours||[];
  const subjects= appState.subjects||[];
  const teachers= appState.teachers||[];
  const DAYS    = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];

  // Zbierz przedmioty NI i ich nauczycieli
  const niMap = {}; // subjId → {tch, hours}
  (stud.subjects||[]).forEach(r => {
    if((r.mode==='indiv'||r.mode==='split') && r.teacherId) {
      const tch = teachers.find(t=>t.id===r.teacherId);
      niMap[r.subjId] = { tch, hoursNI: r.hours||0, hoursClass: r.hoursClass||0, mode: r.mode };
    }
    if(r.supportTeacherId) {
      if(!niMap[r.subjId]) niMap[r.subjId] = {};
      niMap[r.subjId].suppTch = teachers.find(t=>t.id===r.supportTeacherId);
    }
  });

  // Pobierz plan klasy (schedData)
  const clsSchedule = {}; // 'di_hn' → lesson
  if(stud.classId) {
    Object.entries(schedData).forEach(([k,v]) => {
      const parts = k.split('_');
      if(parts[0]===stud.classId) {
        clsSchedule[parts[1]+'_'+parts[2]] = v;
      }
    });
  }

  // Buduj tabelę HTML
  let table = `<table style="border-collapse:collapse;width:100%;font-size:.78rem">
    <thead><tr>
      <th style="border:1px solid #ccc;padding:5px 8px;background:#f5f5f5;min-width:50px">Godz.</th>
      ${DAYS.map(d=>`<th style="border:1px solid #ccc;padding:5px 8px;background:#f5f5f5">${d}</th>`).join('')}
    </tr></thead><tbody>`;

  hours.forEach(h => {
    table += `<tr><td style="border:1px solid #ccc;padding:4px 6px;text-align:center;
      background:#f9f9f9;font-size:.7rem">${h.num}<br><span style="color:#888">${h.start}</span></td>`;

    for(let di=0; di<5; di++) {
      const key = di+'_'+h.num;
      const lesson = clsSchedule[key];

      if(!lesson) {
        table += `<td style="border:1px solid #ccc;padding:4px"></td>`;
        continue;
      }

      const subj = lesson.subjectId ? subjects.find(s=>s.id===lesson.subjectId) : null;
      const tch  = lesson.teacherId ? teachers.find(t=>t.id===lesson.teacherId) : null;
      const niInfo = subj ? niMap[subj.id] : null;

      let cellBg = '#fff';
      let cellBorder = '1px solid #ccc';
      let modeLabel = '';
      let extraInfo = '';

      if(niInfo && (niInfo.mode==='indiv' || niInfo.mode==='split')) {
        // Ten przedmiot uczeń może mieć w NI lub z klasą (split)
        if(niInfo.mode==='indiv') {
          // Całkowicie NI — uczeń NIE jest na tej lekcji z klasą
          cellBg = '#e8f4fd';
          cellBorder = '2px solid #0284c7';
          modeLabel = `<div style="font-size:.6rem;color:#0284c7;font-weight:700">👤 NI</div>`;
          extraInfo = niInfo.tch
            ? `<div style="font-size:.62rem;color:#555">${niInfo.tch.abbr}</div>` : '';
        } else {
          // Split — część NI, część z klasą
          cellBg = '#fffbeb';
          cellBorder = '2px solid #d97706';
          modeLabel = `<div style="font-size:.6rem;color:#d97706;font-weight:700">½ NI+klasa</div>`;
          extraInfo = niInfo.tch
            ? `<div style="font-size:.62rem;color:#555">NI: ${niInfo.tch.abbr}</div>` : '';
        }
      } else {
        // Z klasą normalnie
        cellBg = '#fff';
        if(niInfo?.suppTch) {
          // Ma nauczyciela wspomagającego na tej lekcji
          cellBg = '#f0fdf4';
          cellBorder = '1px solid #059669';
          extraInfo = `<div style="font-size:.62rem;color:#059669">+${niInfo.suppTch.abbr} (W)</div>`;
        }
        modeLabel = `<div style="font-size:.6rem;color:#888">🏫 z kl.</div>`;
      }

      const color = subj?.color||'#888';
      table += `<td style="border:${cellBorder};padding:4px 5px;background:${cellBg};vertical-align:top">
        <div style="font-size:.72rem;font-weight:700;color:${color}">${subj?.abbr||'?'}</div>
        ${tch?`<div style="font-size:.62rem;color:#555">${tch.abbr}</div>`:''}
        ${modeLabel}
        ${extraInfo}
      </td>`;
    }
    table += '</tr>';
  });
  table += '</tbody></table>';

  // Legenda
  const legend = `<div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:.7rem;color:#555">
    <span><span style="display:inline-block;width:12px;height:12px;background:#e8f4fd;border:2px solid #0284c7;vertical-align:middle"></span> Zajęcia indywidualne (NI)</span>
    <span><span style="display:inline-block;width:12px;height:12px;background:#fffbeb;border:2px solid #d97706;vertical-align:middle"></span> Podzielone (część NI, część z klasą)</span>
    <span><span style="display:inline-block;width:12px;height:12px;background:#f0fdf4;border:1px solid #059669;vertical-align:middle"></span> Z klasą + nauczyciel wspomagający (W)</span>
    <span style="background:#fff;border:1px solid #ccc;padding:0 4px">Z klasą normalnie</span>
  </div>`;

  // NI subjects info
  const niSubjList = (stud.subjects||[]).filter(r=>r.mode==='indiv'||r.mode==='split').map(r=>{
    const subj = subjects.find(s=>s.id===r.subjId);
    const tch  = r.teacherId ? teachers.find(t=>t.id===r.teacherId) : null;
    return `<li>${escapeHtml(subj?.name||'?')}: ${r.hours||0}h NI/tydz.${tch?' — '+escapeHtml(tch.last)+' '+escapeHtml(tch.first):''}
      ${r.mode==='split'?' + '+(r.hoursClass||0)+'h z klasą':''}</li>`;
  }).join('');

  // Otwórz okno druku
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Plan NI — ${escapeHtml(stud.name)}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:16px;color:#222}
      h1{font-size:1rem;margin-bottom:4px}
      h2{font-size:.85rem;color:#555;font-weight:normal;margin-bottom:12px}
      @page{margin:1cm;size:A4 landscape}
      @media print{body{padding:0}}
    </style>
  </head><body>
    <h1>Plan ucznia: ${escapeHtml(stud.name)}</h1>
    <h2>${cls?'Klasa: '+escapeHtml(cls.name)+' · ':''}Forma: ${escapeHtml(stud.form||'NI')}
      · Rok szkolny: ${appState.schoolYear||appState.year||''}</h2>
    ${niSubjList ? `<ul style="font-size:.72rem;color:#555;margin-bottom:10px">${niSubjList}</ul>` : ''}
    ${table}
    ${legend}
  </body></html>`);
  win.document.close();
  setTimeout(()=>win.print(), 400);
}

// ================================================================
//  BOOT
// ================================================================
init();

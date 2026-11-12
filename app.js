(() => {
  'use strict';
  const $=id=>document.getElementById(id), T=DuckTournament, A=DuckArt, S=DuckSeasons, C=DuckChaosEngine, C2=DuckChaosEngineV2, C3=DuckChaosEngineV3, SOUND_KEY='vit-dua-sound';
  // Saved races replay with the engine version they were started on.
  const ENGINES={[C.version]:C,[C2.version]:C2,[C3.version]:C3}, engineFor=version=>Object.hasOwn(ENGINES,version)?ENGINES[version]:null;
  let bannerUntil=0; // race-clock time the twist banner hides; pausing freezes it
  // Slow motion: each twist plays SLOWMO_WINDOW race-seconds over slowmoMs() of real time.
  // Only the display clock slows; the simulated result never changes.
  // slowmoUntil is on the race clock, so pausing keeps the remaining slow motion.
  // Default ("fast effects"): the camera snaps in, a hit freezes for HIT_STOP_MS, and the twist plays
  // over 1.2 s before the camera pulls back out. "Slow effects" (opt-in, for Teams screen sharing that
  // drops frames) stretches it to 3 s with no zoom, shake or hit-stop and a lighter effects canvas.
  const SLOWMO_WINDOW=.27, SLOW_FX_KEY='vit-dua-slow-fx', HIT_STOP_MS=110;
  // Slow effects by default (screen sharing lags); only an explicit '0' keeps fast effects.
  let slowFx=(()=>{try{return localStorage.getItem(SLOW_FX_KEY)!=='0';}catch{return true;}})(), hitStop=0;
  const slowmoMs=()=>slowFx?3000:1200, slowmoRate=()=>SLOWMO_WINDOW*1000/slowmoMs();
  // New days race at least this long so every twist has room to play out (older days keep their length).
  const MIN_RACE_SECONDS=40;let slowmoUntil=0;
  // Photo finish: when the runner-up ends within PHOTO_GAP of the line, the last
  // PHOTO_WINDOW race-seconds play at PHOTO_RATE with the camera on the finish line.
  const PHOTO_GAP=.015, PHOTO_WINDOW=1.2, PHOTO_RATE=.3;let photoFinish=false, photoActive=false;
  const KEY='vit-dua-seasons-v3', LEGACY_KEY='vit-dua-club-v2';
  let store={version:3,currentId:null,currentSeasonId:null,seasons:[],sessions:[]}, current=null, selected=null, setupMode='season', starArmed=false;
  let race=null, phase='idle', raf=null, lastTime=0, lastSaved=0, nodes=[], runwayWidth=0;
  let audio=null, sound=soundPref(), lastTick=-1, sprintAnnounced=false, leadersKey='', toastTimer;
  let dialogAction=()=>{}, storageBlocked=false;
  let eventCursor=0, runeMarkerKey='', skillNodes=[];
  let visuals=null, racerViews=[], owners=[], currentSample=[], checkpoint=null, runeSpawns=[], lastTimerText='', lastSprintState=false;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const node=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const dateLabel=value=>value.split('-').reverse().join('/');
  const clock=seconds=>{const n=Math.max(0,Math.ceil(seconds));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
  const money=n=>`${new Intl.NumberFormat('vi-VN').format(n)}đ`;
  const seasonDays=season=>store.sessions.filter(e=>e.seasonId===season.id).map(e=>e.session);
  const currentSeason=()=>store.seasons.find(s=>s.id===current?.seasonId)||null;
  const openSeason=()=>store.seasons.find(s=>!s.closedAt)||null;
  const seasonView=()=>store.seasons.find(s=>s.id===store.currentSeasonId)||currentSeason();
  const queue=()=>T.selectionState(current.session,current.type,current.picks);
  const isLegacy=()=>current?.session.version===2;
  const starsOf=()=>current?.stars||[];
  // ⭐×2 when the star doubled the round, ⭐ when it was played without doubling.
  const starMark=(entry,count)=>entry.star?(entry.points!==count-entry.rank+1?' ⭐×2':' ⭐'):'';
  const amountFor=id=>outcome().contributions?.find(c=>c.playerId===id)?.amount||0;
  const contributionLabel=id=>isLegacy()?(outcome().coffeeIds.includes(id)?'☕ Bao cà phê':'—'):(amountFor(id)?money(amountFor(id)):'—');
  const playerName=id=>current.session.players.find(p=>p.id===id)?.name||'—';
  const outcome=()=>T.coffeeStatus(current.session);
  function participants(envelope=current){
    if(envelope.type!=='tie')return envelope.session.players;
    const status=T.coffeeStatus(envelope.session);
    const ids=status.status==='tie'?status.tiedIds:(envelope.session.tiebreaks.at(-1)?.entries.map(e=>e.playerId)||[]);
    return envelope.session.players.filter(p=>ids.includes(p.id));
  }
  function toast(message,ms=4000){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},ms);}
  function warning(message){$('storage-warning').textContent=message;$('storage-warning').hidden=false;}
  function writeSaved(json){try{localStorage.setItem(KEY,json);}catch{warning('Không thể lưu tiến trình vào trình duyệt. Hãy giữ trang mở và tải bảng điểm CSV sau khi chơi.');}}
  function save(){checkpoint=null;if(storageBlocked)return;writeSaved(JSON.stringify(store));}
  function saveCheckpoint(){
    if(storageBlocked)return;
    const active=current?.active;if(!active){save();return;}
    if(!checkpoint||checkpoint.current!==current||checkpoint.active!==active){
      // Serialize immutable season/history only once per race. Keys and values
      // are encoded independently: player text can never collide with a marker.
      const sessionIndex=store.sessions.indexOf(current),fields=Object.entries(current),activeIndex=fields.findIndex(([key])=>key==='active');
      if(sessionIndex<0||activeIndex<0){save();return;}
      const field=([key,value])=>`${JSON.stringify(key)}:${JSON.stringify(value)}`;
      const rootFields=Object.entries(store).filter(([key])=>key!=='sessions').map(field);
      const beforeSessions=store.sessions.slice(0,sessionIndex).map(s=>JSON.stringify(s));
      const afterSessions=store.sessions.slice(sessionIndex+1).map(s=>JSON.stringify(s));
      const beforeFields=fields.slice(0,activeIndex).map(field),afterFields=fields.slice(activeIndex+1).map(field);
      checkpoint={current,active,
        prefix:`{${rootFields.join(',')},"sessions":[${beforeSessions.length?beforeSessions.join(',')+',':''}{${beforeFields.length?beforeFields.join(',')+',':''}"active":`,
        suffix:`${afterFields.length?','+afterFields.join(','):''}}${afterSessions.length?','+afterSessions.join(','):''}]}`};
    }
    writeSaved(checkpoint.prefix+JSON.stringify(active)+checkpoint.suffix);
  }
  // chaos-v3 lineup: one skill and one trait per duck, dealt before the picks and shown on the duck cards.
  const lineupOk=(l,count)=>!!l&&typeof l==='object'&&['skills','traits'].every(k=>Array.isArray(l[k])&&l[k].length===count)&&l.skills.every(id=>C3.skills.some(s=>s.id===id))&&l.traits.every(id=>C3.traits.some(t=>t.id===id))
    &&(l.luck===undefined||Array.isArray(l.luck)&&l.luck.length===count&&l.luck.every(v=>Number.isInteger(v)&&v>=0&&v<=3))&&(l.rule===undefined||!!dayRuleOf(l.rule));
  const plainLineup=l=>({skills:[...l.skills],traits:[...l.traits],...(l.luck?{luck:[...l.luck]}:{}),...(l.rule?{rule:l.rule}:{})});
  // Day rule: drawn once per new race day, applied to every race of that day (old days have none).
  const dayRuleOf=id=>C3.dayRules.find(r=>r.id===id);
  const drawDayRule=()=>C3.dayRules[crypto.getRandomValues(new Uint32Array(1))[0]%C3.dayRules.length].id;
  // Comeback luck for the players trailing the day's standings (regular rounds only), per duck they picked.
  const luckOf=()=>current&&current.type==='regular'&&!isLegacy()?T.luckLevels(current.session):{};
  // Luck works for the whole trailing half, but only the player(s) dead last get the visible clover.
  const lastPlaceIds=()=>{if(!current||current.type!=='regular'||isLegacy()||!current.session.rounds.length)return new Set();const table=T.standings(current.session),worst=Math.max(...table.map(r=>r.rank));return new Set(table.filter(r=>r.rank===worst).map(r=>r.playerId));};
  const luckByDuck=()=>{const levels=luckOf(),out=participants().map(()=>0);for(const [id,duck] of Object.entries(current.picks))out[duck]=levels[id]||0;return out;};
  const skillOf=id=>C3.skills.find(s=>s.id===id), traitOf=id=>C3.traits.find(t=>t.id===id);
  function ensureLineup(){
    if(!current||current.active||current.stage!=='picking'||isLegacy())return;
    if(!lineupOk(current.lineup,participants().length)){current.lineup=plainLineup(C3.deal(participants().length));save();}
  }
  function validateEnvelope(raw){
    if(!raw||!['regular','tie'].includes(raw.type)||!['picking','result','complete'].includes(raw.stage))throw Error('Trạng thái giải không hợp lệ.');
    const clean={seasonId:raw.seasonId??null,session:T.validateSession(raw.session),type:raw.type,stage:raw.stage,picks:{},active:null,raceReplays:[]};
    const players=participants(clean), ids=new Set(players.map(p=>p.id)), chosen=new Set();
    if(!raw.picks||typeof raw.picks!=='object'||Array.isArray(raw.picks))throw Error('Lựa chọn đã lưu không hợp lệ.');
    for(const [id,duck] of Object.entries(raw.picks)){if(!ids.has(id)||!Number.isInteger(duck)||duck<0||duck>=players.length||chosen.has(duck))throw Error('Lựa chọn đã lưu không hợp lệ.');clean.picks[id]=duck;chosen.add(duck);}
    const stars=raw.stars===undefined?[]:raw.stars;
    if(!Array.isArray(stars)||new Set(stars).size!==stars.length||stars.some(id=>typeof id!=='string'||!Object.hasOwn(clean.picks,id)||!T.starAvailable(clean.session,id))||(stars.length&&(clean.type!=='regular'||clean.stage!=='picking')))throw Error('Ngôi sao hy vọng đã lưu không hợp lệ.');
    if(stars.length)clean.stars=[...stars]; // ponytail: absent means none, so old saves keep their exact shape
    if(raw.rule!==undefined){if(!dayRuleOf(raw.rule)||clean.session.version===2)throw Error('Luật của ngày không hợp lệ.');clean.rule=raw.rule;}
    if(clean.stage==='picking'&&lineupOk(raw.lineup,players.length))clean.lineup=plainLineup(raw.lineup); // invalid or missing: dealt again
    if(raw.active){const a=raw.active;T.validatePicks(players,clean.picks);if(clean.stage!=='picking'||!Number.isInteger(a.seed)||a.seed<0||a.seed>4294967295||typeof a.id!=='string'||!a.id||a.id.length>128||!Number.isFinite(a.elapsed)||a.elapsed<0||a.elapsed>clean.session.duration||!Number.isFinite(a.countdownLeft)||a.countdownLeft<0||a.countdownLeft>3)throw Error('Lượt đang đua không hợp lệ.');if(clean.type==='regular'&&clean.session.rounds.length>=clean.session.roundLimit)throw Error('Lượt đã hoàn tất.');if(clean.type==='tie'&&T.coffeeStatus(clean.session).status!=='tie')throw Error('Lượt phụ không hợp lệ.');if([...clean.session.rounds,...clean.session.tiebreaks].some(r=>r.id===a.id))throw Error('Lượt bị trùng.');clean.active={id:a.id,seed:a.seed,elapsed:a.elapsed,countdownLeft:a.countdownLeft};}
    if(raw.active?.engine!==undefined){if(!engineFor(raw.active.engine))throw Error('Phiên bản cuộc đua chưa được hỗ trợ.');clean.active.engine=raw.active.engine;}
    if(raw.active?.lineup!==undefined){if(!lineupOk(raw.active.lineup,players.length))throw Error('Đội hình skill của lượt đang đua không hợp lệ.');clean.active.lineup=plainLineup(raw.active.lineup);}
    const recordSizes=new Map([...clean.session.rounds,...clean.session.tiebreaks].map(r=>[r.id,r.entries.length])),records=new Set(recordSizes.keys());
    if(Array.isArray(raw.raceReplays)){const seen=new Set();for(const r of raw.raceReplays){if(r&&records.has(r.id)&&!seen.has(r.id)&&engineFor(r.engine)&&Number.isInteger(r.seed)&&r.seed>=0&&r.seed<=4294967295&&(r.lineup===undefined||lineupOk(r.lineup,recordSizes.get(r.id)))){clean.raceReplays.push({id:r.id,seed:r.seed,engine:r.engine,...(r.lineup?{lineup:plainLineup(r.lineup)}:{})});seen.add(r.id);}}}
    if(clean.stage==='picking')T.selectionState(clean.session,clean.type,clean.picks);
    return clean;
  }
  function load(){
    try{
      const raw=localStorage.getItem(KEY), legacy=raw?null:localStorage.getItem(LEGACY_KEY);if(!raw&&!legacy)return;
      const saved=JSON.parse(raw||legacy);
      if(!Array.isArray(saved.sessions)||(raw?saved.version!==3||!Array.isArray(saved.seasons):saved.version!==2))throw Error('Định dạng lưu không hợp lệ.');
      const sessions=saved.sessions.map(e=>validateEnvelope(raw?e:{...e,seasonId:null}));
      if(new Set(sessions.map(e=>e.session.id)).size!==sessions.length)throw Error('Trùng ngày đua.');
      const seasons=raw?saved.seasons.map(s=>S.validateSeason(s,sessions.filter(e=>e.seasonId===s.id).map(e=>e.session))):[];
      if(new Set(seasons.map(s=>s.id)).size!==seasons.length||seasons.filter(s=>!s.closedAt).length>1)throw Error('Danh sách mùa giải không hợp lệ.');
      for(const e of sessions){if(e.session.version!==2&&!seasons.some(s=>s.id===e.seasonId))throw Error('Ngày đua thiếu mùa giải.');if(e.session.version===2&&e.seasonId!==null)throw Error('Không gán tiền hồi tố cho dữ liệu cũ.');}
      store={version:3,currentId:saved.currentId,currentSeasonId:raw?saved.currentSeasonId:null,seasons,sessions};
      current=sessions.find(e=>e.session.id===store.currentId)||sessions.at(-1)||null;if(current){store.currentId=current.session.id;store.currentSeasonId=current.seasonId;}
      if(legacy)save();
    }catch{storageBlocked=true;warning('Không đọc được dữ liệu đã lưu. Bản cũ được giữ nguyên; phiên này không ghi đè dữ liệu. Bạn vẫn có thể tạo mùa để chơi thử và tải CSV.');}
  }
  function close(id){if($(id).open)$(id).close();}
  function open(id){if(!$(id).open)$(id).showModal();}
  function setSlowFx(){$('slow-fx').setAttribute('aria-pressed',String(slowFx));$('slow-fx').querySelector('span').textContent=slowFx?'🐢 Hiệu ứng chậm':'⚡ Hiệu ứng nhanh';$('slow-fx').title=slowFx?'Đang chiếu chậm từng pha 3 giây, không zoom (hợp khi share Teams bị giật). Bấm để về hiệu ứng nhanh.':'Đang zoom nhanh, khựng hình, chiếu chậm 1,2 giây mỗi pha. Bấm để chiếu chậm 3 giây không zoom (hợp khi share Teams bị giật).';document.documentElement.style.setProperty('--fx-time',`${slowmoMs()/1000}s`);}
  function setSound(){const span=$('sound').querySelector('span');span.textContent=sound?'Âm thanh bật':'Âm thanh tắt';$('sound').setAttribute('aria-pressed',String(sound));$('sound').setAttribute('aria-label',sound?'Tắt âm thanh':'Bật âm thanh');}
  function activateAudio(){if(!sound)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});}catch{sound=false;setSound();toast('Trình duyệt chưa hỗ trợ âm thanh.');}}
  function tone(f,d=.12,delay=0){if(!sound||!audio||audio.state!=='running')return;const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+delay;o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.10,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+d+.02);o.onended=()=>{o.disconnect();g.disconnect();};}
  function stop(){if(raf!==null)cancelAnimationFrame(raf);raf=null;}
  function schedule(){raf=requestAnimationFrame(frame);}
  function clearRace(){stop();visuals?.destroy();visuals=null;race=null;phase='idle';eventCursor=0;runeMarkerKey='';skillNodes=[];racerViews=[];currentSample=[];checkpoint=null;lastTimerText='';lastSprintState=false;$('river').classList.remove('is-running');$('race-overlay').hidden=true;$('timer').classList.remove('sprint');$('skill-reveal').replaceChildren();$('event-history').replaceChildren();$('event-feed').replaceChildren();}

  function render(){
    if(!current)return;
    const s=current.session, players=participants(), active=!!current.active, picking=current.stage==='picking'&&!active&&!currentSeason()?.closedAt, status=outcome();
    document.body.classList.toggle('race-active',active);
    const round=Math.min(s.rounds.length+(current.stage==='picking'?1:0),s.roundLimit)||1;
    $('session-heading').textContent=`${isLegacy()?'Lịch sử cũ':'Ngày đua'} · ${dateLabel(s.date)}`;
    $('session-meta').textContent=`${s.players.length} người · ${s.duration} giây/vòng · ${s.roundLimit} vòng · ${isLegacy()?'Giữ luật cà phê cũ, không tính quỹ':'Chót 60.000đ · Kế chót 40.000đ'}`;
    const rule=!isLegacy()&&dayRuleOf(current.rule);$('day-rule').hidden=!rule;if(rule)$('day-rule').textContent=`${rule.icon} Luật hôm nay: ${rule.name} · ${rule.description}`;
    $('round-caption').textContent=current.type==='tie'?'LƯỢT PHÂN ĐỊNH':'LƯỢT ĐUA';
    $('round-number').replaceChildren(node('span','',current.type==='tie'?'⚖':String(round).padStart(2,'0')),node('small','',current.type==='tie'?' không cộng điểm':` / ${s.roundLimit}`));
    $('round-progress').replaceChildren(...Array.from({length:s.roundLimit},(_,i)=>{const b=node('button',i<s.rounds.length?'done':i===s.rounds.length?'current':'',i<s.rounds.length?`✓ ${i+1}`:String(i+1));b.disabled=i>=s.rounds.length||active;b.setAttribute('aria-label',`Lượt ${i+1}${i<s.rounds.length?' — xem kết quả':''}`);b.onclick=()=>showRound(s.rounds[i],'regular',false);return b;}));
    const chosen=Object.keys(current.picks).length, order=T.selectionOrder(s,current.type), orderedPlayers=order.map(id=>players.find(p=>p.id===id)).filter(Boolean);
    selected=picking?queue().nextPlayerId:null;
    $('pick-count').textContent=`${chosen}/${players.length} đã chọn`;
    $('pick-help').textContent=s.rounds.length?'Chót vòng trước chọn trước → về nhất chọn cuối.':'Vòng đầu ngày: chọn lần lượt theo danh sách.';
    $('players').replaceChildren(...orderedPlayers.map((p,index)=>{
      const duck=current.picks[p.id], b=node('button',`player${p.id===selected&&picking?' selected':''}${duck!==undefined?' chosen':''}`);b.dataset.playerId=p.id;b.disabled=!picking||p.id!==selected;b.setAttribute('aria-pressed',String(p.id===selected));
      const luck=lastPlaceIds().has(p.id)?luckOf()[p.id]||0:0;
      const info=node('span','player-info');info.append(node('span','player-name',`${index+1}. ${p.name}${starsOf().includes(p.id)?' ⭐':''}${luck?` ${'🍀'.repeat(luck)}`:''}`),node('span','player-duck',duck===undefined?(p.id===selected?'Đến lượt chọn vịt':`Chờ lượt chọn ${index+1}`):`#${duck+1} · ${A.name(duck)}`));if(s.version>=4&&!T.starAvailable(s,p.id))info.append(node('span','star-used','☆ đã dùng sao'));b.append(node('span','avatar',p.name.split(/\s+/).map(n=>Array.from(n)[0]).slice(-2).join('')),info,node('span','player-check',duck===undefined?(p.id===selected?'→':'…'):'✓'));b.onclick=()=>{if(!current.active&&current.stage==='picking'&&p.id===queue().nextPlayerId)focusDuck();};return b;
    }));
    $('selected-player').textContent=players.find(p=>p.id===selected)?.name||(chosen===players.length?'Cả hội đã chọn xong':'—');
    $('selection-hint').textContent=picking&&selected?`Lượt chọn ${chosen+1}/${players.length}`:'Đội hình đã chốt';
    const starOpen=picking&&!!selected&&current.type==='regular'&&T.starAvailable(s,selected);if(!starOpen)starArmed=false;
    const starForced=starOpen&&T.starForced(s,selected);if(starForced)starArmed=true;
    $('star-toggle').hidden=!starOpen;$('star-toggle').disabled=starForced;$('star-toggle').setAttribute('aria-pressed',String(starArmed));$('star-toggle').textContent=starForced?'⭐ Vòng cuối: bắt buộc dùng sao':starArmed?'⭐ Sao đang bật cho lượt này':'☆ Dùng sao lượt này';
    ensureLineup();
    $('duck-grid').replaceChildren(...players.map((_,id)=>{
      const owner=players.find(p=>current.picks[p.id]===id);
      const b=node('button',`duck-card${owner?' claimed':''}`);b.dataset.duckId=String(id);b.disabled=!picking||!!owner||!selected;b.setAttribute('aria-label',`${A.name(id)} số ${id+1}${owner?` — ${owner.name} đã chọn`:' — còn trống'}`);b.setAttribute('aria-pressed',String(!!owner));
      const art=node('span');art.innerHTML=A.svg(id);b.append(node('span','duck-number',`#${String(id+1).padStart(2,'0')}`),art,node('strong','',A.name(id)),node('small','',owner?`${owner.name} ✓`:'Chọn vịt này'));
      const sk=!isLegacy()&&current.lineup&&skillOf(current.lineup.skills[id]),tr=sk&&traitOf(current.lineup.traits[id]);
      if(sk){b.append(node('small','skill-tag',`${sk.icon} ${sk.name}`),node('small','skill-detail',sk.description),node('small','talent-tag',`${tr.icon} ${tr.name}`),node('small','talent-detail',tr.description));b.setAttribute('aria-label',`${b.getAttribute('aria-label')} · Skill ${sk.name}: ${sk.description} · Đặc tính ${tr.name}: ${tr.description}`);}
      b.onclick=()=>pick(id);return b;
    }));
    $('random-picks').disabled=!picking||chosen===players.length;
    $('undo-last-pick').disabled=!picking||chosen===0;
    $('new-game').disabled=active||!!openSeason();$('new-game').title=openSeason()?'Chốt mùa hiện tại trước khi tạo mùa mới.':'';$('saved-games').disabled=active;
    $('start').hidden=!picking;$('start').disabled=chosen!==players.length;
    $('start').textContent=current.type==='tie'?'Xuất phát đua phụ ↗':`Xuất phát lượt ${s.rounds.length+1} ↗`;
    $('pause').hidden=!active;$('pause').disabled=phase==='countdown';$('pause').textContent=phase==='paused'?'▶ Tiếp tục':'Ⅱ Tạm dừng';
    $('next').hidden=current.stage==='picking';$('next').textContent=nextLabel();
    $('selection').hidden=active;$('track').hidden=!active;
    if(!active){$('timer').textContent=clock(s.duration);$('arena-label').textContent=current.type==='tie'?'ĐUA PHỤ · KHÔNG CỘNG ĐIỂM':'CHỌN THEO THỨ TỰ ƯU TIÊN';$('arena-title').textContent=current.stage==='complete'?'Ngày đua đã chốt!':picking?(current.type==='tie'?'Một lượt quyết định!':'Đội hình đang chờ!'):'Đã chốt kết quả lượt này';$('race-status').textContent=picking?(chosen===players.length?'Đủ đội hình. Cả hội sẵn sàng chưa?':`Đến lượt ${playerName(selected)} chọn vịt.`):'Điểm đã được cộng và lưu. Xem kết quả hoặc tiếp tục.';}
    renderStandings();renderHistory();renderSeason();
    $('coffee-banner').hidden=status.status==='pending';
    if(status.status==='resolved'){$('coffee-names').textContent=status.coffeeIds.map(id=>`${playerName(id)}${isLegacy()?'':` · ${money(amountFor(id))}`}`).join('  &  ');$('coffee-description').textContent=isLegacy()?'Kết quả luật cà phê cũ — không tính khoản đóng quỹ.':'Đã ghi nhận 100.000đ phải đóng vào quỹ mùa. Vào Quỹ mùa giải để đánh dấu khoản đã thu.';$('final-summary').textContent='Xem tổng kết ngày ↗';}
    else if(status.status==='tie'){$('coffee-names').textContent='Đồng điểm! Thêm một lượt phân định.';$('coffee-description').textContent=`${status.tiedIds.map(playerName).join(', ')} đua phụ để phân định vị trí cuối${isLegacy()?'':' và khoản 60k / 40k'}. Tổng điểm giữ nguyên.`;$('final-summary').textContent='Chọn vịt đua phụ →';}
    $('final-summary').disabled=active;
  }
  function renderStandings(){
    const table=T.standings(current.session), status=outcome();
    $('standings').replaceChildren(...table.map(row=>{const e=node('div',`standing${status.coffeeIds.includes(row.playerId)?' coffee':''}`);e.append(node('span','standing-position',status.coffeeIds.includes(row.playerId)?'🪙':`#${row.rank}`),node('span','standing-name',row.name),node('strong','standing-total',row.total),node('small','', 'điểm'));return e;}));
    $('scored-rounds').textContent=`${current.session.rounds.length} lượt`;$('first-points').textContent=current.session.players.length;$('export').disabled=current.session.rounds.length===0;
  }
  function renderHistory(){
    const regular=current.session.rounds.map(r=>({r,type:'regular'})), ties=current.session.tiebreaks.map(r=>({r,type:'tie'}));
    const records=[...regular,...ties];
    $('round-history').replaceChildren(...(records.length?records.map(({r,type})=>{const b=node('button','history-card'),winner=r.entries[0];b.disabled=!!current.active;b.append(node('span','',type==='tie'?'⚖ LƯỢT PHÂN ĐỊNH':`VÒNG ${String(r.number).padStart(2,'0')}`),node('strong','',`🥇 ${playerName(winner.playerId)}`),node('small','',`${A.name(winner.duckId)}${type==='regular'?` · +${winner.points} điểm`:' · Không cộng điểm'}`));b.onclick=()=>showRound(r,type,false);return b;}):[node('p','empty','Chưa có vòng đua nào. Cả hội sẵn sàng chưa?')]));
  }
  function focusDuck(id){const target=id===undefined?null:$('duck-grid').querySelector(`[data-duck-id="${id}"]:not(:disabled)`);(target||$('duck-grid').querySelector('button:not(:disabled)'))?.focus({preventScroll:true});}
  function pick(duck){if(!current||current.active||current.stage!=='picking'||currentSeason()?.closedAt)return;const players=participants(),nextId=queue().nextPlayerId;if(!nextId||!Number.isInteger(duck)||duck<0||duck>=players.length||Object.values(current.picks).includes(duck))return;current.picks[nextId]=duck;if((starArmed||T.starForced(current.session,nextId))&&current.type==='regular'&&T.starAvailable(current.session,nextId))current.stars=[...starsOf(),nextId];starArmed=false;save();render();if(Object.keys(current.picks).length===players.length)$('start').focus({preventScroll:true});else focusDuck();}
  function undoPick(){if(!current||current.active||current.stage!=='picking'||currentSeason()?.closedAt)return;const last=queue().order.filter(id=>current.picks[id]!==undefined).at(-1);if(!last)return;const duck=current.picks[last];delete current.picks[last];current.stars=starsOf().filter(id=>id!==last);starArmed=false;save();render();focusDuck(duck);}
  function randomPicks(){
    if(!current||current.active||current.stage!=='picking')return;
    const players=participants(), pool=players.map((_,i)=>i).filter(i=>!Object.values(current.picks).includes(i));if(!pool.length)return;
    let x;const cap=4294967296-(4294967296%pool.length);do{x=crypto.getRandomValues(new Uint32Array(1))[0];}while(x>=cap);pick(pool[x%pool.length]);
  }
  function makeTrack(){
    photoActive=false;document.querySelector('.race-water').classList.remove('photo-finish');endSlowmo();glides={};gains=[];hitStop=0;const players=participants();nodes=[];eventCursor=0;hideBanner();photoFinish=closeFinish(race);if($('commentary'))$('commentary').hidden=true;runeMarkerKey='';skillNodes=[];racerViews=[];currentSample=[];lastTimerText='';lastSprintState=false;
    owners=race.racers.map(r=>players.find(p=>current.picks[p.id]===r.id)?.name||A.name(r.id));
    runeSpawns=(race.events||[]).filter(e=>e.type==='rune-spawn');
    $('lanes').replaceChildren(...race.racers.map(r=>{
      const lane=node('div','lane'),runway=node('div','runway'),racer=node('div','racer'),art=node('span','duck-body');art.innerHTML=A.svg(r.id);
      racer.style.setProperty('--duck-color',A.colors[r.id%A.colors.length]);racer.style.setProperty('--bob-delay',`${-(r.id*.31).toFixed(2)}s`);
      const rankBadge=node('span','racer-rank'),stateBadge=node('span','racer-state'),emote=node('span','racer-emote');
      racer.append(node('span','wake'),art,node('span','racer-label',owners[r.id]),rankBadge,emote,node('span','racer-bomb','💣'));
      const ownerId=players.find(p=>current.picks[p.id]===r.id)?.id;if(ownerId&&starsOf().includes(ownerId)){racer.classList.add('has-star');racer.append(node('span','racer-star','⭐'));racer.title=`⭐ ${racer.title}`;}
      racer.title=`${A.name(r.id)} — ${owners[r.id]}`;
      if(r.skill){const badge=node('span','racer-skill',r.skill.icon);badge.title=`${r.skill.name}: ${r.skill.description}`;racer.append(badge,stateBadge);racer.title+=`${r.talent?` · ${r.talent.name}`:''} · ${r.skill.name}${r.trait?` · ${r.trait.icon} ${r.trait.name}`:''}`;}
      if(r.trait){const t=node('span','racer-trait',r.trait.icon);t.title=`${r.trait.name}: ${r.trait.description}`;racer.append(t);}
      if(r.luck&&lastPlaceIds().has(ownerId)){const l=node('span','racer-luck','🍀'.repeat(r.luck));l.title=`Bùa may cấp ${r.luck}: đang ở cuối bảng điểm nên vịt nhanh hơn ${r.luck*2}%, dễ thoát nạn và dễ được giúp hơn.`;racer.append(l);}
      runway.append(racer);lane.append(node('span','lane-number',String(r.id+1).padStart(2,'0')),runway);nodes.push(racer);
      racerViews[r.id]={element:racer,stateBadge,rankBadge,emote,face:'',flags:-1,rank:0};return lane;
    }));
    const chaotic=!!race.events;
    document.querySelector('.skill-reveal-wrap').hidden=!chaotic;
    document.querySelector('.event-history-panel').hidden=!chaotic;
    $('event-feed').hidden=!chaotic;
    $('event-history').replaceChildren();$('event-feed').replaceChildren();
    $('skill-reveal').replaceChildren(...(chaotic?race.racers.map(r=>{const owner=players.find(p=>current.picks[p.id]===r.id),chip=node('div','skill-chip');chip.dataset.duckId=String(r.id);chip.dataset.skillId=r.skill.id;chip.title=r.talent?`${r.skill.description} · Thiên phú: ${r.talent.description}`:r.skill.description;chip.append(node('strong','skill-owner',`${owner?.name||A.name(r.id)} · #${r.id+1}`),node('span','skill-name',`${r.skill.icon} ${r.skill.name}`));skillNodes[r.id]=chip;return chip;}):[]));
    visuals?.destroy();showWeather();visuals=window.DuckRaceVisuals?.create({lite:slowFx,container:document.querySelector('.race-water'),river:$('river'),nodes,reduced:()=>reduced.matches,seed:race.seed,weather:race.weather?.id,duration:race.duration})||null;
    $('river').scrollTop=0;measure();
  }
  function eventText(event,picks=current.picks){
    const owner=id=>{const entry=Object.entries(picks).find(([,duck])=>duck===id);return entry?playerName(entry[0]):A.name(id);};
    const who=Number.isInteger(event.actorId)?owner(event.actorId):'Đường đua';
    const target=Number.isInteger(event.targetId)&&event.targetId!==event.actorId?` → ${owner(event.targetId)}`:'';
    return `${event.icon||'✦'} ${who}${target}: ${event.label}`;
  }
  function eventItem(event,picks){const item=node('li','race-event',`${event.time.toFixed(1)}s · ${eventText(event,picks)}`);item.dataset.eventId=String(event.id);item.dataset.eventTime=String(event.time);return item;}
  // Twist banner: newest twist in big type; simultaneous twists are counted.
  const TWIST_TONE={blocked:'guard',reflected:'guard',immune:'guard',swapped:'swap',shuffled:'swap',fly:'boost',boost:'boost'}, TONE_HZ={harm:220,boost:880,swap:660,guard:520};
  function twistTone(event){return TWIST_TONE[event.outcome]||(event.outcome==='fallback'&&event.skill!=='mirror'?'boost':'harm');}
  function showBanner(list){
    const event=list.at(-1),kind=twistTone(event),banner=$('twist-banner'),icon=event.icon||'✦',full=eventText(event);
    // Mirror/buoy reactions ride on the attack that triggered them, so only scheduled twists count.
    const phases=list.filter(e=>e.scheduled).length;
    const text=(full.startsWith(`${icon} `)?full.slice(icon.length+1):full)+(phases>1?` · ${phases} pha liên tiếp!`:'');
    // Letters drop in one by one; CSS staggers them by --i.
    // Words never break; their letters drop in one by one (CSS staggers by --i).
    const letters=node('span','twist-text');let index=0;
    text.split(' ').forEach((word,w)=>{if(w)letters.append(' ');const span=node('span','twist-word');Array.from(word).forEach(ch=>{const l=node('span','twist-letter',ch);l.style.setProperty('--i',String(index++));span.append(l);});letters.append(span);});
    // Keep the banner off the ducks involved: twists in the top half show it low, and vice versa.
    const ids=list.flatMap(e=>[e.actorId,e.targetId,...(e.affectedIds||[])]).filter(Number.isInteger),high=ids.length&&ids.reduce((a,b)=>a+b,0)/ids.length<(nodes.length-1)/2;
    banner.replaceChildren(node('span','twist-icon',icon),letters);banner.className=`twist-banner ${kind}${high?' low':''}`;void banner.offsetWidth;banner.hidden=false;bannerUntil=event.time+1.2;if(!playSfx(event))tone(TONE_HZ[kind],.12);
    startSlowmo(list,kind);
    say(window.DuckCommentary?.line(event,id=>owners[id]||A.name(id)));
  }
  // Commentator: a caption on the river, read aloud in Vietnamese when sound is on.
  function say(text){const box=$('commentary');if(!box||!text)return;box.textContent=`🎙️ ${text}`;box.hidden=false;box.classList.remove('fresh');void box.offsetWidth;box.classList.add('fresh');speak(text);}
  let voiceHinted=false;
  function speak(text){
    if(!sound||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;
    // Without a Vietnamese voice the browser reads Vietnamese in an English one: captions only, and say why once.
    const voices=speechSynthesis.getVoices?.()||[],voice=voices.find(v=>/^vi/i.test(v.lang));
    if(!voice){if(voices.length&&!voiceHinted){voiceHinted=true;toast('Máy này chưa có giọng đọc tiếng Việt nên bình luận chỉ hiện chữ. Mở game bằng Microsoft Edge để nghe bình luận tiếng Việt.',9000);}return;}
    try{const u=new SpeechSynthesisUtterance(text);u.lang='vi-VN';u.voice=voice;u.rate=1.15;u.pitch=1.1;speechSynthesis.cancel();speechSynthesis.speak(u);}
    catch{} // ponytail: speech is a bonus; a browser without it still shows captions
  }
  function startSlowmo(list,kind){
    const water=document.querySelector('.race-water');
    nodes.forEach(n=>n.classList.remove('twist-focus'));
    for(const e of list)for(const id of [e.actorId,e.targetId,...(e.affectedIds||[])])if(Number.isInteger(id))nodes[id]?.classList.add('twist-focus');
    water.classList.add('slowmo');water.classList.remove('shake','flash');void water.offsetWidth;water.classList.add('flash');
    // Camera: zoom toward the centre of the ducks involved (river and effects canvas share the origin).
    const focus=nodes.filter(n=>n.classList.contains('twist-focus')),box=water.getBoundingClientRect();
    // Slow effects (screen sharing): no zoom or shake, which repaint the whole frame and stutter on Teams.
if(focus.length&&!reduced.matches&&!slowFx){const c=focus.map(n=>n.getBoundingClientRect()).reduce((s,r)=>({x:s.x+(r.left+r.width/2-box.left)/focus.length,y:s.y+(r.top+r.height/2-box.top)/focus.length}),{x:0,y:0});
      water.style.setProperty('--zx',`${Math.round(c.x)}px`);water.style.setProperty('--zy',`${Math.round(c.y)}px`);water.classList.add('zoom');}
    if(kind==='harm'&&!reduced.matches&&!slowFx){void water.offsetWidth;water.classList.add('shake');hitStop=HIT_STOP_MS;} // reflow restarts the shake
    slowmoUntil=current.active.elapsed+SLOWMO_WINDOW;
  }
  function endSlowmo(){slowmoUntil=0;document.querySelector('.race-water')?.classList.remove('slowmo','shake','flash',...(photoActive?[]:['zoom']));$('twist-banner')?.classList.add('settled');nodes.forEach(n=>n.classList.remove('twist-focus'));}
  function showWeather(){
    const water=document.querySelector('.race-water'),w=race?.weather;
    water.classList.remove('weather-sunny','weather-rain','weather-wind','weather-storm','weather-fog','weather-night','fog-lifted');
    if(w)water.classList.add(`weather-${w.id}`);$('weather-label').textContent=w?`${w.icon} ${w.name}`:'';
    const rule=race?.rule;$('rule-label').textContent=rule?`${rule.icon} ${rule.name}`:'';$('rule-label').title=rule?.description||'';
  }
  // Synthesized sound for chaos-v2/v3 twists; returns false so callers fall back to a plain tone.
  // Sound is on unless this viewer turned it off (per-browser preference, key SOUND_KEY).
  function soundPref(){try{return localStorage.getItem(SOUND_KEY)!=='0';}catch{return true;}}
  let stopAmbience=null;
  function startAmbience(){if(stopAmbience||!sound||!audio||audio.state!=='running'||!window.DuckSfx?.ambience)return;stopAmbience=window.DuckSfx.ambience(audio);}
  function endAmbience(){if(stopAmbience){stopAmbience();stopAmbience=null;}}
  function playSfx(event){const kind=window.DuckSfx?.kindOf(event);if(!kind||!sound||!audio||audio.state!=='running')return false;window.DuckSfx.play(audio,kind);return true;}
  function closeFinish(r){
    if(!r?.events||r.results.length<2)return false;
    const end=[...r.sample(r.duration)].sort((a,b)=>a.rank-b.rank);return 1-end[1].progress<PHOTO_GAP;
  }
  function playbackRate(t){
    let rate=t<slowmoUntil?slowmoRate():1;
    if(photoFinish&&t>=race.duration-PHOTO_WINDOW){rate=Math.min(rate,PHOTO_RATE);if(!photoActive)startPhoto();}
    return rate;
  }
  function startPhoto(){
    photoActive=true;const water=document.querySelector('.race-water'),box=water.getBoundingClientRect(),line=document.querySelector('.finish-line')?.getBoundingClientRect();
    const top=[...race.results.slice(0,2)].map(r=>nodes[r.id]?.getBoundingClientRect()).filter(Boolean);
    if(line&&top.length&&!reduced.matches){water.style.setProperty('--zx',`${Math.round(line.left+line.width/2-box.left)}px`);water.style.setProperty('--zy',`${Math.round(top.reduce((s,r)=>s+r.top+r.height/2-box.top,0)/top.length)}px`);water.classList.add('zoom');}
    water.classList.add('photo-finish');
    const banner=$('twist-banner');banner.replaceChildren(node('span','twist-icon','📸'),node('span','twist-text','SÁT NÚT! CHIẾU CHẬM VẠCH ĐÍCH'));banner.className='twist-banner swap';banner.hidden=false;bannerUntil=race.duration+1;
    say('Ngang nhau! Ngang nhau! Chiếu chậm vạch đích nào!');
  }
  // Jumps are instant in the simulation; on screen the ducks glide there (eased) so a wave
  // visibly sweeps them back and a hook visibly reels the leader in. Results are untouched.
  const GLIDE={hook:{delay:.1,dur:.17},wave:{delay:0,dur:.25},rewind:{delay:0,dur:.25},tornado:{delay:.07,dur:.2},blackhole:{delay:.1,dur:.1},ghost:{delay:.03,dur:.2},buoy:{delay:0,dur:.25},dice:{delay:.12,dur:.15},giant:{delay:.05,dur:.18}};let glides={};
  // Ducks thrown back by a tornado are lifted and twirled; by a black hole they shrink into it and pop out behind
  // (CSS, real time; matches the 1.8 s slow motion).
  // A buoy bounce hops the duck forward three times. [class, direction of the move it decorates]
  const BODY_FX={tornado:['swept',-1],blackhole:['swallowed',-1],buoy:['bouncy',1]};
  function sweep(event){
    const [cls,dir]=BODY_FX[event.copied||event.skill]||[];if(!cls||reduced.matches)return;
    for(const [id,d] of Object.entries(event.after||{}))if((d-event.before[id])*dir>1e-9&&nodes[id]){const n=nodes[id];n.classList.remove(cls);void n.offsetWidth;n.classList.add(cls);setTimeout(()=>n.classList.remove(cls),slowmoMs()+100);}
  }
  // Boosts show how many ducks they overtook: "⏩ +N" pops over the duck once the move is done
  // (a jump right after its glide, a surge such as wind, dolphin or rocket when it has run).
  let gains=[];
  function scheduleGain(event){
    const id=event.actorId,moved=event.after?.[id]>event.before?.[id]+1e-9,surge=event.outcome==='boost';
    if(!Number.isInteger(id)||!event.ranksBefore||!(moved||surge))return;
    const at=Math.min(race.duration,event.time+(surge?1.2:.3)),gain=event.ranksBefore[id]-race.sample(at)[id].currentRank;
    if(gain>0)gains.push({id,at,gain});
  }
  function showGains(elapsed){
    if(!gains.length)return;
    gains=gains.filter(g=>{if(elapsed<g.at)return true;const n=nodes[g.id];if(n){n.querySelector('.racer-gain')?.remove();const badge=node('span','racer-gain',`⏩ VƯỢT +${g.gain}`);n.append(badge);setTimeout(()=>badge.remove(),slowmoMs());}return false;});
  }
  // Every duck an attack lands on flashes white for a beat.
  function flashHits(event){
    if(reduced.matches)return;
    const hit=event.outcomes?Object.entries(event.outcomes).filter(([,o])=>o==='hit').map(([id])=>Number(id))
      :event.outcome==='hit'||event.outcome==='bust'?[event.type==='hazard'||event.outcome==='bust'?event.actorId:event.targetId]:event.outcome==='reflected'?[event.actorId]:[];
    for(const id of hit)if(nodes[id]){const n=nodes[id];n.classList.remove('hit-flash');void n.offsetWidth;n.classList.add('hit-flash');setTimeout(()=>n.classList.remove('hit-flash'),400);}
  }
  function startGlides(event,pre){
    sweep(event);flashHits(event);
    if(!event.before||!event.after)return;
    const g=GLIDE[event.copied||event.skill]||{delay:0,dur:.18};
    for(const [id,d] of Object.entries(event.after))if(Math.abs(d-event.before[id])>1e-9&&pre[id])glides[id]={from:pre[id].progress,start:event.time+g.delay,end:event.time+g.delay+g.dur};
  }
  function glided(r,elapsed){
    const g=glides[r.id];if(!g)return r.progress;
    if(elapsed>=g.end){delete glides[r.id];return r.progress;}
    const t=Math.max(0,(elapsed-g.start)/(g.end-g.start));return g.from+(r.progress-g.from)*(1-(1-t)**3);
  }
  function hideBanner(){bannerUntil=0;const banner=$('twist-banner');if(banner)banner.hidden=true;}
  function drawEvents(elapsed){
    if(!race.events)return;
    let changed=false;const fresh=[];
    while(eventCursor<race.events.length&&race.events[eventCursor].time<=elapsed+1e-8){const event=race.events[eventCursor];$('event-history').append(eventItem(event));if(phase==='running'&&elapsed-event.time<.3){const pre=race.sample(Math.max(0,event.time-.051));startGlides(event,pre);scheduleGain(event);visuals?.event(event,currentSample,elapsed,pre);if(event.type==='skill'||event.type==='hazard')fresh.push(event);}eventCursor++;changed=true;}
    if(fresh.length)showBanner(fresh);else if(bannerUntil&&elapsed>=bannerUntil)hideBanner();
    if(changed){const recent=race.events.slice(Math.max(0,eventCursor-3),eventCursor);$('event-feed').replaceChildren(...recent.map(e=>node('p','live-event',eventText(e))));}
    const visible=runeSpawns.filter(e=>e.time<=elapsed&&elapsed<e.pickupTime),key=visible.map(e=>e.id).join('|');
    if(key!==runeMarkerKey){runeMarkerKey=key;document.querySelectorAll('.rune-marker').forEach(e=>e.remove());for(const rune of visible){const runway=nodes[rune.actorId]?.parentElement;if(!runway)continue;const marker=node('span','rune-marker',rune.icon);marker.title=rune.label;marker.style.left=`${Math.max(0,Math.min(1,rune.progress))*100}%`;runway.append(marker);}}
  }
  function measure(){runwayWidth=$('lanes').querySelector('.runway')?.getBoundingClientRect().width||0;visuals?.resize();if(race&&current?.active)draw(race.sample(current.active.elapsed));}
  function start(){
    if(!current||current.active||current.stage!=='picking'||currentSeason()?.closedAt)return;
    // Last round: any star still unused is spent now (covers random picks and older saves).
    if(current.type==='regular'){const forced=participants().map(p=>p.id).filter(id=>T.starForced(current.session,id)&&!starsOf().includes(id));if(forced.length)current.stars=[...starsOf(),...forced];}
    try{T.selectionState(current.session,current.type,current.picks);T.validatePicks(participants(),current.picks);ensureLineup();if(!isLegacy()){const luck=luckByDuck();current.lineup={...plainLineup(current.lineup),...(luck.some(Boolean)?{luck}:{}),...(current.rule?{rule:current.rule}:{})};}race=isLegacy()?DuckRaceEngine.createRace(participants().map((_,i)=>A.name(i)),current.session.duration):C3.createRace(participants().map((_,i)=>A.name(i)),current.session.duration,undefined,current.lineup);}catch(e){toast(e.message);return;}
    stop();current.active={id:uuid(),seed:race.seed,elapsed:0,countdownLeft:3,...(isLegacy()?{}:{engine:C3.version,lineup:plainLineup(current.lineup)})};phase='countdown';lastTime=performance.now();lastSaved=lastTime;lastTick=3;sprintAnnounced=false;leadersKey='';save();render();makeTrack();activateAudio();tone(520);
    $('restore-notice').hidden=true;$('arena-title').textContent='Chuẩn bị xuất phát…';$('race-overlay').hidden=false;$('overlay-number').textContent='3';$('overlay-text').textContent=race.weather?`Chuẩn bị nào! · ${race.weather.icon} ${race.weather.name}`:'Chuẩn bị nào!';$('resume-overlay').hidden=true;$('sprint-label').textContent='ĐANG VÀO VỊ TRÍ';$('live-leaders').replaceChildren();
    document.querySelector('.arena-panel').scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
    schedule();
  }
  function draw(sample){
    currentSample=sample;
    for(const r of sample){
      const view=racerViews[r.id];if(!view)continue;const e=view.element;
      // Exact engine interpolation at the display refresh rate. No CSS easing
      // on this transform: easing chases a moving target and makes overtakes lag.
      e.style.transform=`translate3d(${(glided(r,current.active?.elapsed??race.duration)*runwayWidth).toFixed(3)}px,0,0)`;
      const boosting=!!r.boosting&&phase==='running',leading=current.active.elapsed>0&&r.currentRank===1;
      const flags=(boosting?1:0)|(leading?2:0)|(r.slowed?4:0)|(r.shielded?8:0)|(r.swapping?16:0)|(r.skillUsed?32:0)|(r.pose==='capsized'?64:0)|(r.pose==='spinning'?128:0)|(r.flying?256:0)|(r.pose==='reversed'?512:0)|(r.pose==='frozen'?1024:0)|(r.pose==='ghost'?2048:0)|(r.pose==='lifted'?4096:0)|(r.pose==='asleep'?8192:0)|(r.pose==='hex'?16384:0)|(r.pose==='giant'?32768:0)|(r.bomb?65536:0)|(r.mirror?131072:0);
      if(flags!==view.flags){view.flags=flags;e.classList.toggle('boosting',boosting);e.classList.toggle('leading',leading);e.classList.toggle('slowed',!!r.slowed);e.classList.toggle('shielded',!!r.shielded);e.classList.toggle('swapping',!!r.swapping);e.classList.toggle('skill-used',!!r.skillUsed);e.classList.toggle('stunned',!!r.stunned);e.classList.toggle('capsized',r.pose==='capsized');e.classList.toggle('spinning',r.pose==='spinning');e.classList.toggle('flying',!!r.flying);e.classList.toggle('reversed',r.pose==='reversed');e.classList.toggle('frozen',r.pose==='frozen');e.classList.toggle('ghost',r.pose==='ghost');e.classList.toggle('lifted',r.pose==='lifted');e.classList.toggle('asleep',r.pose==='asleep');e.classList.toggle('hex',r.pose==='hex');e.classList.toggle('giant',r.pose==='giant');e.classList.toggle('has-bomb',!!r.bomb);e.classList.toggle('has-mirror',!!r.mirror);view.stateBadge.textContent=r.pose==='asleep'?'💤':r.pose==='hex'?'🐸':r.pose==='giant'?'🍄':r.pose==='lifted'?'🎈':r.pose==='ghost'?'👻':r.pose==='reversed'?'↩️':r.pose==='frozen'?'🧊':r.pose==='capsized'?'🙃':r.pose==='spinning'?'💫':r.flying?'🪽':r.swapping?'🔄':r.shielded?'🛟':r.mirror?'🪞':r.slowed?'💫':boosting?'⚡':'';skillNodes[r.id]?.classList.toggle('skill-used',!!r.skillUsed);}
      // Faces: dizzy when knocked over, silly when spun, cool when flying, grumpy when slowed, party when winning.
      const face=r.pose==='asleep'?'😴':r.pose==='hex'?'🐸':r.pose==='giant'?'😈':r.bomb?'😰':r.pose==='lifted'?'😨':r.pose==='ghost'?'😇':r.pose==='reversed'?'😱':r.pose==='frozen'?'🥶':r.pose==='capsized'?'😵':r.pose==='spinning'?'🤪':r.flying?'😎':r.slowed?'😣':current.active.elapsed>=race.duration&&r.rank===1?'🥳':'';
      if(face!==view.face){view.face=face;view.emote.textContent=face;view.emote.classList.toggle('show',!!face);}
      if(view.rank!==r.currentRank){view.rank=r.currentRank;view.rankBadge.textContent=String(r.currentRank);view.rankBadge.title=`Đang hạng ${r.currentRank}`;}
    }
    drawEvents(current.active.elapsed);
    visuals?.draw(sample,current.active.elapsed,{running:phase==='running'});
    const ordered=[...sample].sort((a,b)=>a.currentRank-b.currentRank).slice(0,3), key=ordered.map(r=>r.id).join(',');
    if(key!==leadersKey){leadersKey=key;$('live-leaders').replaceChildren(...ordered.map((r,i)=>node('span','',`${['🥇','🥈','🥉'][i]} ${owners[r.id]}`)));}
  }
  function frame(now){
    raf=null;if(!current?.active||!['countdown','running'].includes(phase))return;
    let delta=Math.max(0,(now-lastTime)/1000);lastTime=now;const a=current.active;
    if(phase==='countdown'){
      const consumed=Math.min(delta,a.countdownLeft);a.countdownLeft-=consumed;delta-=consumed;const count=Math.max(1,Math.ceil(a.countdownLeft));if(count!==lastTick){$('overlay-number').textContent=count;lastTick=count;tone(520);}
      if(a.countdownLeft<=0){phase='running';say(window.DuckCommentary?.start(race));$('race-overlay').hidden=true;$('pause').disabled=false;$('river').classList.add('is-running');$('arena-title').textContent='Quạc quạc… tăng tốc nào!';$('arena-label').textContent=current.type==='tie'?'ĐUA PHỤ · KHÔNG CỘNG ĐIỂM':`LƯỢT ${current.session.rounds.length+1} · ĐANG ĐUA`;$('race-status').textContent=race.events?'Skill tự kích hoạt · Theo dõi rune và nhật ký bên trên.':'Cổ vũ cho vịt của bạn — chờ cú bứt phá 5 giây cuối!';$('sprint-label').textContent='CỔ VŨ CHO CHÚ VỊT CỦA BẠN';tone(820,.25);lastTick=-1;}
    }
    if(phase==='running'){
      startAmbience();
      const frozen=hitStop>0;if(frozen)hitStop=Math.max(0,hitStop-delta*1000); // hit-stop: the race holds still a beat on impact
      a.elapsed=Math.min(race.duration,a.elapsed+(frozen?0:delta*playbackRate(a.elapsed)));if(slowmoUntil&&a.elapsed>=slowmoUntil)endSlowmo();showGains(a.elapsed);const remaining=race.duration-a.elapsed;draw(race.sample(a.elapsed));const timerText=clock(remaining),inSprint=remaining<=5;if(timerText!==lastTimerText){$('timer').textContent=timerText;lastTimerText=timerText;}if(inSprint!==lastSprintState){$('timer').classList.toggle('sprint',inSprint);lastSprintState=inSprint;}
      if(a.elapsed>=race.sprintStart){if(!sprintAnnounced){sprintAnnounced=true;document.querySelector('.race-water')?.classList.add('fog-lifted');$('arena-title').textContent='NƯỚC RÚT! Cơ hội lật ngược!';$('race-status').textContent='⚡ Tăng tốc ngẫu nhiên — vịt cuối vẫn có cơ hội!';tone(950,.2);}$('sprint-label').textContent='⚡ 5 GIÂY CUỐI · BỨT PHÁ!';const second=Math.ceil(remaining);if(second!==lastTick&&second>0){lastTick=second;tone(650,.06);}}
      if(a.elapsed>=race.duration){finish();return;}
    }
    if(now-lastSaved>=500){saveCheckpoint();lastSaved=now;}
    schedule();
  }
  function pause(){
    if(!current?.active)return;
    if(phase==='running'){stop();phase='paused';window.speechSynthesis?.cancel?.();endAmbience();$('river').classList.remove('is-running');if(currentSample.length)draw(currentSample);$('race-overlay').hidden=false;$('overlay-number').textContent='Ⅱ';$('overlay-text').textContent='Nghỉ quẩy một chút';$('resume-overlay').hidden=false;$('pause').textContent='▶ Tiếp tục';save();}
    else if(phase==='paused'){activateAudio();phase=current.active.countdownLeft>0?'countdown':'running';lastTime=performance.now();lastSaved=lastTime;$('resume-overlay').hidden=true;$('pause').textContent='Ⅱ Tạm dừng';$('pause').disabled=phase==='countdown';$('race-overlay').hidden=phase==='running';$('overlay-number').textContent=String(Math.ceil(current.active.countdownLeft));$('overlay-text').textContent='Chuẩn bị nào!';$('river').classList.toggle('is-running',phase==='running');$('restore-notice').hidden=true;if(phase==='running'){const sprint=current.active.elapsed>=race.sprintStart;$('arena-label').textContent=current.type==='tie'?'ĐUA PHỤ · KHÔNG CỘNG ĐIỂM':`LƯỢT ${current.session.rounds.length+1} · ĐANG ĐUA`;$('arena-title').textContent=sprint?'NƯỚC RÚT! Cơ hội lật ngược!':'Quạc quạc… tăng tốc nào!';$('sprint-label').textContent=sprint?'⚡ 5 GIÂY CUỐI · BỨT PHÁ!':'CỔ VŨ CHO CHÚ VỊT CỦA BẠN';$('race-status').textContent=race.events?'Skill tự kích hoạt · Theo dõi rune và nhật ký bên trên.':'Cổ vũ cho vịt của bạn — chờ cú bứt phá 5 giây cuối!';}schedule();}
  }
  function finish(){
    if(!current.active)return;stop();const type=current.type,a=current.active;
    const input={id:a.id,picks:{...current.picks},order:race.results.map(r=>r.id),completedAt:new Date().toISOString(),...(type==='regular'?{stars:starsOf()}:{})};
    try{current.session=type==='tie'?T.recordTiebreak(current.session,input):T.recordRound(current.session,input);}catch(e){phase='paused';toast(`Chưa ghi được điểm: ${e.message}`);return;}
    if(engineFor(a.engine)){current.raceReplays??=[];if(!current.raceReplays.some(r=>r.id===a.id))current.raceReplays.push({id:a.id,seed:a.seed,engine:a.engine,...(a.lineup?{lineup:plainLineup(a.lineup)}:{})});}
    endAmbience();if(sound&&audio&&audio.state==='running')window.DuckSfx?.play(audio,'cheer');
    const [first,second]=race.results,photo=photoFinish;say(window.DuckCommentary?.finish(owners[first.id],owners[second?.id],photo));
    current.active=null;current.stage='result';current.stars=[];clearRace();save();render();tone(523,.2);tone(659,.2,.17);tone(784,.3,.34);
    const record=(type==='tie'?current.session.tiebreaks:current.session.rounds).at(-1);showRound(record,type,true);
    if(photo)$('result-content').prepend(node('div','photo-finish-card',`📸 PHOTO FINISH · ${playerName(record.entries[0].playerId)} thắng ${playerName(record.entries[1].playerId)} trong gang tấc!`));
  }
  function nextLabel(){if(!current)return '';const s=current.session;if(s.rounds.length<s.roundLimit)return `Chọn vịt vòng ${s.rounds.length+1} →`;return outcome().status==='tie'?'Chọn vịt đua phụ →':'Xem tổng kết ngày ↗';}
  function next(){
    if(!current||current.active)return;close('result-dialog');const status=outcome();
    if(status.status==='resolved'){current.stage='complete';save();render();showFinal();return;}
    clearRace();current.type=status.status==='tie'?'tie':'regular';current.stage='picking';current.picks={};current.stars=[];delete current.lineup;starArmed=false;selected=participants()[0]?.id;save();render();
  }
  function table(headers,rows){const wrap=node('div','result-table-wrap'),t=node('table','result-table'),head=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th','',h)));head.append(tr);const body=node('tbody');rows.forEach(row=>{const r=node('tr',row.coffee?'coffee-row':'');row.cells.forEach((cell,i)=>r.append(node('td',i===1?'name':i===row.cells.length-1?'total':'',cell)));body.append(r);});t.append(head,body);wrap.append(t);return wrap;}
  function showRound(record,type,advance){
    if(!record||current.active)return;
    $('result-emoji').textContent=type==='tie'?'⚖':'🏆';$('result-label').textContent=type==='tie'?'KẾT QUẢ LƯỢT PHÂN ĐỊNH':`KẾT QUẢ LƯỢT ${record.number}/${current.session.roundLimit}`;
    const winner=record.entries[0];$('result-title').textContent=playerName(winner.playerId);$('result-subtitle').textContent=`${A.name(winner.duckId)} về nhất${type==='regular'?` · +${winner.points} điểm`:' · Lượt phụ không cộng điểm'}`;
    const totals=new Map(T.standings({...current.session,rounds:type==='regular'?current.session.rounds.slice(0,record.number):current.session.rounds}).map(p=>[p.playerId,p.total]));
    const status=outcome();const rows=record.entries.map(e=>({coffee:type==='tie'&&status.coffeeIds.includes(e.playerId),cells:type==='regular'?[`#${e.rank}`,playerName(e.playerId),A.name(e.duckId),`+${e.points}${starMark(e,record.entries.length)}`,totals.get(e.playerId)]:[`#${e.rank}`,playerName(e.playerId),A.name(e.duckId),contributionLabel(e.playerId)]}));
    $('result-content').replaceChildren(table(type==='regular'?['Hạng','Người chơi','Vịt','Điểm lượt','Tổng sau lượt']:['Hạng','Người chơi','Vịt','Kết quả'],rows));
    const replay=current.raceReplays?.find(r=>r.id===record.id);
    if(replay){
      const simulation=engineFor(replay.engine).createRace(record.entries.map((_,i)=>A.name(i)),current.session.duration,replay.seed,replay.lineup),picks=Object.fromEntries(record.entries.map(e=>[e.playerId,e.duckId]));
      if(simulation.results.every((r,i)=>r.id===record.entries[i].duckId)){
        const details=node('details','race-recap'),summary=node('summary','',simulation.racers[0].talent?'Thiên phú, skill & diễn biến lượt này':'Skill & diễn biến lượt này'),roster=node('div','recap-skills');
        for(const racer of simulation.racers){const owner=record.entries.find(e=>e.duckId===racer.id);roster.append(node('p','',`${playerName(owner.playerId)} · ${racer.talent?`${racer.talent.icon} ${racer.talent.name} · `:''}${racer.skill.icon} ${racer.skill.name}`));}
        const events=node('ol','recap-events');events.append(...simulation.events.map(e=>eventItem(e,picks)));details.append(summary,roster,events);$('result-content').append(details);
      }
    }
    if(advance&&status.status==='tie')$('result-content').append(node('p','tie-note',`${status.tiedIds.map(playerName).join(', ')} đồng điểm. Đua phụ để phân định thứ hạng cuối${isLegacy()?'':' và mức đóng 60k / 40k'}; tổng điểm không đổi.`));
    else if(advance&&type==='regular'&&current.session.rounds.length<current.session.roundLimit)$('result-content').append(node('p','tie-note',`Thứ tự chọn vịt vòng sau: ${T.selectionOrder(current.session).map(playerName).join(' → ')}.`));
    $('result-next').textContent=advance?nextLabel():'Đóng kết quả';dialogAction=advance?next:()=>close('result-dialog');open('result-dialog');if(advance)window.DuckRaceVisuals?.celebrate($('result-dialog'),reduced.matches);
  }
  function showFinal(){
    if(!current||current.active)return;const status=outcome();if(status.status!=='resolved'){next();return;}
    $('result-emoji').textContent=isLegacy()?'☕':'🍻';$('result-label').textContent=`TỔNG KẾT NGÀY · ${dateLabel(current.session.date)}`;$('result-title').textContent=isLegacy()?'Kết quả cà phê trước mùa giải':'Quỹ mùa giải có thêm 100.000đ phải đóng!';$('result-subtitle').textContent=`Sau ${current.session.roundLimit} vòng${current.session.tiebreaks.length?' và một lượt phân định':''}.${isLegacy()?' Không tính tiền hồi tố.':' Đánh dấu khoản thực nhận trong Quỹ mùa giải.'}`;
    const people=node('div','final-coffee');status.coffeeIds.forEach(id=>people.append(node('strong','',`${playerName(id)}${isLegacy()?'':` · ${money(amountFor(id))}`}`)));
    const rows=T.standings(current.session).map(r=>({coffee:status.coffeeIds.includes(r.playerId),cells:[`#${r.rank}`,r.name,...r.pointsByRound,r.total,contributionLabel(r.playerId)]}));
    $('result-content').replaceChildren(people,table(['Hạng điểm','Người chơi',...current.session.rounds.map(r=>`V${r.number}`),'Tổng',isLegacy()?'Cà phê':'Phải đóng'],rows));
    const awards=dayAwards();
    if(awards.length){const box=node('div','day-awards');box.append(node('h3','','🏅 Danh hiệu trong ngày'));for(const a of awards){const card=node('div','award-card');card.append(node('span','award-icon',a.icon),node('strong','award-title',a.title),node('span','award-who',a.playerIds.map(playerName).join(', ')),node('small','award-detail',a.detail));box.append(card);}$('result-content').append(box);}
    $('result-next').textContent='Về bảng điểm';dialogAction=()=>close('result-dialog');open('result-dialog');
  }
  // Titles need the replayed races; chaos-v1 rounds use a different event format and are skipped.
  function dayAwards(){
    if(!window.DuckAwards)return[];
    const rounds=current.session.rounds.flatMap(record=>{const replay=current.raceReplays?.find(r=>r.id===record.id),engine=replay&&engineFor(replay.engine);if(!engine||engine===C)return[];
      // Rebuilt races that no longer match the stored finish (an older engine build) are left out, as in the recap.
      try{const race=engine.createRace(record.entries.map((_,i)=>A.name(i)),current.session.duration,replay.seed,replay.lineup);
        return race.results.every((r,i)=>r.id===record.entries[i].duckId)?[{race,ownerOf:Object.fromEntries(record.entries.map(e=>[e.duckId,e.playerId]))}]:[];}catch{return[];}});
    return window.DuckAwards.compute(rounds);
  }
  function exportCsv(){
    if(!current)return;const status=outcome(),s=current.session,rows=[['Hạng','Người chơi',...s.rounds.map(r=>`Vòng ${r.number}`),'Tổng điểm',isLegacy()?'Bao cà phê':'Phải đóng (VND)','Ngày']];
    T.standings(s).forEach(r=>rows.push([r.rank,r.name,...r.pointsByRound,r.total,status.status==='resolved'?(isLegacy()?(status.coffeeIds.includes(r.playerId)?'Có':'Không'):amountFor(r.playerId)):'Chưa chốt',s.date]));
    rows.push([],['CHI TIẾT TỪNG LƯỢT'],['Lượt','Hạng','Người chơi','Vịt','Điểm','Sao']);
    s.rounds.forEach(r=>r.entries.forEach(e=>rows.push([r.number,e.rank,playerName(e.playerId),`${A.name(e.duckId)} #${e.duckId+1}`,e.points,e.star?(e.points!==r.entries.length-e.rank+1?'x2':'Có'):''])));
    s.tiebreaks.forEach(r=>r.entries.forEach(e=>rows.push(['Phân định',e.rank,playerName(e.playerId),`${A.name(e.duckId)} #${e.duckId+1}`,0,''])));
    downloadCsv(rows,`vit-dua-ngay-${s.date}.csv`);
  }
  function downloadCsv(rows,filename){const quote=v=>{let text=String(v);if(/^[=+@\-\t\r]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};const csv='\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=node('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function replaceSeason(season){const index=store.seasons.findIndex(s=>s.id===season.id);if(index<0)throw Error('Không tìm thấy mùa giải.');store.seasons[index]=season;}
  function renderSeason(){
    const season=currentSeason();$('season-strip').hidden=!season;if(!season)return;
    const days=seasonDays(season),sum=S.summary(season,days),pending=days.some(s=>T.coffeeStatus(s).status!=='resolved');
    $('season-label').textContent=season.name;$('season-progress').textContent=`Từ ${dateLabel(season.startedOn)} · ${sum.daysComplete} ngày đã chốt · ${season.closedAt?'Mùa đã kết thúc':'Không giới hạn số ngày'}`;
    $('season-assessed').textContent=money(sum.assessed);$('season-paid').textContent=money(sum.paid);$('season-outstanding').textContent=money(sum.outstanding);
    $('new-day').disabled=!!current.active||!!season.closedAt||pending;$('new-day').title=pending?'Hoàn tất ngày đang chơi trước khi thêm ngày mới.':'';
    $('close-season').disabled=!!current.active||!!season.closedAt||pending||!sum.daysComplete;$('close-season').title=pending?'Hoàn tất ngày đang chơi trước khi chốt mùa.':'';
    $('season-fund').disabled=!!current.active;
    $('cancel-season').hidden=!!season.closedAt;$('cancel-season').disabled=raceRunning();
  }
  function fundContent(season,includeReceipts=true){
    const sum=S.summary(season,seasonDays(season)),fragment=document.createDocumentFragment(),stats=node('div','ledger-summary');
    for(const [label,value] of [['Phải đóng',sum.assessed],['Đã thu thực tế',sum.paid],['Còn thiếu',sum.outstanding]]){const box=node('div');box.append(node('small','',label),node('strong','',money(value)));stats.append(box);}fragment.append(stats);
    fragment.append(table(['Người chơi','Ngày','Chót','Kế chót','Phải đóng','Đã thu','Còn thiếu'],sum.rows.map(r=>({cells:[r.name,r.daysPlayed,r.lastCount,r.penultimateCount,money(r.assessed),money(r.paid),money(r.outstanding)]}))));
    if(includeReceipts){fragment.append(node('h3','fund-day-head','Các khoản theo ngày'));if(!sum.items.length)fragment.append(node('p','empty','Ngày chưa hoàn tất hoặc còn đua phụ sẽ chưa ghi khoản đóng quỹ.'));
      for(const item of [...sum.items].reverse()){
        const label=node('label','fund-receipt'),text=node('span'),check=node('input');check.type='checkbox';check.checked=item.paid;check.dataset.receiptKey=item.key;check.setAttribute('aria-label',`Đã thu ${money(item.amount)} của ${item.name} ngày ${dateLabel(item.date)}`);text.append(node('strong','',`${item.name} · ${money(item.amount)}`),node('small','',`${dateLabel(item.date)} · ${item.position==='last'?'Chót':'Kế chót'}`));
        check.onchange=()=>{try{const fresh=store.seasons.find(s=>s.id===season.id);replaceSeason(S.markPaid(fresh,seasonDays(fresh),item.key,check.checked));save();renderSeason();showFund(season.id);$('fund-content').querySelector(`[data-receipt-key="${item.key}"]`)?.focus({preventScroll:true});}catch(e){check.checked=!check.checked;toast(e.message);}};
        label.append(check,text,node('span','',item.paid?'Đã thu':'Chưa thu'));fragment.append(label);
      }
    }return fragment;
  }
  function showFund(id=current?.seasonId){if(current?.active)return;const season=store.seasons.find(s=>s.id===id);if(!season)return;store.currentSeasonId=season.id;$('fund-title').textContent=`Quỹ · ${season.name}${season.closedAt?' · Đã chốt':''}`;$('fund-content').replaceChildren(fundContent(season));open('fund-dialog');}
  function exportFund(){const season=seasonView();if(!season)return;const sum=S.summary(season,seasonDays(season));const rows=[['Mùa giải',season.name],['Trạng thái',season.closedAt?'Đã chốt':'Đang diễn ra'],[],['Người chơi','Ngày hoàn tất','Lần chót','Lần kế chót','Phải đóng VND','Đã thu VND','Còn thiếu VND'],...sum.rows.map(r=>[r.name,r.daysPlayed,r.lastCount,r.penultimateCount,r.assessed,r.paid,r.outstanding]),[],['Tổng',sum.assessed,sum.paid,sum.outstanding],[],['Ngày','Người chơi','Vị trí','Phải đóng VND','Đã thu']];sum.items.forEach(i=>rows.push([i.date,i.name,i.position==='last'?'Chót':'Kế chót',i.amount,i.paid?'Có':'Chưa']));downloadCsv(rows,`quy-mua-giai-${season.startedOn}.csv`);}
  function requestCloseSeason(){if(current?.active)return;const season=currentSeason();if(!season||season.closedAt)return;try{S.closeSeason(season,seasonDays(season));$('close-season-summary').replaceChildren(node('p','muted',`${season.name}: lịch sử và khoản đã thu sẽ được giữ lại. Mùa mới bắt đầu với quỹ bằng 0.`),fundContent(season,false));open('close-season-dialog');}catch(e){toast(e.message);}}
  function confirmCloseSeason(){if(current?.active)return;const season=currentSeason();if(!season||season.closedAt)return;try{replaceSeason(S.closeSeason(season,seasonDays(season)));save();close('close-season-dialog');render();openSetup('season');}catch(e){toast(e.message);}}
  const raceRunning=()=>phase==='running'||phase==='countdown';
  function requestCancelSeason(){if(raceRunning())return;const season=currentSeason();if(!season||season.closedAt)return;$('cancel-season-summary').textContent=`${season.name}: xóa hẳn ${seasonDays(season).length} ngày đua cùng toàn bộ điểm, kết quả và khoản quỹ của mùa này để đua lại từ đầu. Không khôi phục được.`;open('cancel-season-dialog');}
  function confirmCancelSeason(){
    if(raceRunning())return;const season=currentSeason();if(!season||season.closedAt)return;const names=season.players.map(p=>p.name);
    clearRace();store={...store,seasons:store.seasons.filter(s=>s.id!==season.id),sessions:store.sessions.filter(e=>e.seasonId!==season.id)};
    current=store.sessions.at(-1)||null;store.currentId=current?.session.id??null;store.currentSeasonId=current?.seasonId??null;starArmed=false;
    save();close('cancel-season-dialog');document.querySelector('main').hidden=!current;render();openSetup('season',names); // nothing left: hide the deleted season behind the setup
  }
  function openSetup(mode='season',names=null){
    if(current?.active)return;const season=openSeason();if(mode==='season'&&season){toast('Chốt mùa hiện tại trước khi mở mùa mới.');return;}if(mode==='day'&&!season)return;
    if(mode==='day'&&seasonDays(season).some(s=>T.coffeeStatus(s).status!=='resolved')){toast('Hoàn tất ngày đang chơi trước khi thêm ngày mới.');return;}
    setupMode=mode;$('setup-close').hidden=!current;$('setup-error').textContent='';$('setup-date').value=today();$('setup-duration').value=String(MIN_RACE_SECONDS);$('setup-rounds').value='10';$('setup-season-group').hidden=mode==='day';$('setup-roster-group').hidden=mode==='day';$('setup-names').required=mode==='season';$('setup-names').disabled=mode==='day';$('setup-season-name').required=mode==='season';$('setup-season-name').disabled=mode==='day';
    $('setup-title').textContent=mode==='day'?'Thêm ngày đua mới':'Mở mùa giải mới';$('setup-description').textContent=mode==='day'?`${season.name} · ${season.players.length} người. Điểm ngày mới bắt đầu từ 0, quỹ mùa tiếp tục cộng dồn.`:'Không giới hạn số ngày. Danh sách người chơi giữ nguyên trong mùa.';$('setup-submit').textContent=mode==='day'?'Tạo ngày & chọn vịt ↗':'Tạo mùa & bắt đầu ngày đầu ↗';
    if(mode==='day'){const days=seasonDays(season).sort((a,b)=>a.date.localeCompare(b.date)),last=days.at(-1)?.date;if(last&&last>=$('setup-date').value){const d=new Date(`${last}T12:00:00`);d.setDate(d.getDate()+1);$('setup-date').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}}
    else{$('setup-season-name').value=`Mùa giải ${store.seasons.length+1}`;if(names)$('setup-names').value=names.join('\n');else if(current)$('setup-names').value=current.session.players.map(p=>p.name).join('\n');}
    open('setup-dialog');
  }
  function create(event){
    event.preventDefault();if(current?.active)return;$('setup-error').textContent='';try{
      const date=$('setup-date').value;let season;
      if(setupMode==='season'){if(openSeason())throw Error('Cần chốt mùa đang mở trước.');season=S.createSeason({name:$('setup-season-name').value,names:$('setup-names').value.split(/\r?\n/).map(n=>n.trim()).filter(Boolean),date});}
      else{season=openSeason();if(!season)throw Error('Không có mùa đang mở.');const days=seasonDays(season);if(days.some(s=>T.coffeeStatus(s).status!=='resolved'))throw Error('Hoàn tất ngày đang chơi trước.');if(days.some(s=>s.date>=date))throw Error('Ngày mới phải sau ngày thi đấu gần nhất và không được trùng ngày.');}
      const duration=Number($('setup-duration').value);if(!(duration>=MIN_RACE_SECONDS))throw Error(`Mỗi lượt đua tối thiểu ${MIN_RACE_SECONDS} giây để kịp xem hết hiệu ứng.`);
      const s=T.createSession({names:season.players.map(p=>p.name),date,duration,roundLimit:Number($('setup-rounds').value)});S.validateSeason(season,[...seasonDays(season),s]);
      if(setupMode==='season')store.seasons.push(season);clearRace();current={seasonId:season.id,session:s,type:'regular',stage:'picking',picks:{},active:null,rule:drawDayRule()};store.sessions.push(current);document.querySelector('main').hidden=false;store.currentId=s.id;store.currentSeasonId=season.id;selected=s.players[0].id;save();close('setup-dialog');$('restore-notice').hidden=true;render();
    }catch(e){$('setup-error').textContent=e.message;}
  }
  function restoreCurrent(){
    clearRace();if(!current)return;selected=participants()[0]?.id;
    if(current.active){race=(engineFor(current.active.engine)||DuckRaceEngine).createRace(participants().map((_,i)=>A.name(i)),current.session.duration,current.active.seed,current.active.lineup);phase='paused';sprintAnnounced=false;leadersKey='';render();makeTrack();$('timer').textContent=clock(race.duration-current.active.elapsed);$('arena-title').textContent='Cuộc đua đang chờ bạn';$('race-overlay').hidden=false;$('overlay-number').textContent='Ⅱ';$('overlay-text').textContent='Đã khôi phục. Tiếp tục cùng cuộc đua.';$('resume-overlay').hidden=false;$('race-status').textContent=current.active.engine?'Đã giữ nguyên thiên phú, skill, rune và diễn biến; chưa cộng điểm lượt này.':'Trận đang dở dùng luật cũ; trận tiếp theo sẽ có thiên phú, skill và rune.';$('sprint-label').textContent='ĐANG TẠM DỪNG';}
    else render();
  }
  function showSessions(){
    if(current?.active)return;const fragment=document.createDocumentFragment();
    const addDay=e=>{const b=node('button','session-card'),text=node('span');b.dataset.sessionId=e.session.id;text.append(node('strong','',`Ngày ${dateLabel(e.session.date)}`),node('small','',`${e.session.players.length} người · ${e.session.rounds.length}/${e.session.roundLimit} vòng${e.active?' · đang tạm dừng':''}`));b.append(text,node('span','',T.coffeeStatus(e.session).status==='resolved'?'Đã chốt ✓':'Tiếp tục →'));b.onclick=()=>{current=e;store.currentId=e.session.id;store.currentSeasonId=e.seasonId;save();close('sessions-dialog');restoreCurrent();};fragment.append(b);};
    for(const season of [...store.seasons].reverse()){const h=node('div','season-archive-title'),title=node('strong','',`${season.name} · ${season.closedAt?'Đã kết thúc':'Đang diễn ra'}`),fund=node('button','button outline','Xem quỹ ↗');fund.dataset.seasonFundId=season.id;fund.onclick=()=>{close('sessions-dialog');showFund(season.id);};h.append(title,fund);fragment.append(h);store.sessions.filter(e=>e.seasonId===season.id).slice().reverse().forEach(addDay);}
    const legacy=store.sessions.filter(e=>!e.seasonId);if(legacy.length){fragment.append(node('h3','season-archive-title','Trước mùa giải · giữ luật cũ, không tính tiền hồi tố'));[...legacy].reverse().forEach(addDay);}
    if(!store.sessions.length)fragment.append(node('p','empty','Chưa có mùa giải nào.'));$('sessions-list').replaceChildren(fragment);open('sessions-dialog');
  }

  $('setup-form').addEventListener('submit',create);$('new-game').onclick=()=>openSetup('season');$('new-day').onclick=()=>openSetup('day');$('setup-close').onclick=()=>close('setup-dialog');$('setup-dialog').addEventListener('cancel',e=>{if(!current)e.preventDefault();});
  $('sample-names').onclick=()=>{$('setup-names').value='Phú\nHiếu\nAn\nBình\nChi\nDũng\nHà';};
  $('random-picks').onclick=randomPicks;$('undo-last-pick').onclick=undoPick;$('star-toggle').onclick=()=>{if(!current||current.active||current.stage!=='picking'||$('star-toggle').hidden||$('star-toggle').disabled)return;starArmed=!starArmed;render();};$('start').onclick=start;$('pause').onclick=pause;$('resume-overlay').onclick=pause;$('next').onclick=next;
  $('season-fund').onclick=()=>showFund();$('fund-close').onclick=()=>close('fund-dialog');$('export-fund').onclick=exportFund;$('close-season').onclick=requestCloseSeason;$('close-season-close').onclick=()=>close('close-season-dialog');$('confirm-close-season').onclick=confirmCloseSeason;
  $('cancel-season').onclick=requestCancelSeason;$('cancel-season-close').onclick=()=>close('cancel-season-dialog');$('confirm-cancel-season').onclick=confirmCancelSeason;
  $('result-close').onclick=()=>close('result-dialog');$('result-next').onclick=()=>dialogAction();$('export').onclick=exportCsv;$('saved-games').onclick=showSessions;$('sessions-close').onclick=()=>close('sessions-dialog');
  $('final-summary').onclick=()=>{if(outcome().status==='tie'){if(current.stage==='picking'&&current.type==='tie'){toast('Chọn vịt cho nhóm đồng điểm ở bên dưới.');return;}next();}else{current.stage='complete';save();render();showFinal();}};
  $('slow-fx').onclick=()=>{slowFx=!slowFx;try{localStorage.setItem(SLOW_FX_KEY,slowFx?'1':'0');}catch{}setSlowFx();};
  $('sound').onclick=()=>{sound=!sound;try{localStorage.setItem(SOUND_KEY,sound?'1':'0');}catch{}if(!sound){endAmbience();window.speechSynthesis?.cancel?.();}setSound();activateAudio();tone(700);};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.body.requestFullscreen)await document.body.requestFullscreen();else toast('Dùng phím F11 để mở toàn màn hình.');}catch{toast('Dùng phím F11 để mở toàn màn hình.');}};
  document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||e.ctrlKey||e.altKey||e.metaKey||e.target.closest('input,textarea,button,a,select')||document.querySelector('dialog[open]'))return;e.preventDefault();if(current?.active)pause();else if(current?.stage==='picking')start();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&current?.active)save();});window.addEventListener('pagehide',()=>{if(current)save();});
  new ResizeObserver(measure).observe($('river'));
  window.speechSynthesis?.getVoices?.(); // Chrome loads its voice list lazily: ask early so the first comment finds it
  load();setSound();setSlowFx();if(current){restoreCurrent();$('restore-notice').textContent=current.active?'Đã khôi phục lượt đang đua ở trạng thái tạm dừng. Bấm Tiếp tục; lựa chọn và mô phỏng được giữ nguyên.':isLegacy()?'Dữ liệu trước mùa giải được giữ nguyên trong Lịch sử; không tính tiền hồi tố. Bấm Mùa mới để bắt đầu quỹ.':'Đã khôi phục mùa giải, điểm và quỹ. Mùa chỉ kết thúc khi bạn bấm Chốt mùa.';$('restore-notice').hidden=false;}else openSetup('season');
})();

import { useState, useEffect, useRef } from "react";

/* ═══════ CONSTANTS ═══════ */
const BLUE="#2E75B6",RED="#C00000",DARK="#0a0a0f",LIGHT_BG="#f0f2f5",CARD_D="#12121a",CARD_L="#ffffff",BORDER_D="#1e1e2e",BORDER_L="#e0e0e0",TXT_D="#e2e2e8",TXT_L="#1a1a2a",DIM_D="#8888a0",DIM_L="#666680",GREEN="#00cc66",ORANGE="#ff8800",YELLOW="#ffcc00",LOGO="/CREED_LOGO.png";

/* ═══════ STORAGE ═══════ */
function ld(k,fb){try{const v=localStorage.getItem("creed_"+k);return v?JSON.parse(v):fb}catch{return fb}}
function sv(k,v){localStorage.setItem("creed_"+k,JSON.stringify(v))}

/* ═══════ THEME HOOK ═══════ */
function useTheme(){
  const [dark,setDark]=useState(()=>ld("dark_mode",true));
  useEffect(()=>{sv("dark_mode",dark)},[dark]);
  const t={
    bg:dark?DARK:LIGHT_BG, card:dark?CARD_D:CARD_L, border:dark?BORDER_D:BORDER_L,
    txt:dark?TXT_D:TXT_L, dim:dark?DIM_D:DIM_L, dark,
    inputBg:dark?"#1a1a28":"#f5f5f8", headerBg:dark?`linear-gradient(135deg,${DARK},#14142a)`:`linear-gradient(135deg,#e8edf5,#f0f2f5)`,
  };
  return [t,dark,setDark];
}

/* ═══════ DEFAULT DATA ═══════ */
const DEF_USERS=[
  {id:"u1",email:"admin@creedhandyman.com",password:"Creed2026!",name:"Bernard",role:"owner",rate:55,startDate:"2024-01-01",empNum:"001",totalHours:0},
  {id:"u2",email:"tech@creedhandyman.com",password:"CreedTech1",name:"Tech 1",role:"tech",rate:35,startDate:"2024-06-01",empNum:"002",totalHours:0},
  {id:"u3",email:"manager@creedhandyman.com",password:"CreedMgr1",name:"Manager",role:"manager",rate:45,startDate:"2024-03-01",empNum:"003",totalHours:0},
];

/* ═══════ CSS ═══════ */
const mkCss=(t)=>`
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:${t.bg};color:${t.txt};font-family:'Source Sans 3',sans-serif}
h1,h2,h3,h4,h5{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.05em}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:${t.bg}}::-webkit-scrollbar-thumb{background:${BLUE};border-radius:3px}
input,textarea,select{background:${t.inputBg};border:1px solid ${t.border};color:${t.txt};padding:10px 14px;border-radius:8px;font-family:'Source Sans 3',sans-serif;font-size:14px;outline:none;width:100%}
input:focus,textarea:focus,select:focus{border-color:${BLUE}}
button{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;border:none;transition:all .2s}
.bb{background:${BLUE};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.br{background:${RED};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.bg{background:${GREEN};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.bo{background:transparent;border:1px solid ${t.border};color:${t.dim};padding:8px 16px;border-radius:8px;font-size:13px}
.bo:hover{border-color:${BLUE};color:${BLUE}}
.cd{background:${t.card};border:1px solid ${t.border};border-radius:12px;padding:20px}
@keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:fi .3s ease forwards}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.mt{margin-top:16px}.mb{margin-bottom:16px}
.sv{font-size:28px;font-family:'Oswald',sans-serif;font-weight:700}
.sl{font-size:11px;color:${t.dim};font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.1em}
.sep{border-bottom:1px solid ${t.border};padding:8px 0}
.toggle{position:relative;width:48px;height:26px;border-radius:13px;cursor:pointer;transition:.3s}
.toggle-knob{position:absolute;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.3s}
`;

/* ═══════ PARSER ═══════ */
function parseZI(text){
  if(!text||text.trim().length<50)return[];
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  const rooms=[];let cur=null;
  const RP=[/^(Kitchen)\b/i,/^(Appliances)\b/i,/^(Laundry\s*Room)\b/i,/^(Living\s*Room)\b/i,/^(Dining\s*Room)\b/i,/^(Entry)\b/i,/^(Hallway\/Stairs)\b/i,/^(Bedroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Bathroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Garage\/Parking)\b/i,/^(Compliance\s*[:\-]?\s*\w*)/i,/^(Exterior\s*[:\-]?\s*\w*)/i];
  const SKIP=new Set(["Image","View Image","View Video","None","S","F","P","D","-","Detail","Condition","Actions","Comment","Media"]);
  const isSkip=l=>SKIP.has(l)||/^\d{4}-\d{2}-\d{2}/.test(l)||/^\d+\.\d+,\s*-?\d+/.test(l)||l.startsWith("Page ")||l.startsWith("Report generated")||l==="Maintenance";
  for(let i=0;i<lines.length;i++){
    const line=lines[i];let rm=null;
    for(const p of RP){const m=line.match(p);if(m&&line.length<50&&!line.includes("Condition")){rm=m[1];break}}
    if(rm){cur={name:rm.replace(/\s+/g," ").replace(/:/g," ").trim(),items:[]};rooms.push(cur);continue}
    if(!cur||line!=="Maintenance")continue;
    let detail="",cond="-";
    for(let j=i-1;j>=Math.max(0,i-5);j--){const p=lines[j];if(["S","F","P","D"].includes(p)){cond=p;continue}if(p==="-")continue;if(isSkip(p))continue;if(p.length>2&&!detail){detail=p;break}}
    let comment="";
    for(let j=i+1;j<Math.min(lines.length,i+8);j++){const n=lines[j];if(isSkip(n))continue;if(n==="Maintenance"||n==="None")break;let nr=false;for(const p of RP){if(p.test(n)&&n.length<50){nr=true;break}}if(nr)break;if(n.length>3){comment+=(comment?" ":"")+n}if(comment.length>20)break}
    if(detail||comment)cur.items.push({id:Math.random().toString(36).slice(2,8),detail:detail||"General",condition:cond,comment:comment||"Maintenance required",laborHrs:autoLabor(comment+" "+detail),materials:autoMat(comment+" "+detail)});
  }
  return rooms.filter(r=>r.items.length>0);
}

function autoLabor(t){t=t.toLowerCase();if(t.includes("full replace")||t.includes("full repaint")||t.includes("complete repaint"))return 6;if(t.includes("replace")&&(t.includes("floor")||t.includes("carpet")||t.includes("tile")))return 5;if(t.includes("water damage"))return 8;if(t.includes("repaint")||t.includes("full paint"))return 5;if(t.includes("replace door"))return 2.5;if(t.includes("refinish")||t.includes("tile wall"))return 10;if(t.includes("touch up")||t.includes("touch-up"))return 1.5;if(t.includes("patch")&&t.includes("paint"))return 2;if(t.includes("install")&&!t.includes("bulb"))return 1;if(t.includes("replace"))return 1;if(t.includes("repair"))return 1;if(t.includes("bulb")||t.includes("battery")||t.includes("filter"))return 0.25;if(t.includes("secure")||t.includes("tighten"))return 0.5;if(t.includes("caulk"))return 0.75;return 1}

function autoMat(t){t=t.toLowerCase();const m=[];
if(t.includes("paint")&&(t.includes("full")||t.includes("repaint")))m.push({name:"Paint+primer(gal)",cost:70},{name:"Supplies",cost:22});
else if(t.includes("paint"))m.push({name:"Paint(qt)",cost:20});
if(t.includes("carpet"))m.push({name:"Carpet+pad",cost:255});
if(t.includes("tile")&&t.includes("floor"))m.push({name:"Floor tile+thinset",cost:160});
if(t.includes("tile")&&t.includes("wall"))m.push({name:"Wall tile+thinset",cost:190});
if(t.includes("blind"))m.push({name:"Blind",cost:18});
if(t.includes("door")&&t.includes("replace"))m.push({name:"Door+hardware",cost:80});
if(t.includes("knob")||t.includes("doorknob"))m.push({name:"Door knob",cost:16});
if(t.includes("smoke alarm")||t.includes("smoke detector"))m.push({name:"Smoke alarm",cost:20});
if(t.includes("battery"))m.push({name:"9V battery",cost:5});
if(t.includes("bulb"))m.push({name:"Light bulbs",cost:10});
if(t.includes("fire ext"))m.push({name:"Fire extinguisher",cost:28});
if(t.includes("caulk"))m.push({name:"Caulk",cost:9});
if(t.includes("shower head"))m.push({name:"Shower head",cost:22});
if(t.includes("flapper")||t.includes("fill valve"))m.push({name:"Toilet kit",cost:17});
if(t.includes("hinge"))m.push({name:"Hinges",cost:14});
if(t.includes("flooring")||t.includes("lvp"))m.push({name:"LVP flooring",cost:145});
if(t.includes("sprayer"))m.push({name:"Sprayer",cost:17});
if(t.includes("bifold"))m.push({name:"Bifold door",cost:70});
if(t.includes("fixture"))m.push({name:"Light fixture",cost:33});
if(t.includes("screen"))m.push({name:"Screen kit",cost:14});
if(t.includes("mirror"))m.push({name:"Mirror",cost:33});
if(t.includes("towel bar"))m.push({name:"Towel bar",cost:16});
if(t.includes("tp holder")||t.includes("toilet paper"))m.push({name:"TP holder",cost:12});
if(t.includes("refinish"))m.push({name:"Refinish kit",cost:55});
if(t.includes("latch")||t.includes("gate"))m.push({name:"Latch",cost:14});
if(t.includes("downspout"))m.push({name:"Downspout",cost:22});
if(t.includes("transition"))m.push({name:"Transition strip",cost:14});
if(t.includes("striker"))m.push({name:"Striker plate",cost:7});
if(t.includes("stopper"))m.push({name:"Drain stopper",cost:9});
if(m.length===0)m.push({name:"Materials",cost:17});
return m}

function classifyItems(rooms){
  const c=[],im=[],mi=[];
  rooms.forEach(r=>r.items.forEach(item=>{
    const e={room:r.name,...item};
    const t=(item.comment+" "+item.detail).toLowerCase();
    // CRITICAL: Safety hazards, code violations, structural/water damage
    if(t.includes("water damage")||t.includes("water intrusion")||t.includes("ungrounded")||t.includes("missing smoke")||t.includes("smoke alarm")&&(t.includes("missing")||t.includes("no "))||t.includes("fire ext")&&t.includes("missing")||t.includes("electrician")||t.includes("code compliance")||t.includes("carbon monoxide")||t.includes("structural")||t.includes("mold")){c.push(e);return}
    // IMPORTANT: Damaged items, full replacements, functional issues
    if(item.condition==="D"||t.includes("broken")||t.includes("horrible")||t.includes("severe")||t.includes("full replace")||t.includes("cracked")&&!t.includes("surface")||t.includes("detached")||t.includes("missing door")||t.includes("off track")||t.includes("failed")){im.push(e);return}
    // MINOR: Everything else - cosmetic, touch-ups, minor repairs
    mi.push(e);
  }));
  return{critical:c,important:im,minor:mi};
}

function buildGuide(rooms){
  const tools=new Set(["Drill/driver","Tape measure","Level","Utility knife","Caulk gun","Putty knife","PPE","Step ladder","Shop vac"]);
  const shopping=[],steps=[];
  rooms.forEach(r=>r.items.forEach(item=>{
    const t=(item.comment+" "+item.detail).toLowerCase();
    if(t.includes("paint")){tools.add("4\" roller frame + covers");tools.add("2\" angled brush");tools.add("Drop cloths");tools.add("Painter's tape");tools.add("Paint tray");tools.add("Spackle knife set")}
    if(t.includes("tile")){tools.add("Tile cutter/wet saw");tools.add("Notched trowel");tools.add("Grout float");tools.add("Tile spacers");tools.add("Mixing bucket")}
    if(t.includes("carpet")||t.includes("floor")){tools.add("Pry bar");tools.add("Rubber mallet");tools.add("Pull bar");tools.add("Tapping block")}
    if(t.includes("plumb")||t.includes("shower")||t.includes("toilet")||t.includes("faucet")||t.includes("sprayer")){tools.add("Adjustable wrench");tools.add("Plumber's tape");tools.add("Basin wrench");tools.add("Bucket")}
    if(t.includes("electric")||t.includes("outlet")||t.includes("switch")){tools.add("Voltage tester");tools.add("Wire strippers");tools.add("Electrical tape")}
    if(t.includes("door")||t.includes("hinge")){tools.add("Chisel set");tools.add("Hammer");tools.add("Shims")}
    if(t.includes("bush")||t.includes("landscap")){tools.add("Pruning shears");tools.add("Shovel");tools.add("Yard bags")}
    if(t.includes("caulk")){tools.add("Caulk removal tool");tools.add("Caulk smoothing tool")}
    if(t.includes("blind")){tools.add("Hacksaw (for cutting blinds)")}
    // Build shopping list from materials
    item.materials.forEach(m=>shopping.push({...m,room:r.name,detail:item.detail}));
    // Build step-by-step
    const priority=item.condition==="D"?"HIGH":item.condition==="P"?"MED":"LOW";
    steps.push({room:r.name,detail:item.detail,action:item.comment,priority,hrs:item.laborHrs});
  }));
  // Sort steps: HIGH priority first
  steps.sort((a,b)=>{const o={HIGH:0,MED:1,LOW:2};return o[a.priority]-o[b.priority]});
  return{tools:[...tools].sort(),shopping,steps};
}

function calcLine(item,rate){
  const lc=item.laborHrs*rate;
  const mc=item.materials.reduce((s,m)=>s+m.cost,0);
  return{laborCost:lc,matCost:mc,total:Math.round((lc+mc)*100)/100};
}

/* ═══════ MAIN APP ═══════ */
export default function App(){
  const [theme,dark,setDark]=useTheme();
  const [user,setUser]=useState(()=>ld("user",null));
  const [users,setUsers]=useState(()=>ld("users",DEF_USERS));
  const [page,setPage]=useState("dashboard");
  const [jobs,setJobs]=useState(()=>ld("jobs",[]));
  const [timeEntries,setTimeEntries]=useState(()=>ld("time",[]));
  const [testimonials,setTestimonials]=useState(()=>ld("reviews",[]));
  const [referrals,setReferrals]=useState(()=>ld("referrals",[]));
  const [quests,setQuests]=useState(()=>ld("quests",[
    {id:1,title:"Complete 5 jobs",progress:0,target:5,xp:100,type:"jobs"},
    {id:2,title:"Get 3 five-star reviews",progress:0,target:3,xp:75,type:"reviews"},
    {id:3,title:"Earn 5 referrals",progress:0,target:5,xp:50,type:"referrals"},
  ]));
  const [schedule,setSchedule]=useState(()=>ld("schedule",[]));
  const [payHistory,setPayHistory]=useState(()=>ld("payhistory",[]));
  const [showSettings,setShowSettings]=useState(false);
  const [menuRight,setMenuRight]=useState(()=>ld("menu_right",true));

  // Persist
  useEffect(()=>{sv("user",user)},[user]);
  useEffect(()=>{sv("users",users)},[users]);
  useEffect(()=>{sv("jobs",jobs)},[jobs]);
  useEffect(()=>{sv("time",timeEntries)},[timeEntries]);
  useEffect(()=>{sv("reviews",testimonials)},[testimonials]);
  useEffect(()=>{sv("referrals",referrals)},[referrals]);
  useEffect(()=>{sv("quests",quests)},[quests]);
  useEffect(()=>{sv("schedule",schedule)},[schedule]);
  useEffect(()=>{sv("payhistory",payHistory)},[payHistory]);
  useEffect(()=>{sv("menu_right",menuRight)},[menuRight]);

  // Auto-update quests
  useEffect(()=>{
    const completed=jobs.filter(j=>j.status==="complete").length;
    const revCount=testimonials.filter(t=>t.rating===5).length;
    const refCount=referrals.filter(r=>r.status==="converted").length;
    setQuests(p=>p.map(q=>{
      if(q.type==="jobs")return{...q,progress:Math.min(completed,q.target)};
      if(q.type==="reviews")return{...q,progress:Math.min(revCount,q.target)};
      if(q.type==="referrals")return{...q,progress:Math.min(refCount,q.target)};
      return q;
    }));
  },[jobs,testimonials,referrals]);

  // Get user rate
  const getRate=(uid)=>{const u=users.find(x=>x.id===uid||x.email===uid);return u?u.rate:55};

  if(!user)return <Login users={users} setUsers={setUsers} setUser={setUser} theme={theme}/>;

  // Settings overlay
  if(showSettings)return(
    <div style={{minHeight:"100vh",background:theme.bg}}>
      <style>{mkCss(theme)}</style>
      <Settings user={user} setUser={setUser} users={users} setUsers={setUsers} theme={theme}
        dark={dark} setDark={setDark} menuRight={menuRight} setMenuRight={setMenuRight}
        onClose={()=>setShowSettings(false)}/>
    </div>
  );

  // NAV order: Quest > Payroll > Time > [LOGO] > Jobs > QuoteForge > Dashboard
  const NAV_LEFT=[{id:"dashboard",l:"Dash",i:"◆"},{id:"quoteforge",l:"Quote",i:"⚡"},{id:"jobs",l:"Jobs",i:"📋"}];
  const NAV_RIGHT=[{id:"time",l:"Time",i:"⏱"},{id:"payroll",l:"Pay",i:"💰"},{id:"quests",l:"Quest",i:"🎯"}];

  const navOrder=menuRight?[...NAV_LEFT,...NAV_RIGHT]:[...NAV_RIGHT,...NAV_LEFT];

  return(
    <div style={{minHeight:"100vh",background:theme.bg}}>
      <style>{mkCss(theme)}</style>
      {/* HEADER */}
      <header style={{background:theme.headerBg,borderBottom:`1px solid ${theme.border}`,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)"}}>
        {menuRight?<>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {NAV_LEFT.map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"5px 10px",borderRadius:6,fontSize:10,background:page===n.id?BLUE:"transparent",color:page===n.id?"#fff":theme.dim,fontFamily:"'Oswald'",letterSpacing:".06em"}}>{n.i} {n.l}</button>)}
          </div>
          <img src={LOGO} alt="Creed" style={{height:36,borderRadius:6,cursor:"pointer"}} onClick={()=>setShowSettings(true)} onError={e=>e.target.style.display="none"}/>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {NAV_RIGHT.map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"5px 10px",borderRadius:6,fontSize:10,background:page===n.id?BLUE:"transparent",color:page===n.id?"#fff":theme.dim,fontFamily:"'Oswald'",letterSpacing:".06em"}}>{n.i} {n.l}</button>)}
          </div>
        </>:<>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {NAV_RIGHT.map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"5px 10px",borderRadius:6,fontSize:10,background:page===n.id?BLUE:"transparent",color:page===n.id?"#fff":theme.dim,fontFamily:"'Oswald'",letterSpacing:".06em"}}>{n.i} {n.l}</button>)}
          </div>
          <img src={LOGO} alt="Creed" style={{height:36,borderRadius:6,cursor:"pointer"}} onClick={()=>setShowSettings(true)} onError={e=>e.target.style.display="none"}/>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {NAV_LEFT.map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"5px 10px",borderRadius:6,fontSize:10,background:page===n.id?BLUE:"transparent",color:page===n.id?"#fff":theme.dim,fontFamily:"'Oswald'",letterSpacing:".06em"}}>{n.i} {n.l}</button>)}
          </div>
        </>}
      </header>

      <main style={{maxWidth:1200,margin:"0 auto",padding:"16px 12px"}}>
        {page==="dashboard"&&<Dash jobs={jobs} timeEntries={timeEntries} quests={quests} setPage={setPage} user={user} theme={theme}/>}
        {page==="quoteforge"&&<QF jobs={jobs} setJobs={setJobs} schedule={schedule} setSchedule={setSchedule} user={user} theme={theme}/>}
        {page==="jobs"&&<JobsPage jobs={jobs} setJobs={setJobs} schedule={schedule} setSchedule={setSchedule} theme={theme}/>}
        {page==="time"&&<TT timeEntries={timeEntries} setTimeEntries={setTimeEntries} jobs={jobs} user={user} getRate={getRate} theme={theme}/>}
        {page==="payroll"&&<Pay timeEntries={timeEntries} setTimeEntries={setTimeEntries} users={users} user={user} payHistory={payHistory} setPayHistory={setPayHistory} getRate={getRate} theme={theme}/>}
        {page==="quests"&&<QuestsPage quests={quests} testimonials={testimonials} setTestimonials={setTestimonials} referrals={referrals} setReferrals={setReferrals} theme={theme}/>}
      </main>
    </div>
  );
}

/* ═══════ LOGIN ═══════ */
function Login({users,setUsers,setUser,theme}){
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [name,setName]=useState("");
  const [err,setErr]=useState("");
  const login=()=>{const u=users.find(u=>u.email===email&&u.password===pass);if(u){setUser(u);setErr("")}else setErr("Invalid credentials")};
  const signup=()=>{if(!email||!pass||!name){setErr("Fill all fields");return}if(users.find(u=>u.email===email)){setErr("Email exists");return}const u={id:"u"+Date.now(),email,password:pass,name,role:"tech",rate:35,startDate:new Date().toISOString().split("T")[0],empNum:String(users.length+1).padStart(3,"0"),totalHours:0};setUsers(p=>[...p,u]);setUser(u)};
  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${DARK},#0d1530)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{mkCss(theme)}</style>
      <div style={{width:360}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <img src={LOGO} alt="" style={{height:80,marginBottom:8}} onError={e=>e.target.style.display="none"}/>
          <h1 style={{color:BLUE,fontSize:26}}>Creed Handyman</h1>
          <div style={{color:RED,fontSize:11,fontFamily:"'Oswald'",letterSpacing:".15em",marginTop:2}}>LLC</div>
        </div>
        <div className="cd" style={{padding:24,background:CARD_D,border:`1px solid ${BORDER_D}`}}>
          <h3 style={{textAlign:"center",marginBottom:16,color:TXT_D}}>{mode==="login"?"Sign In":"Create Account"}</h3>
          {mode==="signup"&&<div style={{marginBottom:10}}><label style={{fontSize:11,color:DIM_D}}>Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{background:"#1a1a28",color:TXT_D,border:`1px solid ${BORDER_D}`}}/></div>}
          <div style={{marginBottom:10}}><label style={{fontSize:11,color:DIM_D}}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="creed@example.com" style={{background:"#1a1a28",color:TXT_D,border:`1px solid ${BORDER_D}`}}/></div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,color:DIM_D}}>Password</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(mode==="login"?login():signup())} style={{background:"#1a1a28",color:TXT_D,border:`1px solid ${BORDER_D}`}}/></div>
          {err&&<div style={{color:RED,fontSize:13,marginBottom:10,textAlign:"center"}}>{err}</div>}
          <button className="bb" onClick={mode==="login"?login:signup} style={{width:"100%",padding:12,fontSize:15}}>{mode==="login"?"Sign In":"Sign Up"}</button>
          <div style={{textAlign:"center",marginTop:14,fontSize:13,color:DIM_D}}>{mode==="login"?"No account? ":"Have account? "}<span onClick={()=>{setMode(mode==="login"?"signup":"login");setErr("")}} style={{color:BLUE,cursor:"pointer",textDecoration:"underline"}}>{mode==="login"?"Sign Up":"Sign In"}</span></div>
        </div>
        <div style={{textAlign:"center",marginTop:16,color:DIM_D,fontSize:10}}>Lic #6145054 · Wichita, KS · (316) 252-6335</div>
      </div>
    </div>
  );
}

/* ═══════ SETTINGS ═══════ */
function Settings({user,setUser,users,setUsers,theme,dark,setDark,menuRight,setMenuRight,onClose}){
  const [tab,setTab]=useState("account");
  const [newPass,setNewPass]=useState("");
  const [editUser,setEditUser]=useState(null);
  const [editRate,setEditRate]=useState("");

  const changePass=()=>{if(!newPass||newPass.length<6){alert("Min 6 chars");return}setUsers(p=>p.map(u=>u.id===user.id?{...u,password:newPass}:u));setUser({...user,password:newPass});setNewPass("");alert("Password updated")};
  const updateEmpRate=(uid,rate)=>{setUsers(p=>p.map(u=>u.id===uid?{...u,rate:parseFloat(rate)||0}:u))};

  return(
    <div className="fi" style={{maxWidth:600,margin:"0 auto",padding:"20px 16px"}}>
      <div className="row mb"><button className="bo" onClick={onClose}>← Back</button><h2 style={{fontSize:22,color:BLUE}}>Settings</h2></div>

      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {["account","employees","general"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"6px 14px",borderRadius:6,fontSize:12,background:tab===t?BLUE:"transparent",color:tab===t?"#fff":theme.dim,fontFamily:"'Oswald'"}}>{t}</button>)}
      </div>

      {tab==="account"&&<div>
        <div className="cd mb">
          <h4 style={{marginBottom:12}}>Account Info</h4>
          <div className="sep"><span style={{color:theme.dim}}>Name:</span> {user.name}</div>
          <div className="sep"><span style={{color:theme.dim}}>Email:</span> {user.email}</div>
          <div className="sep"><span style={{color:theme.dim}}>Role:</span> {user.role}</div>
          <div className="sep"><span style={{color:theme.dim}}>Employee #:</span> {user.empNum||"—"}</div>
          <div className="sep"><span style={{color:theme.dim}}>Rate:</span> ${user.rate||55}/hr</div>
          <div className="sep"><span style={{color:theme.dim}}>Start Date:</span> {user.startDate||"—"}</div>
        </div>
        <div className="cd mb">
          <h4 style={{marginBottom:12}}>Change Password</h4>
          <div className="row"><input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} placeholder="New password (min 6)"/><button className="bb" onClick={changePass}>Update</button></div>
        </div>
        <div className="cd"><button className="br" onClick={()=>{setUser(null);onClose()}} style={{width:"100%"}}>Sign Out</button></div>
      </div>}

      {tab==="employees"&&<div>
        <div className="cd">
          <h4 style={{marginBottom:12}}>Team ({users.length})</h4>
          {users.map(u=>(
            <div key={u.id} className="sep">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontWeight:600}}>{u.name} <span style={{color:theme.dim,fontSize:12}}>({u.role})</span></div>
                  <div style={{fontSize:12,color:theme.dim}}>#{u.empNum} · {u.email} · Since {u.startDate}</div>
                </div>
                <div className="row">
                  <span style={{fontSize:13}}>$</span>
                  <input type="number" value={editUser===u.id?editRate:u.rate} style={{width:60,padding:"4px 6px",fontSize:13}}
                    onFocus={()=>{setEditUser(u.id);setEditRate(String(u.rate))}}
                    onChange={e=>setEditRate(e.target.value)}
                    onBlur={()=>{updateEmpRate(u.id,editRate);setEditUser(null)}}
                  /><span style={{fontSize:12,color:theme.dim}}>/hr</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {tab==="general"&&<div>
        <div className="cd mb">
          <h4 style={{marginBottom:12}}>Appearance</h4>
          <div className="sep" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Dark Mode</span>
            <div onClick={()=>setDark(!dark)} className="toggle" style={{background:dark?BLUE:"#ccc"}}>
              <div className="toggle-knob" style={{left:dark?25:3}}/>
            </div>
          </div>
        </div>
        <div className="cd mb">
          <h4 style={{marginBottom:12}}>Menu Layout</h4>
          <div className="sep" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Navigation Side</span>
            <div className="row">
              <button className={menuRight?"bo":"bb"} onClick={()=>setMenuRight(false)} style={{padding:"4px 12px",fontSize:11}}>Left</button>
              <button className={menuRight?"bb":"bo"} onClick={()=>setMenuRight(true)} style={{padding:"4px 12px",fontSize:11}}>Right</button>
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
}

/* ═══════ DASHBOARD ═══════ */
function Dash({jobs,timeEntries,quests,setPage,user,theme}){
  const totalRev=jobs.filter(j=>j.status==="complete").reduce((s,j)=>s+(j.total||0),0);
  const totalSpent=jobs.filter(j=>j.status==="complete").reduce((s,j)=>s+(j.receipts||[]).reduce((a,r)=>a+r.amount,0),0);
  const netEarnings=totalRev-totalSpent;
  const active=jobs.filter(j=>j.status==="active").length;
  const quoted=jobs.filter(j=>j.status==="quoted").length;
  const hrs=timeEntries.reduce((s,e)=>s+e.hours,0);

  return(
    <div className="fi">
      <h2 style={{fontSize:24,color:BLUE,marginBottom:16}}>Welcome, {user.name}</h2>
      <div className="g4 mb">
        {[{l:"Active",v:active,c:BLUE},{l:"Quoted",v:quoted,c:ORANGE},{l:"Net Earnings",v:"$"+netEarnings.toLocaleString(),c:GREEN},{l:"Hours",v:hrs.toFixed(1),c:YELLOW}].map((s,i)=>(
          <div key={i} className="cd" style={{borderLeft:`3px solid ${s.c}`}}><div className="sl">{s.l}</div><div className="sv" style={{color:s.c}}>{s.v}</div></div>
        ))}
      </div>
      <div className="g2">
        <div className="cd" style={{cursor:"pointer"}} onClick={()=>setPage("quoteforge")}><h3 style={{color:BLUE,marginBottom:6}}>⚡ QuoteForge</h3><p style={{color:theme.dim,fontSize:13}}>Parse inspections or build custom quotes</p><button className="bb mt">Launch →</button></div>
        <div className="cd"><h3 style={{color:ORANGE,marginBottom:6}}>🎯 Quests</h3>{quests.map(q=><div key={q.id} style={{marginTop:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{q.title}</span><span style={{color:BLUE}}>{q.progress}/{q.target}</span></div><div style={{height:4,background:theme.border,borderRadius:2,marginTop:3}}><div style={{height:4,background:q.progress>=q.target?GREEN:BLUE,borderRadius:2,width:`${Math.min(100,q.progress/q.target*100)}%`}}/></div></div>)}</div>
      </div>
      {/* Pipeline */}
      {jobs.length>0&&<div className="cd mt">
        <h3 style={{marginBottom:10}}>Pipeline</h3>
        {jobs.slice(-8).reverse().map(j=>{
          const spent=(j.receipts||[]).reduce((s,r)=>s+r.amount,0);
          const net=j.total-spent;
          return<div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13,alignItems:"center"}}>
            <span style={{flex:1}}>{j.property}</span>
            <span style={{color:theme.dim,marginRight:8}}>{j.status}</span>
            <span style={{color:j.status==="complete"?GREEN:theme.dim,fontFamily:"'Oswald'",minWidth:80,textAlign:"right"}}>
              {j.status==="complete"?`Net $${net.toFixed(0)}`:`$${j.total.toFixed(0)}`}
            </span>
          </div>
        })}
      </div>}
    </div>
  );
}

/* ═══════ QUOTEFORGE ═══════ */
function QF({jobs,setJobs,schedule,setSchedule,user,theme}){
  const [mode,setMode]=useState(null);
  const [text,setText]=useState("");
  const [prop,setProp]=useState("");
  const [client,setClient]=useState("");
  const [rooms,setRooms]=useState([]);
  const [tab,setTab]=useState("quote");
  const [nr,setNr]=useState("");const [nd,setNd]=useState("");const [nc,setNc]=useState("");const [nh,setNh]=useState("1");const [nm,setNm]=useState("20");
  const fileRef=useRef();
  const rate=user.rate||55;

  const doParse=()=>{if(!text.trim())return;const p=parseZI(text);if(p.length===0){alert("No items found. Paste the full report.");return}
    const pm=text.match(/([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way|Circle|Place))/i);if(pm&&!prop)setProp(pm[1].trim());
    setRooms(p);setMode("editing")};

  const handleFile=async(e)=>{
    const file=e.target.files[0];if(!file)return;
    if(file.type==="text/plain"||file.name.endsWith(".txt")){const t=await file.text();setText(t);setMode("paste")}
    else if(file.type==="application/pdf"){alert("PDF detected. For best results, open the PDF, select all text (Ctrl+A), copy (Ctrl+C), and paste it here.");setMode("paste")}
    else{alert("Upload a .txt file or paste report text directly.")}
  };

  const addItem=()=>{if(!nr||!nd)return;const item={id:Math.random().toString(36).slice(2,8),detail:nd,condition:"-",comment:nc||"Per scope",laborHrs:parseFloat(nh)||1,materials:[{name:"Materials",cost:parseFloat(nm)||0}]};const ex=rooms.find(r=>r.name===nr);if(ex){setRooms(rooms.map(r=>r.name===nr?{...r,items:[...r.items,item]}:r))}else{setRooms([...rooms,{name:nr,items:[item]}])}setNd("");setNc("");setNh("1");setNm("20");if(mode!=="editing")setMode("editing")};
  const rmItem=(rn,id)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.filter(i=>i.id!==id)}:r).filter(r=>r.items.length>0));
  const upItem=(rn,id,f,v)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.map(i=>i.id===id?{...i,[f]:v}:i)}:r));

  const all=rooms.flatMap(r=>r.items.map(i=>({room:r.name,...i,...calcLine(i,rate)})));
  const gt=all.reduce((s,i)=>s+i.total,0);
  const tl=all.reduce((s,i)=>s+i.laborCost,0);
  const tm=all.reduce((s,i)=>s+i.matCost,0);
  const th=all.reduce((s,i)=>s+i.laborHrs,0);
  const issues=classifyItems(rooms);
  const guide=buildGuide(rooms);

  const saveJob=()=>{if(!prop){alert("Enter property address");return}
    const job={id:Date.now(),property:prop,client:client||"",date:new Date().toISOString().split("T")[0],rooms:JSON.parse(JSON.stringify(rooms)),items:all,total:gt,totalLabor:tl,totalMat:tm,totalHrs:th,status:"quoted",receipts:[],createdBy:user.name};
    setJobs(p=>[...p,job]);
    alert("Job created: "+prop+" — $"+gt.toFixed(2));
    setMode(null);setRooms([]);setText("");setProp("");setClient("")};

  if(!mode)return(
    <div className="fi">
      <h2 style={{fontSize:24,color:BLUE,marginBottom:16}}>⚡ QuoteForge</h2>
      <div className="g3">
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:24}} onClick={()=>setMode("paste")}><div style={{fontSize:36,marginBottom:6}}>📄</div><h4 style={{color:BLUE}}>Parse Report</h4><p style={{color:theme.dim,fontSize:12,marginTop:6}}>Paste inspection text</p></div>
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:24}} onClick={()=>fileRef.current?.click()}><div style={{fontSize:36,marginBottom:6}}>📁</div><h4 style={{color:ORANGE}}>Upload File</h4><p style={{color:theme.dim,fontSize:12,marginTop:6}}>.txt file upload</p><input ref={fileRef} type="file" accept=".txt,.pdf" style={{display:"none"}} onChange={handleFile}/></div>
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:24}} onClick={()=>setMode("manual")}><div style={{fontSize:36,marginBottom:6}}>✏️</div><h4 style={{color:GREEN}}>Manual Quote</h4><p style={{color:theme.dim,fontSize:12,marginTop:6}}>Build from scratch</p></div>
      </div>
      {jobs.length>0&&<div className="cd mt"><h4 style={{marginBottom:8}}>Recent Quotes</h4>
        <div className="sl mb">Total: {jobs.length} jobs · ${jobs.reduce((s,j)=>s+j.total,0).toFixed(0)} pipeline</div>
        {jobs.slice(-5).reverse().map(j=><div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{j.property}</span><span style={{color:GREEN,fontFamily:"'Oswald'"}}>${j.total.toFixed(0)}</span></div>)}
      </div>}
    </div>
  );

  if(mode==="paste")return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>← Back</button><h2 style={{fontSize:20,color:BLUE}}>Parse Report</h2></div>
      <div className="cd">
        <p style={{color:theme.dim,fontSize:13,marginBottom:10}}>Paste the full text from any zInspector move-out report. The parser auto-detects rooms and maintenance items.</p>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste report text..." style={{height:220,fontFamily:"monospace",fontSize:11}}/>
        <div className="g2 mt"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property address"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client name"/></div>
        <div className="row mt"><button className="bb" onClick={doParse}>Parse →</button><button className="bo" onClick={()=>setMode("manual")}>Manual</button></div>
      </div>
    </div>
  );

  if(mode==="manual"&&rooms.length===0)return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>← Back</button><h2 style={{fontSize:20,color:ORANGE}}>Manual Quote</h2></div>
      <div className="cd mb"><div className="g2"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div></div>
      <div className="cd">
        <h4 style={{marginBottom:10}}>Add First Item</h4>
        <div className="g2 mb"><input value={nr} onChange={e=>setNr(e.target.value)} placeholder="Room"/><input value={nd} onChange={e=>setNd(e.target.value)} placeholder="Item"/></div>
        <input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Description" style={{marginBottom:10}}/>
        <div className="g2"><div><label style={{fontSize:11,color:theme.dim}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step="0.25"/></div><div><label style={{fontSize:11,color:theme.dim}}>Materials $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div>
        <button className="bg mt" onClick={addItem}>Add Item</button>
      </div>
    </div>
  );

  // EDITING
  return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>{setMode(null);setRooms([])}}>← Back</button><h2 style={{fontSize:20,color:BLUE}}>⚡ QuoteForge</h2><span style={{fontSize:11,color:theme.dim,fontFamily:"'Oswald'"}}>${rate}/HR</span></div>
      <div className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div style={{flex:"1 1 180px"}}><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *" style={{marginBottom:4}}/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div>
        <div style={{textAlign:"right"}}><div className="sl">Total</div><div style={{fontSize:32,fontFamily:"'Oswald'",fontWeight:700,color:GREEN}}>${gt.toFixed(2)}</div></div>
      </div>
      <div className="g4 mb">
        <div className="cd" style={{textAlign:"center",padding:10}}><div className="sl">Labor</div><div style={{fontSize:18,fontFamily:"'Oswald'",color:BLUE}}>${tl.toFixed(0)}</div><div style={{fontSize:10,color:theme.dim}}>{th.toFixed(1)}h</div></div>
        <div className="cd" style={{textAlign:"center",padding:10}}><div className="sl">Materials</div><div style={{fontSize:18,fontFamily:"'Oswald'",color:ORANGE}}>${tm.toFixed(0)}</div></div>
        <div className="cd" style={{textAlign:"center",padding:10}}><div className="sl">Items</div><div style={{fontSize:18,fontFamily:"'Oswald'",color:RED}}>{all.length}</div></div>
        <div className="cd" style={{textAlign:"center",padding:10}}><div className="sl">Est Days</div><div style={{fontSize:18,fontFamily:"'Oswald'",color:YELLOW}}>{(th/8).toFixed(1)}</div></div>
      </div>

      <div style={{display:"flex",gap:3,marginBottom:14,flexWrap:"wrap"}}>
        {[{id:"quote",l:"📄 Quote"},{id:"guide",l:"🔧 Guide"},{id:"watchout",l:"⚠️ Issues"},{id:"add",l:"➕ Add"}].map(x=><button key={x.id} onClick={()=>setTab(x.id)} style={{padding:"6px 14px",background:tab===x.id?BLUE:theme.card,color:tab===x.id?"#fff":theme.dim,border:`1px solid ${tab===x.id?BLUE:theme.border}`,borderRadius:"8px 8px 0 0",fontFamily:"'Oswald'",fontSize:12}}>{x.l}</button>)}
        <div style={{flex:1}}/><button className="bb" onClick={saveJob} style={{fontSize:12,padding:"6px 16px"}}>Save & Create Job</button>
      </div>

      {tab==="quote"&&rooms.map(room=>(
        <div key={room.name} style={{marginBottom:14}}>
          <h4 style={{color:BLUE,fontSize:14,marginBottom:4,paddingBottom:3,borderBottom:`1px solid ${theme.border}`}}>{room.name}</h4>
          {room.items.map(item=>{const{laborCost,matCost,total}=calcLine(item,rate);return(
            <div key={item.id} className="cd" style={{marginBottom:4,padding:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                <div style={{flex:"1 1 200px"}}>
                  <div className="row"><span style={{fontWeight:600,fontSize:13}}>{item.detail}</span>
                    <span className={`bd bd-${item.condition==="D"?"d":item.condition==="P"?"p":item.condition==="F"?"f":"s"}`} style={{padding:"1px 6px",fontSize:10}}>{item.condition==="D"?"DMG":item.condition==="P"?"POOR":item.condition==="F"?"FAIR":"—"}</span>
                  </div>
                  <div style={{fontSize:12,color:theme.dim,marginTop:2}}>{item.comment}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:9,color:theme.dim}}>HRS</div><input type="number" value={item.laborHrs} step="0.25" min="0" onChange={e=>upItem(room.name,item.id,"laborHrs",parseFloat(e.target.value)||0)} style={{width:50,textAlign:"center",padding:"2px",fontSize:12}}/></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:9,color:theme.dim}}>MAT$</div><input type="number" value={item.materials.reduce((s,m)=>s+m.cost,0)} step="1" min="0" onChange={e=>upItem(room.name,item.id,"materials",[{name:"Materials",cost:parseFloat(e.target.value)||0}])} style={{width:55,textAlign:"center",padding:"2px",fontSize:12}}/></div>
                  <div style={{textAlign:"right",minWidth:55}}><div style={{fontSize:9,color:theme.dim}}>TOTAL</div><div style={{fontSize:14,fontFamily:"'Oswald'",fontWeight:600,color:GREEN}}>${total.toFixed(0)}</div></div>
                  <button onClick={()=>rmItem(room.name,item.id)} style={{background:"none",color:RED,fontSize:14,padding:2}}>✕</button>
                </div>
              </div>
            </div>
          )})}
        </div>
      ))}

      {tab==="guide"&&<div>
        <div className="g2 mb">
          <div className="cd"><h4 style={{color:BLUE,marginBottom:8}}>🧰 Tools ({guide.tools.length})</h4>{guide.tools.map((t,i)=><div key={i} style={{padding:"4px 0",fontSize:13,borderBottom:`1px solid ${theme.border}`}}>☐ {t}</div>)}</div>
          <div className="cd"><h4 style={{color:ORANGE,marginBottom:8}}>🛒 Shopping (${guide.shopping.reduce((s,i)=>s+i.cost,0).toFixed(0)})</h4><div style={{maxHeight:350,overflowY:"auto"}}>{guide.shopping.map((s,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",borderBottom:`1px solid ${theme.border}`}}><span>{s.name} <span style={{color:theme.dim}}>({s.room})</span></span><span style={{color:GREEN}}>${s.cost}</span></div>)}</div></div>
        </div>
        <div className="cd">
          <h4 style={{color:GREEN,marginBottom:8}}>📋 Work Order ({guide.steps.length} tasks · {th.toFixed(1)}h est)</h4>
          {guide.steps.map((s,i)=><div key={i} style={{padding:"6px 0",borderBottom:`1px solid ${theme.border}`,fontSize:13}}>
            <div className="row">
              <span style={{fontSize:11,padding:"1px 6px",borderRadius:3,background:s.priority==="HIGH"?RED+"33":s.priority==="MED"?ORANGE+"33":GREEN+"33",color:s.priority==="HIGH"?RED:s.priority==="MED"?ORANGE:GREEN}}>{s.priority}</span>
              <span style={{fontWeight:600,color:BLUE}}>{s.room}</span>
              <span style={{color:theme.dim}}>→</span>
              <span>{s.detail}</span>
              <span style={{color:theme.dim,fontSize:11}}>({s.hrs}h)</span>
            </div>
            <div style={{color:theme.dim,fontSize:12,marginLeft:4,marginTop:2}}>{s.action}</div>
          </div>)}
        </div>
      </div>}

      {tab==="watchout"&&<div>
        {[{t:"🚨 Critical — Safety & Code",items:issues.critical,c:RED},{t:"⚠️ Important — Damaged/Major",items:issues.important,c:ORANGE},{t:"💡 Minor — Cosmetic/Small",items:issues.minor,c:YELLOW}].map((s,i)=><div key={i} className="cd mb" style={{borderLeft:`3px solid ${s.c}`}}><h4 style={{color:s.c,marginBottom:6,fontSize:14}}>{s.t} ({s.items.length})</h4>{s.items.length===0?<span style={{color:theme.dim,fontSize:12}}>None</span>:s.items.map((it,j)=><div key={j} style={{padding:"4px 0",borderBottom:`1px solid ${theme.border}`,fontSize:13}}><b>{it.room}</b> — {it.detail}: {it.comment}</div>)}</div>)}
      </div>}

      {tab==="add"&&<div className="cd">
        <h4 style={{marginBottom:10}}>Add Line Item</h4>
        <div className="g2 mb"><div><label style={{fontSize:11,color:theme.dim}}>Room</label><input value={nr} onChange={e=>setNr(e.target.value)} list="rl"/><datalist id="rl">{rooms.map(r=><option key={r.name} value={r.name}/>)}</datalist></div><div><label style={{fontSize:11,color:theme.dim}}>Item</label><input value={nd} onChange={e=>setNd(e.target.value)}/></div></div>
        <div style={{marginBottom:10}}><label style={{fontSize:11,color:theme.dim}}>Description</label><input value={nc} onChange={e=>setNc(e.target.value)}/></div>
        <div className="g2 mb"><div><label style={{fontSize:11,color:theme.dim}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step="0.25"/></div><div><label style={{fontSize:11,color:theme.dim}}>Materials $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div>
        <button className="bg" onClick={addItem}>Add to Quote</button>
      </div>}
    </div>
  );
}

/* ═══════ JOBS ═══════ */
function JobsPage({jobs,setJobs,schedule,setSchedule,theme}){
  const [view,setView]=useState("list");
  const [open,setOpen]=useState(null);
  const [rn,setRn]=useState("");const [ra,setRa]=useState("");
  const [newProp,setNewProp]=useState("");const [newClient,setNewClient]=useState("");
  const [schedDate,setSchedDate]=useState("");const [schedJob,setSchedJob]=useState("");const [schedNote,setSchedNote]=useState("");

  const addR=id=>{if(!rn||!ra)return;setJobs(p=>p.map(j=>j.id===id?{...j,receipts:[...j.receipts,{note:rn,amount:parseFloat(ra),date:new Date().toLocaleDateString()}]}:j));setRn("");setRa("")};
  const setSt=(id,s)=>setJobs(p=>p.map(j=>j.id===id?{...j,status:s}:j));
  const del=id=>{if(confirm("Delete?")){setJobs(p=>p.filter(j=>j.id!==id))}};
  const createBlank=()=>{if(!newProp)return;setJobs(p=>[...p,{id:Date.now(),property:newProp,client:newClient,date:new Date().toISOString().split("T")[0],rooms:[],items:[],total:0,totalLabor:0,totalMat:0,totalHrs:0,status:"active",receipts:[]}]);setNewProp("");setNewClient("")};
  const addSched=()=>{if(!schedDate||!schedJob)return;setSchedule(p=>[...p,{id:Date.now(),date:schedDate,job:schedJob,note:schedNote}]);setSchedDate("");setSchedJob("");setSchedNote("")};

  // Week view
  const today=new Date();
  const weekStart=new Date(today);weekStart.setDate(today.getDate()-today.getDay());
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return d});
  const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return(
    <div className="fi">
      <div className="row mb">
        <h2 style={{fontSize:24,color:BLUE}}>📋 Jobs</h2>
        <div style={{flex:1}}/>
        {["list","schedule","create"].map(v=><button key={v} onClick={()=>setView(v)} style={{padding:"4px 12px",borderRadius:6,fontSize:11,background:view===v?BLUE:"transparent",color:view===v?"#fff":theme.dim,fontFamily:"'Oswald'"}}>{v}</button>)}
      </div>

      {view==="list"&&<div>
        {jobs.length===0?<div className="cd" style={{textAlign:"center",padding:30}}><p style={{color:theme.dim}}>No jobs. Create one or use QuoteForge.</p></div>:
        jobs.slice().reverse().map(job=>{
          const spent=(job.receipts||[]).reduce((s,r)=>s+r.amount,0);
          const net=job.total-spent;
          return(
          <div key={job.id} className="cd mb">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",flexWrap:"wrap",gap:6}} onClick={()=>setOpen(open===job.id?null:job.id)}>
              <div><h4 style={{fontSize:15}}>{job.property}</h4><div style={{fontSize:12,color:theme.dim}}>{job.client} · {job.date} · {job.items?.length||0} items</div></div>
              <div className="row">
                <div style={{textAlign:"right"}}><div style={{fontSize:18,fontFamily:"'Oswald'",color:GREEN}}>${job.total.toFixed(0)}</div><div style={{fontSize:11,color:theme.dim}}>Net: ${net.toFixed(0)}</div></div>
                <select value={job.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setSt(job.id,e.target.value)}} style={{fontSize:11,padding:"3px 6px",width:"auto",background:job.status==="complete"?GREEN+"22":job.status==="active"?BLUE+"22":ORANGE+"22"}}><option value="quoted">Quoted</option><option value="active">Active</option><option value="complete">Complete</option></select>
              </div>
            </div>
            {open===job.id&&<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${theme.border}`}}>
              <h5 style={{color:BLUE,marginBottom:6,fontSize:13}}>Receipts ({(job.receipts||[]).length}) · Spent: ${spent.toFixed(2)}</h5>
              {(job.receipts||[]).map((r,i)=><div key={i} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{r.date} — {r.note}</span><span style={{color:ORANGE}}>${r.amount.toFixed(2)}</span></div>)}
              <div className="row mt"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Note" style={{flex:1}}/><input type="number" value={ra} onChange={e=>setRa(e.target.value)} placeholder="$" style={{width:70}}/><button className="bb" onClick={e=>{e.stopPropagation();addR(job.id)}} style={{fontSize:11,padding:"6px 12px"}}>Add</button></div>
              <div className="row mt"><button className="br" onClick={e=>{e.stopPropagation();del(job.id)}} style={{fontSize:10,padding:"4px 10px"}}>Delete</button></div>
            </div>}
          </div>
        )})}
      </div>}

      {view==="schedule"&&<div>
        <div className="cd mb">
          <h4 style={{marginBottom:10}}>Schedule Job</h4>
          <div className="row">
            <input type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)} style={{width:150}}/>
            <select value={schedJob} onChange={e=>setSchedJob(e.target.value)} style={{flex:1}}><option value="">Select job</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select>
            <input value={schedNote} onChange={e=>setSchedNote(e.target.value)} placeholder="Notes" style={{flex:1}}/>
            <button className="bg" onClick={addSched} style={{fontSize:11,padding:"6px 12px"}}>Add</button>
          </div>
        </div>
        <div className="cd">
          <h4 style={{marginBottom:10}}>This Week</h4>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
            {weekDays.map((d,i)=>{
              const ds=d.toISOString().split("T")[0];
              const dayItems=schedule.filter(s=>s.date===ds);
              const isToday=ds===today.toISOString().split("T")[0];
              return<div key={i} style={{background:isToday?BLUE+"22":theme.card,border:`1px solid ${isToday?BLUE:theme.border}`,borderRadius:8,padding:6,minHeight:80}}>
                <div style={{fontSize:10,fontFamily:"'Oswald'",color:isToday?BLUE:theme.dim,textAlign:"center"}}>{dayNames[i]}</div>
                <div style={{fontSize:12,textAlign:"center",fontWeight:600,marginBottom:4}}>{d.getDate()}</div>
                {dayItems.map(s=><div key={s.id} style={{fontSize:9,background:BLUE+"22",borderRadius:3,padding:"2px 4px",marginBottom:2,color:BLUE}}>{s.job}</div>)}
              </div>
            })}
          </div>
          {schedule.length>0&&<div className="mt">
            <h5 style={{fontSize:13,marginBottom:6}}>All Scheduled</h5>
            {schedule.sort((a,b)=>a.date.localeCompare(b.date)).map(s=><div key={s.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"center"}}><span>{s.date}</span><span style={{color:BLUE}}>{s.job}</span><span style={{color:theme.dim}}>{s.note}</span><button onClick={()=>setSchedule(p=>p.filter(x=>x.id!==s.id))} style={{background:"none",color:RED,fontSize:12}}>✕</button></div>)}
          </div>}
        </div>
      </div>}

      {view==="create"&&<div className="cd">
        <h4 style={{marginBottom:10}}>Create Job Manually</h4>
        <div className="g2 mb"><input value={newProp} onChange={e=>setNewProp(e.target.value)} placeholder="Property address *"/><input value={newClient} onChange={e=>setNewClient(e.target.value)} placeholder="Client"/></div>
        <button className="bg" onClick={createBlank}>Create Job</button>
      </div>}
    </div>
  );
}

/* ═══════ TIME TRACKER ═══════ */
function TT({timeEntries,setTimeEntries,jobs,user,getRate,theme}){
  const [on,setOn]=useState(()=>ld("timer_on",false));
  const [st,setSt]=useState(()=>ld("timer_start",null));
  const [sj,setSj]=useState(()=>ld("timer_job",""));
  const [el,setEl]=useState(0);
  const [mh,setMh]=useState("");const [mj,setMj]=useState("");
  const rate=user.rate||55;

  // Persist timer state so it survives page changes
  useEffect(()=>{sv("timer_on",on)},[on]);
  useEffect(()=>{sv("timer_start",st)},[st]);
  useEffect(()=>{sv("timer_job",sj)},[sj]);

  useEffect(()=>{
    let iv;
    if(on&&st)iv=setInterval(()=>setEl(Date.now()-st),1000);
    return()=>clearInterval(iv);
  },[on,st]);

  const fmt=ms=>{const s=Math.floor(ms/1000);return`${Math.floor(s/3600).toString().padStart(2,"0")}:${Math.floor((s%3600)/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`};
  const start=()=>{const now=Date.now();setSt(now);setOn(true)};
  const stop=()=>{
    const hrs=Math.round(el/3600000*100)/100;
    if(hrs>0.01){
      setTimeEntries(p=>[...p,{id:Date.now(),job:sj||"General",date:new Date().toLocaleDateString(),hours:hrs,amount:Math.round(hrs*rate*100)/100,user:user.name,userId:user.id}]);
    }
    setOn(false);setSt(null);setEl(0);
  };
  const addM=()=>{const h=parseFloat(mh);if(!h||h<=0)return;setTimeEntries(p=>[...p,{id:Date.now(),job:mj||"General",date:new Date().toLocaleDateString(),hours:h,amount:Math.round(h*rate*100)/100,user:user.name,userId:user.id}]);setMh("");setMj("")};
  const delE=id=>setTimeEntries(p=>p.filter(e=>e.id!==id));
  const editEntry=(id,field,val)=>setTimeEntries(p=>p.map(e=>{
    if(e.id!==id)return e;
    const updated={...e,[field]:val};
    if(field==="hours")updated.amount=Math.round(val*rate*100)/100;
    return updated;
  }));

  return(
    <div className="fi">
      <h2 style={{fontSize:24,color:BLUE,marginBottom:16}}>⏱ Time Tracker</h2>
      <div className="cd mb" style={{textAlign:"center",padding:24}}>
        <div style={{fontSize:54,fontFamily:"'Oswald'",fontWeight:700,color:on?GREEN:theme.dim}}>{fmt(el)}</div>
        <div style={{marginTop:12,marginBottom:12}}>
          <select value={sj} onChange={e=>setSj(e.target.value)} style={{maxWidth:350,margin:"0 auto",display:"block"}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select>
        </div>
        {!on?<button className="bb" onClick={start} style={{fontSize:16,padding:"10px 36px"}}>▶ Start</button>:<button className="br" onClick={stop} style={{fontSize:16,padding:"10px 36px"}}>⏹ Stop & Log</button>}
        {on&&<div style={{marginTop:8,fontSize:12,color:GREEN}}>Timer running — persists if you leave this page</div>}
      </div>
      <div className="cd mb"><h4 style={{marginBottom:8}}>Manual Entry</h4><div className="row"><select value={mj} onChange={e=>setMj(e.target.value)} style={{flex:1}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><input type="number" value={mh} onChange={e=>setMh(e.target.value)} placeholder="Hrs" step="0.25" min="0" style={{width:80}}/><button className="bg" onClick={addM} style={{fontSize:12,padding:"8px 14px"}}>Log</button></div></div>
      <div className="cd"><h4 style={{marginBottom:8}}>Log ({timeEntries.length})</h4>
        {timeEntries.length===0?<p style={{color:theme.dim,fontSize:13}}>No entries.</p>:
        timeEntries.slice().reverse().map(e=>(
          <div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13,alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{minWidth:70}}>{e.date}</span>
            <span style={{color:BLUE,flex:1}}>{e.job}</span>
            <input type="number" value={e.hours} step="0.25" min="0" onChange={ev=>editEntry(e.id,"hours",parseFloat(ev.target.value)||0)} style={{width:55,textAlign:"center",padding:"2px",fontSize:12}}/>
            <span style={{fontSize:11,color:theme.dim}}>h</span>
            <span style={{color:GREEN,minWidth:55,textAlign:"right"}}>${e.amount.toFixed(2)}</span>
            <button onClick={()=>delE(e.id)} style={{background:"none",color:RED,fontSize:13,padding:1}}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════ PAYROLL ═══════ */
function Pay({timeEntries,setTimeEntries,users,user,payHistory,setPayHistory,getRate,theme}){
  const [selUser,setSelUser]=useState(user.id);
  const uEntries=timeEntries.filter(e=>!selUser||e.userId===selUser||(selUser===user.id&&!e.userId));
  const th=uEntries.reduce((s,e)=>s+e.hours,0);
  const tp=uEntries.reduce((s,e)=>s+e.amount,0);
  const selUserObj=users.find(u=>u.id===selUser)||user;

  const byJob={};uEntries.forEach(e=>{byJob[e.job]=(byJob[e.job]||0)+e.hours});

  const processPayroll=()=>{
    if(uEntries.length===0)return;
    setPayHistory(p=>[...p,{id:Date.now(),userId:selUser,name:selUserObj.name,date:new Date().toLocaleDateString(),hours:th,amount:tp,entries:uEntries.length}]);
    alert(`Payroll processed: ${selUserObj.name} — ${th.toFixed(1)}h — $${tp.toFixed(2)}`);
  };

  return(
    <div className="fi">
      <h2 style={{fontSize:24,color:BLUE,marginBottom:16}}>💰 Payroll</h2>
      <div className="cd mb">
        <div className="row"><label style={{fontSize:12,color:theme.dim}}>Employee:</label>
          <select value={selUser} onChange={e=>setSelUser(e.target.value)} style={{flex:1}}>
            {users.map(u=><option key={u.id} value={u.id}>{u.name} (${u.rate}/hr)</option>)}
          </select>
        </div>
      </div>
      <div className="g3 mb">
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Hours</div><div className="sv" style={{color:BLUE}}>{th.toFixed(1)}</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Rate</div><div className="sv">${selUserObj.rate}/hr</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Total</div><div className="sv" style={{color:GREEN}}>${tp.toFixed(2)}</div></div>
      </div>
      <div className="cd mb">
        <div className="row"><h4>By Job</h4><div style={{flex:1}}/><button className="bg" onClick={processPayroll} style={{fontSize:11,padding:"6px 14px"}}>Process Payroll</button></div>
        {Object.entries(byJob).map(([j,h])=><div key={j} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{j}</span><span>{h.toFixed(1)}h → <span style={{color:GREEN}}>${(h*selUserObj.rate).toFixed(2)}</span></span></div>)}
      </div>
      {payHistory.length>0&&<div className="cd mb"><h4 style={{marginBottom:8}}>Payment History</h4>
        {payHistory.filter(p=>!selUser||p.userId===selUser).slice().reverse().map(p=><div key={p.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{p.date}</span><span>{p.name}</span><span>{p.hours.toFixed(1)}h</span><span style={{color:GREEN}}>${p.amount.toFixed(2)}</span></div>)}
      </div>}
      <div className="cd"><h4 style={{marginBottom:8}}>Entries (editable)</h4>
        {uEntries.slice().reverse().map(e=>(
          <div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"center",gap:4,flexWrap:"wrap"}}>
            <span>{e.date}</span><span style={{color:BLUE}}>{e.job}</span>
            <input type="number" value={e.hours} step="0.25" min="0" onChange={ev=>setTimeEntries(p=>p.map(x=>x.id===e.id?{...x,hours:parseFloat(ev.target.value)||0,amount:Math.round((parseFloat(ev.target.value)||0)*selUserObj.rate*100)/100}:x))} style={{width:50,textAlign:"center",padding:"2px",fontSize:11}}/>
            <span style={{color:GREEN}}>${e.amount.toFixed(2)}</span>
            <button onClick={()=>setTimeEntries(p=>p.filter(x=>x.id!==e.id))} style={{background:"none",color:RED,fontSize:12}}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════ QUESTS (includes Reviews + Referrals) ═══════ */
function QuestsPage({quests,testimonials,setTestimonials,referrals,setReferrals,theme}){
  const [tab,setTab]=useState("quests");
  const [rName,setRName]=useState("");const [rText,setRText]=useState("");const [rRating,setRRating]=useState(5);
  const [refName,setRefName]=useState("");const [refSrc,setRefSrc]=useState("");
  const xp=quests.reduce((s,q)=>s+(q.progress>=q.target?q.xp:0),0);

  const addReview=()=>{if(!rName||!rText)return;setTestimonials(p=>[...p,{name:rName,text:rText,rating:rRating}]);setRName("");setRText("");setRRating(5)};
  const addRef=()=>{if(!refName)return;setReferrals(p=>[...p,{id:Date.now(),name:refName,source:refSrc,status:"pending",date:new Date().toLocaleDateString()}]);setRefName("");setRefSrc("")};

  return(
    <div className="fi">
      <h2 style={{fontSize:24,color:BLUE,marginBottom:16}}>🎯 Quest Hub</h2>
      <div style={{display:"flex",gap:3,marginBottom:14}}>
        {["quests","reviews","referrals"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"6px 14px",borderRadius:6,fontSize:12,background:tab===t?BLUE:"transparent",color:tab===t?"#fff":theme.dim,fontFamily:"'Oswald'"}}>{t==="quests"?"🎯 Quests":t==="reviews"?"⭐ Reviews":"🤝 Referrals"}</button>)}
      </div>

      {tab==="quests"&&<div>
        <div className="cd mb" style={{textAlign:"center",padding:20}}><div className="sl">XP Earned</div><div style={{fontSize:42,fontFamily:"'Oswald'",fontWeight:700,color:ORANGE}}>{xp}</div></div>
        {quests.map(q=>{const p=Math.min(100,q.progress/q.target*100),d=q.progress>=q.target;return(
          <div key={q.id} className="cd mb" style={{borderLeft:`3px solid ${d?GREEN:BLUE}`}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontWeight:600,fontSize:14}}>{d?"✅":"⏳"} {q.title}</span><span style={{fontFamily:"'Oswald'",color:ORANGE,fontSize:13}}>+{q.xp} XP</span></div>
            <div style={{height:6,background:theme.border,borderRadius:3}}><div style={{height:6,background:d?GREEN:BLUE,borderRadius:3,width:`${p}%`,transition:"width .5s"}}/></div>
            <div style={{fontSize:11,color:theme.dim,marginTop:3,textAlign:"right"}}>{q.progress}/{q.target} {q.type==="jobs"?"completed":q.type==="reviews"?"5★ reviews":"converted"}</div>
          </div>
        )})}
      </div>}

      {tab==="reviews"&&<div>
        <div className="cd mb"><h4 style={{marginBottom:10}}>Add Review</h4>
          <div className="row mb"><input value={rName} onChange={e=>setRName(e.target.value)} placeholder="Client" style={{flex:1}}/><select value={rRating} onChange={e=>setRRating(Number(e.target.value))} style={{width:70}}>{[5,4,3,2,1].map(x=><option key={x} value={x}>{x}★</option>)}</select></div>
          <textarea value={rText} onChange={e=>setRText(e.target.value)} placeholder="Review..." style={{height:50,marginBottom:8}}/>
          <button className="bb" onClick={addReview} style={{fontSize:12}}>Add</button>
        </div>
        {testimonials.map((t,i)=><div key={i} className="cd mb"><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{t.name}</span><span style={{color:YELLOW}}>{"★".repeat(t.rating)}{"☆".repeat(5-t.rating)}</span></div><p style={{color:theme.dim,fontSize:13,marginTop:4}}>"{t.text}"</p></div>)}
      </div>}

      {tab==="referrals"&&<div>
        <div className="cd mb"><h4 style={{marginBottom:10}}>Add Referral</h4>
          <div className="row"><input value={refName} onChange={e=>setRefName(e.target.value)} placeholder="Name" style={{flex:1}}/><input value={refSrc} onChange={e=>setRefSrc(e.target.value)} placeholder="Referred by" style={{flex:1}}/><button className="bb" onClick={addRef} style={{fontSize:12}}>Add</button></div>
        </div>
        {referrals.map(r=><div key={r.id} className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:600}}>{r.name}</div><div style={{fontSize:12,color:theme.dim}}>{r.source} · {r.date}</div></div><select value={r.status} onChange={e=>setReferrals(p=>p.map(x=>x.id===r.id?{...x,status:e.target.value}:x))} style={{width:"auto",fontSize:11,padding:"3px 8px"}}><option value="pending">Pending</option><option value="contacted">Contacted</option><option value="converted">Converted</option></select></div>)}
      </div>}
    </div>
  );
}

import { useState, useEffect, useRef } from "react";

/* CONSTANTS */
const BLUE = "#2E75B6";
const RED = "#C00000";
const DARK = "#0a0a0f";
const CARD = "#12121a";
const BORDER = "#1e1e2e";
const TXT = "#e2e2e8";
const DIM = "#8888a0";
const GREEN = "#00cc66";
const ORANGE = "#ff8800";
const YELLOW = "#ffcc00";
const RATE = 55;
const MARKUP = 0.10;
const LOGO = "/CREED_LOGO.png";

/* STORAGE */
function load(key, fb) { try { const v = localStorage.getItem("creed_" + key); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function save(key, val) { localStorage.setItem("creed_" + key, JSON.stringify(val)); }

const DEFAULT_USERS = [
  { email: "admin@creedhandyman.com", password: "Creed2026!", name: "Bernard", role: "owner" },
  { email: "tech@creedhandyman.com", password: "CreedTech1", name: "Tech 1", role: "tech" },
  { email: "manager@creedhandyman.com", password: "CreedMgr1", name: "Manager", role: "manager" },
];

/* CSS */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:${DARK};color:${TXT};font-family:'Source Sans 3',sans-serif}
h1,h2,h3,h4,h5{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.05em}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:${DARK}}::-webkit-scrollbar-thumb{background:${BLUE};border-radius:3px}
input,textarea,select{background:#1a1a28;border:1px solid ${BORDER};color:${TXT};padding:10px 14px;border-radius:8px;font-family:'Source Sans 3',sans-serif;font-size:14px;outline:none;width:100%}
input:focus,textarea:focus,select:focus{border-color:${BLUE}}
button{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;border:none;transition:all .2s}
button:hover{transform:translateY(-1px)}button:active{transform:translateY(0)}
.bb{background:${BLUE};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.br{background:${RED};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.bg{background:${GREEN};color:#fff;padding:10px 20px;border-radius:8px;font-size:14px}
.bo{background:transparent;border:1px solid ${BORDER};color:${DIM};padding:8px 16px;border-radius:8px;font-size:13px}
.bo:hover{border-color:${BLUE};color:${BLUE}}
.cd{background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:20px}
@keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:fi .3s ease forwards}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.mt{margin-top:16px}.mb{margin-bottom:16px}
.sv{font-size:28px;font-family:'Oswald',sans-serif;font-weight:700}
.sl{font-size:11px;color:${DIM};font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.1em}
.bd{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.bd-d{background:${RED}33;color:${RED}}.bd-p{background:${ORANGE}33;color:${ORANGE}}
.bd-f{background:${YELLOW}33;color:${YELLOW}}.bd-s{background:${GREEN}33;color:${GREEN}}
.sep{border-bottom:1px solid ${BORDER};padding:8px 0}
`;

/* ZINSPECTOR PARSER */
function parseZInspector(text) {
  if (!text || text.trim().length < 50) return [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rooms = [];
  let cur = null;
  const RP = [/^(Kitchen)\b/i,/^(Appliances)\b/i,/^(Laundry\s*Room)\b/i,/^(Living\s*Room)\b/i,/^(Dining\s*Room)\b/i,/^(Entry)\b/i,/^(Hallway\/Stairs)\b/i,/^(Bedroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Bathroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Garage\/Parking)\b/i,/^(Compliance\s*[:\-]?\s*\w*)/i,/^(Exterior\s*[:\-]?\s*\w*)/i];
  const SKIP = new Set(["Image","View Image","View Video","None","S","F","P","D","-","Detail","Condition","Actions","Comment","Media","Page","Report"]);
  const isSkip = l => SKIP.has(l)||/^\d{4}-\d{2}-\d{2}/.test(l)||/^\d+\.\d+,\s*-?\d+/.test(l)||l.startsWith("Page ")||l.startsWith("Report generated")||l==="Maintenance";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let rm = null;
    for (const p of RP) { const m = line.match(p); if (m && line.length < 50 && !line.includes("Condition")) { rm = m[1]; break; } }
    if (rm) { cur = { name: rm.replace(/\s+/g," ").replace(/:/g," ").trim(), items: [] }; rooms.push(cur); continue; }
    if (!cur || line !== "Maintenance") continue;
    let detail = "", cond = "-";
    for (let j = i-1; j >= Math.max(0,i-5); j--) { const p = lines[j]; if (["S","F","P","D"].includes(p)){cond=p;continue;} if (p==="-"){continue;} if (isSkip(p)) continue; if (p.length > 2 && !detail){detail=p;break;} }
    let comment = "";
    for (let j = i+1; j < Math.min(lines.length,i+8); j++) { const n = lines[j]; if (isSkip(n)) continue; if (n==="Maintenance"||n==="None") break; let nr=false; for (const p of RP){if(p.test(n)&&n.length<50){nr=true;break;}} if(nr) break; if(n.length>3){comment+=(comment?" ":"")+n;} if(comment.length>20) break; }
    if (detail||comment) cur.items.push({ id:Math.random().toString(36).slice(2,8), detail:detail||"General", condition:cond, comment:comment||"Maintenance required", laborHrs:autoLabor(comment+" "+detail), materials:autoMat(comment+" "+detail) });
  }
  return rooms.filter(r => r.items.length > 0);
}

function autoLabor(t) {
  t = t.toLowerCase();
  if (t.includes("full replace")||t.includes("full repaint")||t.includes("complete repaint")) return 6;
  if (t.includes("replace")&&(t.includes("floor")||t.includes("carpet")||t.includes("tile"))) return 5;
  if (t.includes("water damage")) return 8;
  if (t.includes("repaint")||t.includes("full paint")) return 5;
  if (t.includes("replace door")) return 2.5;
  if (t.includes("refinish")||t.includes("tile wall")) return 10;
  if (t.includes("touch up")||t.includes("touch-up")) return 1.5;
  if (t.includes("patch")&&t.includes("paint")) return 2;
  if (t.includes("install")&&!t.includes("bulb")) return 1;
  if (t.includes("replace")) return 1;
  if (t.includes("repair")) return 1;
  if (t.includes("bulb")||t.includes("battery")||t.includes("filter")) return 0.25;
  if (t.includes("secure")||t.includes("tighten")) return 0.5;
  if (t.includes("caulk")) return 0.75;
  return 1;
}

function autoMat(t) {
  t = t.toLowerCase();
  const m = [];
  if (t.includes("paint")&&t.includes("full")) m.push({name:"Paint + primer (gal)",cost:66},{name:"Supplies",cost:20});
  else if (t.includes("paint")) m.push({name:"Paint (qt)",cost:18});
  if (t.includes("carpet")) m.push({name:"Carpet + pad",cost:240});
  if (t.includes("tile")&&t.includes("floor")) m.push({name:"Floor tile + thinset",cost:150});
  if (t.includes("tile")&&t.includes("wall")) m.push({name:"Wall tile + thinset",cost:180});
  if (t.includes("blind")) m.push({name:"Blind",cost:16});
  if (t.includes("door")&&t.includes("replace")) m.push({name:"Door + hardware",cost:75});
  if (t.includes("knob")||t.includes("doorknob")) m.push({name:"Door knob",cost:15});
  if (t.includes("smoke alarm")||t.includes("smoke detector")) m.push({name:"Smoke alarm",cost:18});
  if (t.includes("battery")) m.push({name:"9V battery",cost:4});
  if (t.includes("bulb")) m.push({name:"Light bulbs",cost:8});
  if (t.includes("fire ext")) m.push({name:"Fire extinguisher",cost:25});
  if (t.includes("caulk")) m.push({name:"Caulk",cost:8});
  if (t.includes("shower head")) m.push({name:"Shower head",cost:20});
  if (t.includes("flapper")||t.includes("fill valve")) m.push({name:"Toilet kit",cost:15});
  if (t.includes("hinge")) m.push({name:"Hinges",cost:12});
  if (t.includes("flooring")||t.includes("lvp")) m.push({name:"LVP flooring",cost:135});
  if (t.includes("sprayer")) m.push({name:"Sprayer",cost:15});
  if (t.includes("bifold")) m.push({name:"Bifold door",cost:65});
  if (t.includes("fixture")) m.push({name:"Light fixture",cost:30});
  if (t.includes("screen")) m.push({name:"Screen kit",cost:12});
  if (t.includes("mirror")) m.push({name:"Mirror",cost:30});
  if (t.includes("towel bar")) m.push({name:"Towel bar",cost:14});
  if (t.includes("tp holder")||t.includes("toilet paper")) m.push({name:"TP holder",cost:10});
  if (t.includes("refinish")) m.push({name:"Refinish kit",cost:50});
  if (t.includes("latch")||t.includes("gate")) m.push({name:"Latch",cost:12});
  if (t.includes("downspout")) m.push({name:"Downspout",cost:20});
  if (m.length===0) m.push({name:"Materials",cost:15});
  return m;
}

function classifyIssues(rooms) {
  const c=[],im=[],mi=[];
  rooms.forEach(r=>r.items.forEach(item=>{
    const e={room:r.name,...item};
    const t=(item.comment+" "+item.detail).toLowerCase();
    if(t.includes("water damage")||t.includes("ungrounded")||t.includes("smoke alarm")||t.includes("fire ext")||t.includes("electrician")||t.includes("code")||t.includes("water intrusion")||t.includes("missing smoke")) c.push(e);
    else if(item.condition==="D"||t.includes("broken")||t.includes("horrible")||t.includes("severe")||t.includes("full replace")||t.includes("cracked")) im.push(e);
    else mi.push(e);
  }));
  return {critical:c,important:im,minor:mi};
}

function buildGuide(rooms) {
  const tools=new Set(["Drill/driver","Tape measure","Level","Utility knife","Caulk gun","Putty knife","PPE"]);
  const shopping=[],steps=[];
  rooms.forEach(r=>r.items.forEach(item=>{
    const t=(item.comment+" "+item.detail).toLowerCase();
    if(t.includes("paint")){tools.add("Roller/brush kit");tools.add("Drop cloths");tools.add("Painter's tape");}
    if(t.includes("tile")){tools.add("Tile cutter");tools.add("Trowel");}
    if(t.includes("plumb")||t.includes("shower")||t.includes("toilet")){tools.add("Adjustable wrench");tools.add("Plumber's tape");}
    if(t.includes("electric")||t.includes("outlet")){tools.add("Voltage tester");}
    if(t.includes("door")){tools.add("Chisel");tools.add("Hammer");}
    item.materials.forEach(m=>shopping.push({...m,room:r.name,detail:item.detail}));
    steps.push({room:r.name,detail:item.detail,action:item.comment});
  }));
  return {tools:[...tools].sort(),shopping,steps};
}

function calcLine(item) {
  const lc = item.laborHrs * RATE;
  const mc = item.materials.reduce((s,m)=>s+m.cost,0);
  return { laborCost:lc, matCost:mc, total:Math.round((lc+mc)*(1+MARKUP)*100)/100 };
}

/* MAIN APP */
export default function App() {
  const [user, setUser] = useState(()=>load("user",null));
  const [users, setUsers] = useState(()=>load("users",DEFAULT_USERS));
  const [page, setPage] = useState("dashboard");
  const [jobs, setJobs] = useState(()=>load("jobs",[]));
  const [timeEntries, setTimeEntries] = useState(()=>load("time",[]));
  const [testimonials, setTestimonials] = useState(()=>load("reviews",[{name:"Keyrenter PMC",text:"Creed Handyman delivered quality turnover work on time.",rating:5}]));
  const [referrals, setReferrals] = useState(()=>load("referrals",[]));
  const [quests, setQuests] = useState(()=>load("quests",[{id:1,title:"Complete 5 jobs this week",progress:2,target:5,xp:100},{id:2,title:"Get 3 five-star reviews",progress:1,target:3,xp:75},{id:3,title:"Zero callbacks this month",progress:28,target:30,xp:150}]));

  useEffect(()=>{save("user",user)},[user]);
  useEffect(()=>{save("users",users)},[users]);
  useEffect(()=>{save("jobs",jobs)},[jobs]);
  useEffect(()=>{save("time",timeEntries)},[timeEntries]);
  useEffect(()=>{save("reviews",testimonials)},[testimonials]);
  useEffect(()=>{save("referrals",referrals)},[referrals]);
  useEffect(()=>{save("quests",quests)},[quests]);

  if (!user) return <Login users={users} setUsers={setUsers} setUser={setUser}/>;

  const NAV=[{id:"dashboard",l:"Dashboard",i:"◆"},{id:"quoteforge",l:"QuoteForge",i:"⚡"},{id:"jobs",l:"Jobs",i:"📋"},{id:"time",l:"Time",i:"⏱"},{id:"payroll",l:"Payroll",i:"💰"},{id:"quests",l:"Quests",i:"🎯"},{id:"reviews",l:"Reviews",i:"⭐"},{id:"referrals",l:"Referrals",i:"🤝"}];

  return (
    <div style={{minHeight:"100vh",background:DARK}}>
      <style>{css}</style>
      <header style={{background:`linear-gradient(135deg,${DARK},#14142a)`,borderBottom:`1px solid ${BORDER}`,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <img src={LOGO} alt="Creed" style={{height:40,borderRadius:6}} onError={e=>e.target.style.display="none"}/>
          <div><h1 style={{fontSize:18,color:BLUE,lineHeight:1.1}}>Creed Handyman</h1><span style={{fontSize:10,color:DIM,fontFamily:"'Oswald'",letterSpacing:".15em"}}>BUSINESS COMMAND CENTER</span></div>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
          {NAV.map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:page===n.id?BLUE:"transparent",color:page===n.id?"#fff":DIM,fontFamily:"'Oswald'",letterSpacing:".06em"}}>{n.i} {n.l}</button>)}
          <button onClick={()=>setUser(null)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:RED+"44",color:RED,fontFamily:"'Oswald'"}}>↪ {user.name}</button>
        </div>
      </header>
      <main style={{maxWidth:1200,margin:"0 auto",padding:"20px 16px"}}>
        {page==="dashboard"&&<Dash jobs={jobs} timeEntries={timeEntries} quests={quests} setPage={setPage} user={user}/>}
        {page==="quoteforge"&&<QF jobs={jobs} setJobs={setJobs}/>}
        {page==="jobs"&&<JobsPage jobs={jobs} setJobs={setJobs}/>}
        {page==="time"&&<TT timeEntries={timeEntries} setTimeEntries={setTimeEntries} jobs={jobs}/>}
        {page==="payroll"&&<Pay timeEntries={timeEntries}/>}
        {page==="quests"&&<QuestsPage quests={quests} setQuests={setQuests}/>}
        {page==="reviews"&&<Rev testimonials={testimonials} setTestimonials={setTestimonials}/>}
        {page==="referrals"&&<Ref referrals={referrals} setReferrals={setReferrals}/>}
      </main>
    </div>
  );
}

/* LOGIN */
function Login({users,setUsers,setUser}) {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [name,setName]=useState("");
  const [err,setErr]=useState("");
  const login=()=>{const u=users.find(u=>u.email===email&&u.password===pass);if(u){setUser(u);setErr("")}else setErr("Invalid email or password")};
  const signup=()=>{if(!email||!pass||!name){setErr("Fill all fields");return}if(users.find(u=>u.email===email)){setErr("Email exists");return}const u={email,password:pass,name,role:"tech"};setUsers(p=>[...p,u]);setUser(u)};
  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${DARK},#0d1530)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{css}</style>
      <div style={{width:380}}>
        <div style={{textAlign:"center",marginBottom:30}}>
          <img src={LOGO} alt="Creed" style={{height:80,marginBottom:12}} onError={e=>e.target.style.display="none"}/>
          <h1 style={{color:BLUE,fontSize:28}}>Creed Handyman</h1>
          <div style={{color:RED,fontSize:12,fontFamily:"'Oswald'",letterSpacing:".15em",marginTop:4}}>LLC</div>
        </div>
        <div className="cd" style={{padding:30}}>
          <h3 style={{textAlign:"center",marginBottom:20}}>{mode==="login"?"Sign In":"Create Account"}</h3>
          {mode==="signup"&&<div style={{marginBottom:12}}><label style={{fontSize:12,color:DIM,display:"block",marginBottom:4}}>Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></div>}
          <div style={{marginBottom:12}}><label style={{fontSize:12,color:DIM,display:"block",marginBottom:4}}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="creed@example.com"/></div>
          <div style={{marginBottom:16}}><label style={{fontSize:12,color:DIM,display:"block",marginBottom:4}}>Password</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(mode==="login"?login():signup())}/></div>
          {err&&<div style={{color:RED,fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</div>}
          <button className="bb" onClick={mode==="login"?login:signup} style={{width:"100%",padding:12,fontSize:16}}>{mode==="login"?"Sign In":"Sign Up"}</button>
          <div style={{textAlign:"center",marginTop:16,fontSize:13,color:DIM}}>{mode==="login"?"No account? ":"Have account? "}<span onClick={()=>{setMode(mode==="login"?"signup":"login");setErr("")}} style={{color:BLUE,cursor:"pointer",textDecoration:"underline"}}>{mode==="login"?"Sign Up":"Sign In"}</span></div>
        </div>
        <div style={{textAlign:"center",marginTop:20,color:DIM,fontSize:11}}>Lic #6145054 · Wichita, KS · (316) 252-6335</div>
      </div>
    </div>
  );
}

/* DASHBOARD */
function Dash({jobs,timeEntries,quests,setPage,user}) {
  const rev=jobs.reduce((s,j)=>s+(j.total||0),0);
  const act=jobs.filter(j=>j.status!=="complete").length;
  const hrs=timeEntries.reduce((s,e)=>s+e.hours,0);
  const qP=quests.reduce((s,q)=>s+q.progress,0);
  const qT=quests.reduce((s,q)=>s+q.target,0);
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>Welcome, {user.name}</h2>
      <div className="g4 mb">
        {[{l:"Active Jobs",v:act,c:BLUE},{l:"Pipeline",v:"$"+rev.toLocaleString(),c:GREEN},{l:"Hours",v:hrs.toFixed(1),c:ORANGE},{l:"Quests",v:Math.round(qP/(qT||1)*100)+"%",c:RED}].map((s,i)=>(
          <div key={i} className="cd" style={{borderLeft:`3px solid ${s.c}`}}><div className="sl">{s.l}</div><div className="sv" style={{color:s.c}}>{s.v}</div></div>
        ))}
      </div>
      <div className="g2">
        <div className="cd" style={{cursor:"pointer"}} onClick={()=>setPage("quoteforge")}><h3 style={{color:BLUE,marginBottom:8}}>⚡ QuoteForge Pro</h3><p style={{color:DIM,fontSize:14}}>Parse any inspection or build custom quotes. Auto-estimates labor + materials.</p><button className="bb mt">Launch →</button></div>
        <div className="cd"><h3 style={{color:ORANGE,marginBottom:8}}>🎯 Quests</h3>{quests.slice(0,3).map(q=><div key={q.id} style={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{q.title}</span><span style={{color:BLUE}}>{q.progress}/{q.target}</span></div><div style={{height:4,background:"#1e1e2e",borderRadius:2,marginTop:4}}><div style={{height:4,background:BLUE,borderRadius:2,width:`${Math.min(100,q.progress/q.target*100)}%`}}/></div></div>)}</div>
      </div>
      {jobs.length>0&&<div className="cd mt"><h3 style={{color:TXT,marginBottom:12}}>Recent Jobs</h3>{jobs.slice(-5).reverse().map(j=><div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span>{j.property} <span style={{color:DIM}}>· {j.client}</span></span><span style={{color:GREEN,fontFamily:"'Oswald'"}}>${j.total.toFixed(0)}</span></div>)}</div>}
    </div>
  );
}

/* QUOTEFORGE */
function QF({jobs,setJobs}) {
  const [mode,setMode]=useState(null);
  const [text,setText]=useState("");
  const [prop,setProp]=useState("");
  const [client,setClient]=useState("");
  const [rooms,setRooms]=useState([]);
  const [tab,setTab]=useState("quote");
  const [nr,setNr]=useState("");
  const [nd,setNd]=useState("");
  const [nc,setNc]=useState("");
  const [nh,setNh]=useState("1");
  const [nm,setNm]=useState("20");

  const doParse=()=>{if(!text.trim())return;const p=parseZInspector(text);if(p.length===0){alert("No items found. Paste the full report text.");return}const pm=text.match(/Property\s+[\w\s]*?([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way))/i);if(pm)setProp(pm[1].trim());if(text.toLowerCase().includes("keyrenter"))setClient("Keyrenter PMC");setRooms(p);setMode("editing")};

  const addItem=()=>{if(!nr||!nd)return;const item={id:Math.random().toString(36).slice(2,8),detail:nd,condition:"-",comment:nc||"Per scope",laborHrs:parseFloat(nh)||1,materials:[{name:"Materials",cost:parseFloat(nm)||0}]};const ex=rooms.find(r=>r.name===nr);if(ex){setRooms(rooms.map(r=>r.name===nr?{...r,items:[...r.items,item]}:r))}else{setRooms([...rooms,{name:nr,items:[item]}])}setNd("");setNc("");setNh("1");setNm("20");if(mode!=="editing")setMode("editing")};

  const rmItem=(rn,id)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.filter(i=>i.id!==id)}:r).filter(r=>r.items.length>0));
  const upItem=(rn,id,f,v)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.map(i=>i.id===id?{...i,[f]:v}:i)}:r));

  const all=rooms.flatMap(r=>r.items.map(i=>({room:r.name,...i,...calcLine(i)})));
  const gt=all.reduce((s,i)=>s+i.total,0);
  const tl=all.reduce((s,i)=>s+i.laborCost,0);
  const tm=all.reduce((s,i)=>s+i.matCost,0);
  const th=all.reduce((s,i)=>s+i.laborHrs,0);
  const issues=classifyIssues(rooms);
  const guide=buildGuide(rooms);

  const saveJob=()=>{if(!prop){alert("Enter property address");return}setJobs(p=>[...p,{id:Date.now(),property:prop,client:client||"",date:new Date().toISOString().split("T")[0],rooms:JSON.parse(JSON.stringify(rooms)),items:all,total:gt,totalLabor:tl,totalMat:tm,totalHrs:th,status:"quoted",receipts:[]}]);alert("Saved: "+prop+" — $"+gt.toFixed(2));setMode(null);setRooms([]);setText("");setProp("");setClient("")};

  if(!mode) return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>⚡ QuoteForge Pro</h2>
      <div className="g3">
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:30}} onClick={()=>setMode("paste")}><div style={{fontSize:40,marginBottom:8}}>📄</div><h4 style={{color:BLUE}}>Parse Inspection</h4><p style={{color:DIM,fontSize:13,marginTop:8}}>Paste a zInspector report</p></div>
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:30}} onClick={()=>setMode("manual")}><div style={{fontSize:40,marginBottom:8}}>✏️</div><h4 style={{color:ORANGE}}>Manual Quote</h4><p style={{color:DIM,fontSize:13,marginTop:8}}>Build from scratch</p></div>
        <div className="cd" style={{textAlign:"center",padding:30}}><div style={{fontSize:40,marginBottom:8}}>📊</div><h4 style={{color:GREEN}}>Stats</h4><p style={{color:GREEN,fontSize:20,fontFamily:"'Oswald'",marginTop:8}}>{jobs.length} jobs · ${jobs.reduce((s,j)=>s+j.total,0).toFixed(0)}</p></div>
      </div>
    </div>
  );

  if(mode==="paste") return (
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>← Back</button><h2 style={{fontSize:22,color:BLUE}}>Parse Inspection</h2></div>
      <div className="cd">
        <p style={{color:DIM,fontSize:13,marginBottom:12}}>Paste the full text from any Keyrenter zInspector move-out report below.</p>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste full report text..." style={{height:250,fontFamily:"monospace",fontSize:12}}/>
        <div className="g2 mt"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property address"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client name"/></div>
        <div className="row mt"><button className="bb" onClick={doParse}>Parse →</button><button className="bo" onClick={()=>setMode("manual")}>Manual Instead</button></div>
      </div>
    </div>
  );

  if(mode==="manual"&&rooms.length===0) return (
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>← Back</button><h2 style={{fontSize:22,color:ORANGE}}>Manual Quote</h2></div>
      <div className="cd mb"><div className="g2"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property address *"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client name"/></div></div>
      <div className="cd">
        <h4 style={{marginBottom:12}}>Add First Item</h4>
        <div className="g2 mb"><input value={nr} onChange={e=>setNr(e.target.value)} placeholder="Room"/><input value={nd} onChange={e=>setNd(e.target.value)} placeholder="Item"/></div>
        <input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Description" style={{marginBottom:12}}/>
        <div className="g2"><div><label style={{fontSize:11,color:DIM}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step="0.25"/></div><div><label style={{fontSize:11,color:DIM}}>Materials $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div>
        <button className="bg mt" onClick={addItem}>Add Item</button>
      </div>
    </div>
  );

  return (
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>{setMode(null);setRooms([])}}>← Back</button><h2 style={{fontSize:22,color:BLUE}}>⚡ QuoteForge</h2><span style={{fontSize:12,color:RED,fontFamily:"'Oswald'",padding:"2px 10px",border:`1px solid ${RED}`,borderRadius:4}}>${RATE}/HR · 10% MARKUP</span></div>
      <div className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div style={{flex:"1 1 200px"}}><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *" style={{marginBottom:6}}/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div>
        <div style={{textAlign:"right"}}><div className="sl">Grand Total</div><div style={{fontSize:36,fontFamily:"'Oswald'",fontWeight:700,color:GREEN}}>${gt.toFixed(2)}</div></div>
      </div>
      <div className="g4 mb">
        <div className="cd" style={{textAlign:"center",padding:12}}><div className="sl">Labor</div><div style={{fontSize:20,fontFamily:"'Oswald'",color:BLUE}}>${tl.toFixed(0)}</div><div style={{fontSize:11,color:DIM}}>{th.toFixed(1)}h</div></div>
        <div className="cd" style={{textAlign:"center",padding:12}}><div className="sl">Materials</div><div style={{fontSize:20,fontFamily:"'Oswald'",color:ORANGE}}>${tm.toFixed(0)}</div></div>
        <div className="cd" style={{textAlign:"center",padding:12}}><div className="sl">Markup</div><div style={{fontSize:20,fontFamily:"'Oswald'",color:GREEN}}>${(gt-tl-tm).toFixed(0)}</div></div>
        <div className="cd" style={{textAlign:"center",padding:12}}><div className="sl">Items</div><div style={{fontSize:20,fontFamily:"'Oswald'",color:RED}}>{all.length}</div></div>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:16}}>
        {[{id:"quote",l:"📄 Quote"},{id:"guide",l:"🔧 Guide"},{id:"watchout",l:"⚠️ Watch Out"},{id:"add",l:"➕ Add"}].map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 18px",background:tab===t.id?BLUE:CARD,color:tab===t.id?"#fff":DIM,border:`1px solid ${tab===t.id?BLUE:BORDER}`,borderRadius:"8px 8px 0 0",fontFamily:"'Oswald'",fontSize:13}}>{t.l}</button>)}
        <div style={{flex:1}}/><button className="bb" onClick={saveJob}>Save Job</button>
      </div>

      {tab==="quote"&&rooms.map(room=>(
        <div key={room.name} style={{marginBottom:16}}>
          <h4 style={{color:BLUE,fontSize:15,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${BORDER}`}}>{room.name}</h4>
          {room.items.map(item=>{const{laborCost,matCost,total}=calcLine(item);return(
            <div key={item.id} className="cd" style={{marginBottom:6,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                <div style={{flex:"1 1 250px"}}>
                  <div className="row"><span style={{fontWeight:600,fontSize:14}}>{item.detail}</span><span className={`bd bd-${item.condition==="D"?"d":item.condition==="P"?"p":item.condition==="F"?"f":"s"}`}>{item.condition==="D"?"Damaged":item.condition==="P"?"Poor":item.condition==="F"?"Fair":"—"}</span></div>
                  <div style={{fontSize:13,color:DIM,marginTop:3}}>{item.comment}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:DIM}}>HRS</div><input type="number" value={item.laborHrs} step="0.25" min="0" onChange={e=>upItem(room.name,item.id,"laborHrs",parseFloat(e.target.value)||0)} style={{width:55,textAlign:"center",padding:"3px 4px",fontSize:13}}/></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:DIM}}>MAT $</div><input type="number" value={item.materials.reduce((s,m)=>s+m.cost,0)} step="1" min="0" onChange={e=>upItem(room.name,item.id,"materials",[{name:"Materials",cost:parseFloat(e.target.value)||0}])} style={{width:65,textAlign:"center",padding:"3px 4px",fontSize:13}}/></div>
                  <div style={{textAlign:"right",minWidth:65}}><div style={{fontSize:10,color:DIM}}>TOTAL</div><div style={{fontSize:15,fontFamily:"'Oswald'",fontWeight:600,color:GREEN}}>${total.toFixed(2)}</div></div>
                  <button onClick={()=>rmItem(room.name,item.id)} style={{background:"none",color:RED,fontSize:16,padding:4}}>✕</button>
                </div>
              </div>
            </div>
          )})}
        </div>
      ))}

      {tab==="guide"&&<div className="g2">
        <div className="cd"><h4 style={{color:BLUE,marginBottom:10}}>🧰 Tools</h4>{guide.tools.map((t,i)=><div key={i} className="sep" style={{fontSize:14}}>☐ {t}</div>)}</div>
        <div className="cd"><h4 style={{color:ORANGE,marginBottom:10}}>🛒 Shopping</h4><div style={{maxHeight:400,overflowY:"auto"}}>{guide.shopping.map((s,i)=><div key={i} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{s.name} <span style={{color:DIM}}>({s.room})</span></span><span style={{color:GREEN}}>${s.cost}</span></div>)}</div><div style={{marginTop:10,fontFamily:"'Oswald'",fontSize:16,textAlign:"right",color:GREEN}}>Total: ${guide.shopping.reduce((s,i)=>s+i.cost,0).toFixed(0)}</div></div>
        <div className="cd" style={{gridColumn:"1/-1"}}><h4 style={{color:GREEN,marginBottom:10}}>📋 Steps</h4>{guide.steps.map((s,i)=><div key={i} className="sep" style={{fontSize:14}}><span style={{color:BLUE,fontWeight:600}}>{s.room}</span> → {s.detail}: <span style={{color:DIM}}>{s.action}</span></div>)}</div>
      </div>}

      {tab==="watchout"&&<div>
        {[{t:"🚨 Critical",items:issues.critical,c:RED},{t:"⚠️ Important",items:issues.important,c:ORANGE},{t:"💡 Minor",items:issues.minor,c:YELLOW}].map((s,i)=><div key={i} className="cd mb" style={{borderLeft:`3px solid ${s.c}`}}><h4 style={{color:s.c,marginBottom:8}}>{s.t} ({s.items.length})</h4>{s.items.length===0?<span style={{color:DIM,fontSize:13}}>None</span>:s.items.map((it,j)=><div key={j} className="sep" style={{fontSize:14}}><b>{it.room}</b> — {it.detail}: {it.comment}</div>)}</div>)}
      </div>}

      {tab==="add"&&<div className="cd">
        <h4 style={{marginBottom:12}}>Add Line Item</h4>
        <div className="g2 mb"><div><label style={{fontSize:11,color:DIM}}>Room</label><input value={nr} onChange={e=>setNr(e.target.value)} placeholder="Room" list="rl"/><datalist id="rl">{rooms.map(r=><option key={r.name} value={r.name}/>)}</datalist></div><div><label style={{fontSize:11,color:DIM}}>Item</label><input value={nd} onChange={e=>setNd(e.target.value)} placeholder="e.g. Paint"/></div></div>
        <div style={{marginBottom:12}}><label style={{fontSize:11,color:DIM}}>Description</label><input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Scope"/></div>
        <div className="g2 mb"><div><label style={{fontSize:11,color:DIM}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step="0.25"/></div><div><label style={{fontSize:11,color:DIM}}>Materials $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div>
        <button className="bg" onClick={addItem}>Add to Quote</button>
      </div>}
    </div>
  );
}

/* JOBS */
function JobsPage({jobs,setJobs}) {
  const [open,setOpen]=useState(null);
  const [rn,setRn]=useState("");
  const [ra,setRa]=useState("");
  const addR=id=>{if(!rn||!ra)return;setJobs(p=>p.map(j=>j.id===id?{...j,receipts:[...j.receipts,{note:rn,amount:parseFloat(ra),date:new Date().toLocaleDateString()}]}:j));setRn("");setRa("")};
  const setSt=(id,s)=>setJobs(p=>p.map(j=>j.id===id?{...j,status:s}:j));
  const del=id=>{if(confirm("Delete?")){setJobs(p=>p.filter(j=>j.id!==id))}};
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>📋 Jobs ({jobs.length})</h2>
      {jobs.length===0?<div className="cd" style={{textAlign:"center",padding:40}}><div style={{fontSize:48,marginBottom:12}}>📋</div><p style={{color:DIM}}>No jobs. Use QuoteForge to create one.</p></div>:
      jobs.slice().reverse().map(job=>(
        <div key={job.id} className="cd mb">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",flexWrap:"wrap",gap:8}} onClick={()=>setOpen(open===job.id?null:job.id)}>
            <div><h4 style={{color:TXT,fontSize:16}}>{job.property}</h4><div style={{fontSize:13,color:DIM}}>{job.client} · {job.date} · {job.items?.length||0} items</div></div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{fontSize:22,fontFamily:"'Oswald'",color:GREEN}}>${job.total.toFixed(2)}</div>
              <select value={job.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setSt(job.id,e.target.value)}} style={{fontSize:12,padding:"4px 8px",width:"auto",background:job.status==="complete"?GREEN+"22":job.status==="active"?BLUE+"22":RED+"22"}}><option value="quoted">Quoted</option><option value="active">Active</option><option value="complete">Complete</option></select>
            </div>
          </div>
          {open===job.id&&<div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${BORDER}`}}>
            <h5 style={{color:BLUE,marginBottom:8}}>Receipts ({job.receipts.length})</h5>
            {job.receipts.map((r,i)=><div key={i} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:13}}><span>{r.date} — {r.note}</span><span style={{color:ORANGE}}>${r.amount.toFixed(2)}</span></div>)}
            <div style={{fontSize:13,color:GREEN,textAlign:"right",margin:"6px 0",fontFamily:"'Oswald'"}}>Spent: ${job.receipts.reduce((s,r)=>s+r.amount,0).toFixed(2)}</div>
            <div className="row mt"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Receipt note" style={{flex:1}}/><input type="number" value={ra} onChange={e=>setRa(e.target.value)} placeholder="$" style={{width:80}}/><button className="bb" onClick={e=>{e.stopPropagation();addR(job.id)}}>Add</button></div>
            <div style={{marginTop:12}}><button className="br" onClick={e=>{e.stopPropagation();del(job.id)}} style={{fontSize:11,padding:"6px 12px"}}>Delete</button></div>
          </div>}
        </div>
      ))}
    </div>
  );
}

/* TIME TRACKER */
function TT({timeEntries,setTimeEntries,jobs}) {
  const [on,setOn]=useState(false);
  const [st,setSt]=useState(null);
  const [el,setEl]=useState(0);
  const [sj,setSj]=useState("");
  const [mh,setMh]=useState("");
  const [mj,setMj]=useState("");

  useEffect(()=>{let iv;if(on&&st)iv=setInterval(()=>setEl(Date.now()-st),1000);return()=>clearInterval(iv)},[on,st]);

  const fmt=ms=>{const s=Math.floor(ms/1000);return`${Math.floor(s/3600).toString().padStart(2,"0")}:${Math.floor((s%3600)/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`};
  const start=()=>{setSt(Date.now());setOn(true)};
  const stop=()=>{const h=Math.round(el/3600000*100)/100;if(h>0)setTimeEntries(p=>[...p,{id:Date.now(),job:sj||"General",date:new Date().toLocaleDateString(),hours:h,amount:Math.round(h*RATE*100)/100}]);setOn(false);setSt(null);setEl(0)};
  const addM=()=>{const h=parseFloat(mh);if(!h||h<=0)return;setTimeEntries(p=>[...p,{id:Date.now(),job:mj||"General",date:new Date().toLocaleDateString(),hours:h,amount:Math.round(h*RATE*100)/100}]);setMh("");setMj("")};
  const delE=id=>setTimeEntries(p=>p.filter(e=>e.id!==id));

  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>⏱ Time Tracker</h2>
      <div className="cd mb" style={{textAlign:"center",padding:30}}>
        <div style={{fontSize:60,fontFamily:"'Oswald'",fontWeight:700,color:on?GREEN:DIM}}>{fmt(el)}</div>
        <div style={{marginTop:16,marginBottom:16}}>
          <label style={{fontSize:12,color:DIM}}>Job</label>
          <select value={sj} onChange={e=>setSj(e.target.value)} style={{maxWidth:400,margin:"0 auto",display:"block"}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property} ({j.client})</option>)}</select>
        </div>
        {!on?<button className="bb" onClick={start} style={{fontSize:18,padding:"12px 40px"}}>▶ Start</button>:<button className="br" onClick={stop} style={{fontSize:18,padding:"12px 40px"}}>⏹ Stop & Log</button>}
      </div>
      <div className="cd mb"><h4 style={{marginBottom:10}}>Manual Entry</h4><div className="row"><select value={mj} onChange={e=>setMj(e.target.value)} style={{flex:1}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><input type="number" value={mh} onChange={e=>setMh(e.target.value)} placeholder="Hours" step="0.25" min="0" style={{width:100}}/><button className="bg" onClick={addM}>Log</button></div></div>
      <div className="cd"><h4 style={{marginBottom:10}}>Log ({timeEntries.length})</h4>{timeEntries.length===0?<p style={{color:DIM}}>No entries.</p>:timeEntries.slice().reverse().map(e=><div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:14,alignItems:"center"}}><span>{e.date}</span><span style={{color:BLUE}}>{e.job}</span><span>{e.hours}h</span><span style={{color:GREEN}}>${e.amount.toFixed(2)}</span><button onClick={()=>delE(e.id)} style={{background:"none",color:RED,fontSize:14,padding:2}}>✕</button></div>)}</div>
    </div>
  );
}

/* PAYROLL */
function Pay({timeEntries}) {
  const th=timeEntries.reduce((s,e)=>s+e.hours,0);
  const tp=timeEntries.reduce((s,e)=>s+e.amount,0);
  const byJob={};timeEntries.forEach(e=>{byJob[e.job]=(byJob[e.job]||0)+e.hours});
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>💰 Payroll</h2>
      <div className="g3 mb">
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Hours</div><div className="sv" style={{color:BLUE}}>{th.toFixed(1)}</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Rate</div><div className="sv" style={{color:TXT}}>${RATE}/hr</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Total Pay</div><div className="sv" style={{color:GREEN}}>${tp.toFixed(2)}</div></div>
      </div>
      <div className="cd mb"><h4 style={{marginBottom:10}}>By Job</h4>{Object.keys(byJob).length===0?<p style={{color:DIM}}>No time yet.</p>:Object.entries(byJob).map(([j,h])=><div key={j} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span>{j}</span><span>{h.toFixed(1)}h → <span style={{color:GREEN}}>${(h*RATE).toFixed(2)}</span></span></div>)}</div>
      <div className="cd"><h4 style={{marginBottom:10}}>All Entries</h4>{timeEntries.slice().reverse().map(e=><div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span>{e.date}</span><span>{e.job}</span><span>{e.hours}h</span><span style={{color:GREEN}}>${e.amount.toFixed(2)}</span></div>)}</div>
    </div>
  );
}

/* QUESTS */
function QuestsPage({quests,setQuests}) {
  const xp=quests.reduce((s,q)=>s+(q.progress>=q.target?q.xp:0),0);
  const bump=id=>setQuests(p=>p.map(q=>q.id===id?{...q,progress:Math.min(q.progress+1,q.target)}:q));
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>🎯 Quests</h2>
      <div className="cd mb" style={{textAlign:"center",padding:24}}><div className="sl">XP Earned</div><div style={{fontSize:48,fontFamily:"'Oswald'",fontWeight:700,color:ORANGE}}>{xp}</div></div>
      {quests.map(q=>{const p=Math.min(100,q.progress/q.target*100),d=q.progress>=q.target;return(
        <div key={q.id} className="cd mb" style={{borderLeft:`3px solid ${d?GREEN:BLUE}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontWeight:600,fontSize:15}}>{d?"✅":"⏳"} {q.title}</span><div className="row"><span style={{fontFamily:"'Oswald'",color:ORANGE}}>+{q.xp} XP</span>{!d&&<button className="bo" onClick={()=>bump(q.id)} style={{fontSize:11,padding:"4px 10px"}}>+1</button>}</div></div>
          <div style={{height:8,background:"#1e1e2e",borderRadius:4}}><div style={{height:8,background:d?GREEN:BLUE,borderRadius:4,width:`${p}%`,transition:"width .5s"}}/></div>
          <div style={{fontSize:12,color:DIM,marginTop:4,textAlign:"right"}}>{q.progress}/{q.target}</div>
        </div>
      )})}
    </div>
  );
}

/* REVIEWS */
function Rev({testimonials,setTestimonials}) {
  const [n,setN]=useState("");const [t,setT]=useState("");const [r,setR]=useState(5);
  const add=()=>{if(!n||!t)return;setTestimonials(p=>[...p,{name:n,text:t,rating:r}]);setN("");setT("");setR(5)};
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>⭐ Reviews ({testimonials.length})</h2>
      <div className="cd mb"><h4 style={{marginBottom:12}}>Add Review</h4><div className="row mb"><input value={n} onChange={e=>setN(e.target.value)} placeholder="Client" style={{flex:1}}/><select value={r} onChange={e=>setR(Number(e.target.value))} style={{width:80}}>{[5,4,3,2,1].map(x=><option key={x} value={x}>{x}★</option>)}</select></div><textarea value={t} onChange={e=>setT(e.target.value)} placeholder="Review..." style={{height:60,marginBottom:10}}/><button className="bb" onClick={add}>Add</button></div>
      {testimonials.map((x,i)=><div key={i} className="cd mb"><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600}}>{x.name}</span><span style={{color:YELLOW}}>{"★".repeat(x.rating)}{"☆".repeat(5-x.rating)}</span></div><p style={{color:DIM,fontSize:14,marginTop:6}}>"{x.text}"</p></div>)}
    </div>
  );
}

/* REFERRALS */
function Ref({referrals,setReferrals}) {
  const [n,setN]=useState("");const [s,setS]=useState("");
  const add=()=>{if(!n)return;setReferrals(p=>[...p,{id:Date.now(),name:n,source:s,status:"pending",date:new Date().toLocaleDateString()}]);setN("");setS("")};
  return (
    <div className="fi">
      <h2 style={{fontSize:26,color:BLUE,marginBottom:20}}>🤝 Referrals ({referrals.length})</h2>
      <div className="cd mb"><h4 style={{marginBottom:12}}>Add</h4><div className="row"><input value={n} onChange={e=>setN(e.target.value)} placeholder="Name" style={{flex:1}}/><input value={s} onChange={e=>setS(e.target.value)} placeholder="Referred by" style={{flex:1}}/><button className="bb" onClick={add}>Add</button></div></div>
      {referrals.length===0?<div className="cd" style={{textAlign:"center",padding:30,color:DIM}}>None yet.</div>:referrals.map(r=><div key={r.id} className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:600}}>{r.name}</div><div style={{fontSize:13,color:DIM}}>From: {r.source} · {r.date}</div></div><select value={r.status} onChange={e=>setReferrals(p=>p.map(x=>x.id===r.id?{...x,status:e.target.value}:x))} style={{width:"auto",fontSize:12,padding:"4px 10px"}}><option value="pending">Pending</option><option value="contacted">Contacted</option><option value="converted">Converted</option></select></div>)}
    </div>
  );
}

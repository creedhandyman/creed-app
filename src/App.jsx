import{useState,useEffect,useRef,useCallback}from"react";

/* ====== SUPABASE ====== */
const SB="https://uwxirkvrotkeowfvrazq.supabase.co";
const SK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3eGlya3Zyb3RrZW93ZnZyYXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDkyMjIsImV4cCI6MjA5MTA4NTIyMn0.QXq7qP3Vv_t2T2Rs-pMN-r0_Jzw0gbv8nrTN2Z5nYlI";
const H={"apikey":SK,"Authorization":`Bearer ${SK}`,"Content-Type":"application/json","Prefer":"return=representation"};
const db={
  get:async(t,q="select=*")=>{try{const r=await fetch(`${SB}/rest/v1/${t}?${q}&order=id.desc`,{headers:H});return await r.json()}catch{return[]}},
  post:async(t,d)=>{try{const r=await fetch(`${SB}/rest/v1/${t}`,{method:"POST",headers:H,body:JSON.stringify(d)});return await r.json()}catch{return null}},
  patch:async(t,id,d)=>{try{await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`,{method:"PATCH",headers:H,body:JSON.stringify(d)})}catch{}},
  del:async(t,id)=>{try{await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`,{method:"DELETE",headers:H})}catch{}}
};
const ld=(k,f)=>{try{return JSON.parse(localStorage.getItem("c_"+k))||f}catch{return f}};
const sv=(k,v)=>localStorage.setItem("c_"+k,JSON.stringify(v));

/* ====== COLORS ====== */
const B="#2E75B6",R="#C00000",DK="#0a0a0f",G="#00cc66",O="#ff8800",Y="#ffcc00",LOGO="/CREED_LOGO.png";

/* ====== PDF ====== */
async function loadPdf(){if(window.pdfjsLib)return window.pdfjsLib;return new Promise(res=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";res(window.pdfjsLib)};document.head.appendChild(s)})}
async function readPdf(file){const lib=await loadPdf();const buf=await file.arrayBuffer();const pdf=await lib.getDocument({data:buf}).promise;let txt="";for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();const byY={};c.items.forEach(it=>{const y=Math.round(it.transform[5]);if(!byY[y])byY[y]=[];byY[y].push({x:it.transform[4],s:it.str})});Object.keys(byY).map(Number).sort((a,b)=>b-a).forEach(y=>{const l=byY[y].sort((a,b)=>a.x-b.x).map(x=>x.s).join(" ").trim();if(l)txt+=l+"\n"});txt+="\n"}return txt}

/* ====== PARSER ====== */
function norm(raw){let t=raw;t=t.replace(/\b(Kitchen|Appliances|Laundry Room|Living Room|Dining Room|Entry|Hallway\/Stairs|Garage\/Parking)\b/gi,"\n$1\n");t=t.replace(/\b(Bedroom\s*[\d:]*\s*[:\-]?\s*(?:North|South|Master|East|West)?)/gi,"\n$1\n");t=t.replace(/\b(Bathroom\s*[\d:]*\s*[:\-]?\s*(?:Main|Master|Hall)?[\s\w]*?(?:bathroom)?)/gi,"\n$1\n");t=t.replace(/\b(Compliance\s*[:\-]?\s*\w*|Exterior\s*[:\-]?\s*\w*)\b/gi,"\n$1\n");t=t.replace(/\b(Maintenance)\b/g,"\n$1\n");t=t.replace(/\b(None)\b/g,"\n$1\n");t=t.replace(/\s+([SFPD])\s+(Maintenance|None)/g,"\n$1\n$2\n");t=t.replace(/\bImage\b/g,"\nImage\n");t=t.replace(/\b(View Image|View Video)\b/g,"\n$1\n");t=t.replace(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g,"\n$1\n");t=t.replace(/(\d+\.\d+,\s*-?\d+)/g,"\n$1\n");t=t.replace(/\bPage \d+/g,"\nPage\n");t=t.replace(/\n{2,}/g,"\n");return t}

function parseZI(raw){if(!raw||raw.length<50)return[];const text=norm(raw);const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);const rooms=[];let cur=null;
const RP=[/^(Kitchen)\b/i,/^(Appliances)\b/i,/^(Laundry\s*Room)\b/i,/^(Living\s*Room)\b/i,/^(Dining\s*Room)\b/i,/^(Entry)\b/i,/^(Hallway\/Stairs)\b/i,/^(Bedroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Bathroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Garage\/Parking)\b/i,/^(Compliance\s*[:\-]?\s*\w*)/i,/^(Exterior\s*[:\-]?\s*\w*)/i];
const SKP=new Set(["Image","View Image","View Video","None","S","F","P","D","-","Detail","Condition","Actions","Comment","Media"]);
const skip=l=>SKP.has(l)||/^\d{4}-\d{2}/.test(l)||/^\d+\.\d+,/.test(l)||l.startsWith("Page")||l.startsWith("Report")||l==="Maintenance";
for(let i=0;i<lines.length;i++){const ln=lines[i];let rm=null;for(const p of RP){const m=ln.match(p);if(m&&ln.length<50&&!ln.includes("Condition")){rm=m[1];break}}
if(rm){cur={name:rm.replace(/\s+/g," ").replace(/:/g," ").trim(),items:[]};rooms.push(cur);continue}
if(!cur||ln!=="Maintenance")continue;let det="",cond="-";
for(let j=i-1;j>=Math.max(0,i-5);j--){const p=lines[j];if("SFPD".includes(p)&&p.length===1){cond=p;continue}if(p==="-")continue;if(skip(p))continue;if(p.length>2){det=p;break}}
let com="";for(let j=i+1;j<Math.min(lines.length,i+10);j++){const n=lines[j];if(skip(n))continue;if(n==="Maintenance"||n==="None")break;let nr=false;for(const p of RP)if(p.test(n)&&n.length<50){nr=true;break};if(nr)break;if(n.length>3){com+=(com?" ":"")+n}if(com.length>40)break}
if(det||com)cur.items.push({id:crypto.randomUUID().slice(0,8),detail:det||"General",condition:cond,comment:com||"Maintenance required",laborHrs:aL(com+" "+det),materials:aM(com+" "+det)})}
if(rooms.filter(r=>r.items.length>0).length===0)return rxParse(raw);
return rooms.filter(r=>r.items.length>0)}

function rxParse(raw){const rooms={};const rn=["Kitchen","Appliances","Laundry Room","Living Room","Dining Room","Entry","Hallway","Bedroom","Bathroom","Garage","Compliance","Exterior"];let si=0;
while(true){const idx=raw.indexOf("Maintenance",si);if(idx===-1)break;si=idx+11;
const bef=raw.substring(Math.max(0,idx-200),idx);const aft=raw.substring(idx+11,Math.min(raw.length,idx+300));
let room="General";for(const r of rn)if(bef.lastIndexOf(r)!==-1){room=r;break};
const dm=bef.match(/([\w\s/]+?)(?:\s+[SFPD\-]\s*)?$/);let det=dm?dm[1].trim().split(/\s{2,}/).pop()||"General":"General";if(det.length>40)det=det.slice(-40).trim();if(det.length<3)det="General";
const cm=aft.match(/^\s*(.{5,80}?)(?=\s*(?:Image|View|Maintenance|None|\d{4}-\d{2}|Page|$))/);const com=cm?cm[1].trim():"Maintenance required";
const cdm=bef.match(/\b([SFPD])\s*$/);const cond=cdm?cdm[1]:"-";
if(/^Detail|^Condition|^Actions/.test(det))continue;
if(!rooms[room])rooms[room]={name:room,items:[]};
rooms[room].items.push({id:crypto.randomUUID().slice(0,8),detail:det,condition:cond,comment:com,laborHrs:aL(com+" "+det),materials:aM(com+" "+det)})}
return Object.values(rooms).filter(r=>r.items.length>0)}

function aL(t){t=t.toLowerCase();if(/full replace|full repaint|complete repaint/.test(t))return 6;if(t.includes("replace")&&/floor|carpet|tile/.test(t))return 5;if(t.includes("water damage"))return 8;if(/repaint|full paint/.test(t))return 5;if(t.includes("replace door"))return 2.5;if(/refinish|tile wall/.test(t))return 10;if(/touch.?up/.test(t))return 1.5;if(t.includes("patch")&&t.includes("paint"))return 2;if(t.includes("install")&&!t.includes("bulb"))return 1;if(t.includes("replace"))return 1;if(t.includes("repair"))return 1;if(/bulb|battery|filter/.test(t))return.25;if(/secure|tighten/.test(t))return.5;return 1}
function aM(t){t=t.toLowerCase();const m=[];if(t.includes("paint")&&/full|repaint/.test(t))m.push({n:"Paint+primer",c:70},{n:"Supplies",c:22});else if(t.includes("paint"))m.push({n:"Paint(qt)",c:20});if(t.includes("carpet"))m.push({n:"Carpet+pad",c:255});if(t.includes("tile")&&t.includes("floor"))m.push({n:"Floor tile",c:160});if(t.includes("tile")&&t.includes("wall"))m.push({n:"Wall tile",c:190});if(t.includes("blind"))m.push({n:"Blind",c:18});if(t.includes("door")&&t.includes("replace"))m.push({n:"Door+hw",c:80});if(/knob|doorknob/.test(t))m.push({n:"Knob",c:16});if(/smoke alarm|detector/.test(t))m.push({n:"Smoke alarm",c:20});if(t.includes("battery"))m.push({n:"9V",c:5});if(t.includes("bulb"))m.push({n:"Bulbs",c:10});if(t.includes("fire ext"))m.push({n:"Extinguisher",c:28});if(t.includes("caulk"))m.push({n:"Caulk",c:9});if(t.includes("shower head"))m.push({n:"Shower head",c:22});if(/flapper|fill valve/.test(t))m.push({n:"Toilet kit",c:17});if(t.includes("hinge"))m.push({n:"Hinges",c:14});if(/flooring|lvp/.test(t))m.push({n:"LVP",c:145});if(t.includes("sprayer"))m.push({n:"Sprayer",c:17});if(t.includes("bifold"))m.push({n:"Bifold",c:70});if(t.includes("fixture"))m.push({n:"Fixture",c:33});if(t.includes("screen"))m.push({n:"Screen kit",c:14});if(t.includes("mirror"))m.push({n:"Mirror",c:33});if(t.includes("refinish"))m.push({n:"Refinish kit",c:55});if(/latch|gate/.test(t))m.push({n:"Latch",c:14});if(t.includes("downspout"))m.push({n:"Downspout",c:22});if(t.includes("towel"))m.push({n:"Towel bar",c:16});if(/tp holder|toilet paper/.test(t))m.push({n:"TP holder",c:12});if(t.includes("stopper"))m.push({n:"Stopper",c:9});if(t.includes("transition"))m.push({n:"Transition",c:14});if(m.length===0)m.push({n:"Materials",c:17});return m}

function classify(rooms){const c=[],im=[],mi=[];rooms.forEach(r=>r.items.forEach(it=>{const e={room:r.name,...it},t=(it.comment+" "+it.detail).toLowerCase();if(/water damage|water intrusion|ungrounded|missing smoke|smoke alarm.*(missing|no )|fire ext.*missing|electrician|code compliance|carbon monoxide|structural|mold/.test(t))c.push(e);else if(it.condition==="D"||/broken|horrible|severe|full replace|cracked|detached|off track|failed/.test(t))im.push(e);else mi.push(e)}));return{critical:c,important:im,minor:mi}}
function mkGuide(rooms){const tools=new Set(["Drill/driver","Tape measure","Level","Utility knife","Caulk gun","Putty knife","PPE","Step ladder","Shop vac"]);const shop=[],steps=[];rooms.forEach(r=>r.items.forEach(it=>{const t=(it.comment+" "+it.detail).toLowerCase();if(t.includes("paint"))["Roller+covers","Angled brush","Drop cloths","Painters tape","Paint tray","Spackle knife"].forEach(x=>tools.add(x));if(t.includes("tile"))["Tile cutter","Notched trowel","Grout float"].forEach(x=>tools.add(x));if(/plumb|shower|toilet|faucet/.test(t))["Adjustable wrench","Plumbers tape"].forEach(x=>tools.add(x));if(/electric|outlet/.test(t))tools.add("Voltage tester");if(/door|hinge/.test(t)){tools.add("Chisel");tools.add("Hammer")};it.materials.forEach(m=>shop.push({...m,room:r.name}));const pri=it.condition==="D"?"HIGH":it.condition==="P"?"MED":"LOW";steps.push({room:r.name,detail:it.detail,action:it.comment,pri,hrs:it.laborHrs})}));steps.sort((a,b)=>({"HIGH":0,"MED":1,"LOW":2})[a.pri]-({"HIGH":0,"MED":1,"LOW":2})[b.pri]);return{tools:[...tools].sort(),shop,steps}}
const calc=(it,rate)=>{const lc=it.laborHrs*rate,mc=it.materials.reduce((s,m)=>s+(m.c||m.cost||0),0);return{lc,mc,tot:Math.round((lc+mc)*100)/100}};

/* ====== CSS ====== */
const css=d=>`
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{background:${d?DK:"#f0f2f5"};color:${d?"#e2e2e8":"#1a1a2a"};font-family:'Source Sans 3',sans-serif}
h1,h2,h3,h4,h5{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.05em}
input,textarea,select{background:${d?"#1a1a28":"#f5f5f8"};border:1px solid ${d?"#1e1e2e":"#ddd"};color:${d?"#e2e2e8":"#1a1a2a"};padding:9px 12px;border-radius:8px;font-family:'Source Sans 3',sans-serif;font-size:14px;outline:none;width:100%}
input:focus,textarea:focus,select:focus{border-color:${B}}
button{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;border:none;transition:.2s;font-size:13px}
.bb{background:${B};color:#fff;padding:9px 18px;border-radius:8px}.br{background:${R};color:#fff;padding:9px 18px;border-radius:8px}.bg{background:${G};color:#fff;padding:9px 18px;border-radius:8px}.bo{background:transparent;border:1px solid ${d?"#1e1e2e":"#ddd"};color:${d?"#888":"#666"};padding:7px 14px;border-radius:8px}
.cd{background:${d?"#12121a":"#fff"};border:1px solid ${d?"#1e1e2e":"#e0e0e0"};border-radius:12px;padding:16px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.mt{margin-top:14px}.mb{margin-bottom:14px}.sep{border-bottom:1px solid ${d?"#1e1e2e":"#eee"};padding:7px 0}
.sv{font-size:24px;font-family:'Oswald';font-weight:700}.sl{font-size:10px;color:${d?"#888":"#888"};font-family:'Oswald';text-transform:uppercase;letter-spacing:.1em}
.dim{color:${d?"#888":"#888"}}
@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fi .25s ease forwards}
.vnav{position:fixed;right:0;top:0;bottom:0;width:52px;background:${d?"#0d0d18":"#e8edf5"};border-left:1px solid ${d?"#1e1e2e":"#ddd"};display:flex;flex-direction:column;align-items:center;padding:6px 0;z-index:200;justify-content:space-between}
.vnav button{width:42px;height:42px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:8px;letter-spacing:.04em;background:transparent;color:${d?"#888":"#666"};padding:0}
.vnav button.act{background:${B};color:#fff}
.vnav img{width:30px;height:30px;border-radius:6px;cursor:pointer}
.mc{margin-right:52px;padding:14px 10px;max-width:900px;min-height:100vh}
@media print{.vnav{display:none!important}.mc{margin-right:0!important}}
`;

/* ====== APP ====== */
export default function App(){
  const[dk,setDk]=useState(()=>ld("dk",true));
  const[user,setUser]=useState(()=>ld("user",null));
  const[pg,setPg]=useState("dash");
  const[showSet,setShowSet]=useState(false);
  const[users,setUsers]=useState([]);const[jobs,setJobs]=useState([]);const[time,setTime]=useState([]);
  const[reviews,setReviews]=useState([]);const[referrals,setReferrals]=useState([]);
  const[sched,setSched]=useState([]);const[payH,setPayH]=useState([]);const[loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    const[p,j,t,rv,rf,s,ph]=await Promise.all([db.get("profiles","select=*"),db.get("jobs"),db.get("time_entries"),db.get("reviews"),db.get("referrals"),db.get("schedule"),db.get("pay_history")]);
    if(Array.isArray(p))setUsers(p);if(Array.isArray(j))setJobs(j);if(Array.isArray(t))setTime(t);
    if(Array.isArray(rv))setReviews(rv);if(Array.isArray(rf))setReferrals(rf);
    if(Array.isArray(s))setSched(s);if(Array.isArray(ph))setPayH(ph);setLoading(false)
  },[]);
  useEffect(()=>{if(user)load()},[user,load]);
  useEffect(()=>{if(!user)return;const iv=setInterval(load,15000);return()=>clearInterval(iv)},[user,load]);
  useEffect(()=>{sv("dk",dk)},[dk]);useEffect(()=>{sv("user",user)},[user]);

  if(!user)return<Login setUser={setUser} dk={dk}/>;
  if(loading)return<div style={{minHeight:"100vh",background:dk?DK:"#f0f2f5",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css(dk)}</style><h2 style={{color:B}}>Loading Creed...</h2></div>;
  if(showSet)return<div style={{minHeight:"100vh",background:dk?DK:"#f0f2f5"}}><style>{css(dk)}</style><Settings user={user} setUser={setUser} users={users} load={load} dk={dk} setDk={setDk} onClose={()=>setShowSet(false)}/></div>;

  // NAV: top=Quests, bottom=QuoteForge (most accessible). Logo=Dashboard
  const NAV=[{id:"quests",i:"🎯",l:"Quest"},{id:"payroll",i:"💰",l:"Pay"},{id:"time",i:"⏱",l:"Time"},{id:"sched",i:"📅",l:"Sched"},{id:"jobs",i:"📋",l:"Jobs"},{id:"qf",i:"⚡",l:"Quote"}];

  return(<div style={{minHeight:"100vh",background:dk?DK:"#f0f2f5"}}><style>{css(dk)}</style>
    <div className="vnav">
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
        {NAV.slice(0,3).map(n=><button key={n.id} className={pg===n.id?"act":""} onClick={()=>setPg(n.id)}><span style={{fontSize:15}}>{n.i}</span><span>{n.l}</span></button>)}
      </div>
      <img src={LOGO} alt="" onClick={()=>setPg("dash")} onError={e=>e.target.style.display="none"} title="Dashboard"/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
        {NAV.slice(3).map(n=><button key={n.id} className={pg===n.id?"act":""} onClick={()=>setPg(n.id)}><span style={{fontSize:15}}>{n.i}</span><span>{n.l}</span></button>)}
      </div>
    </div>
    <div className="mc">
      {pg==="dash"&&<Dash user={user} jobs={jobs} time={time} reviews={reviews} referrals={referrals} setPg={setPg} setShowSet={setShowSet} dk={dk}/>}
      {pg==="qf"&&<QF user={user} users={users} jobs={jobs} load={load} setPg={setPg} dk={dk}/>}
      {pg==="jobs"&&<Jobs user={user} users={users} jobs={jobs} load={load} setPg={setPg} dk={dk}/>}
      {pg==="sched"&&<Sched jobs={jobs} sched={sched} load={load} setPg={setPg} dk={dk}/>}
      {pg==="time"&&<Timer user={user} jobs={jobs} sched={sched} time={time} load={load} dk={dk}/>}
      {pg==="payroll"&&<Pay user={user} users={users} time={time} payH={payH} load={load} dk={dk}/>}
      {pg==="quests"&&<Quest jobs={jobs} reviews={reviews} setReviews={setReviews} referrals={referrals} setReferrals={setReferrals} load={load} dk={dk}/>}
    </div>
  </div>);
}

/* ====== LOGIN ====== */
function Login({setUser,dk}){const[m,setM]=useState("login");const[e,setE]=useState("");const[p,setP]=useState("");const[n,setN]=useState("");const[err,setErr]=useState("");
const login=async()=>{const r=await db.get("profiles",`email=eq.${encodeURIComponent(e)}&password=eq.${encodeURIComponent(p)}`);r?.length?setUser(r[0]):setErr("Invalid credentials")};
const signup=async()=>{if(!e||!p||!n){setErr("Fill all fields");return}const ex=await db.get("profiles",`email=eq.${encodeURIComponent(e)}`);if(ex?.length){setErr("Email exists");return}const r=await db.post("profiles",{email:e,password:p,name:n,role:"tech",rate:35,start_date:new Date().toISOString().split("T")[0],emp_num:String(Math.floor(Math.random()*900)+100)});r?.length&&setUser(r[0])};
return(<div style={{minHeight:"100vh",background:`linear-gradient(135deg,${DK},#0d1530)`,display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css(true)}</style>
<div style={{width:340}}><div style={{textAlign:"center",marginBottom:20}}><img src={LOGO} alt="" style={{height:72,marginBottom:8}} onError={e=>e.target.style.display="none"}/><h1 style={{color:B,fontSize:24}}>Creed Handyman</h1><div style={{color:R,fontSize:11,fontFamily:"'Oswald'",letterSpacing:".15em"}}>LLC</div></div>
<div className="cd" style={{padding:24,background:"#12121a",border:"1px solid #1e1e2e"}}><h3 style={{textAlign:"center",marginBottom:14,color:"#e2e2e8",fontSize:16}}>{m==="login"?"Sign In":"Create Account"}</h3>
{m==="signup"&&<div style={{marginBottom:8}}><input value={n} onChange={x=>setN(x.target.value)} placeholder="Your name" style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>}
<div style={{marginBottom:8}}><input type="email" value={e} onChange={x=>setE(x.target.value)} placeholder="Email" style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>
<div style={{marginBottom:12}}><input type="password" value={p} onChange={x=>setP(x.target.value)} placeholder="Password" onKeyDown={x=>x.key==="Enter"&&(m==="login"?login():signup())} style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>
{err&&<div style={{color:R,fontSize:12,marginBottom:8,textAlign:"center"}}>{err}</div>}
<button className="bb" onClick={m==="login"?login:signup} style={{width:"100%",padding:11,fontSize:15}}>{m==="login"?"Sign In":"Sign Up"}</button>
<div style={{textAlign:"center",marginTop:12,fontSize:12,color:"#888"}}>{m==="login"?"No account? ":"Have account? "}<span onClick={()=>{setM(m==="login"?"signup":"login");setErr("")}} style={{color:B,cursor:"pointer",textDecoration:"underline"}}>{m==="login"?"Sign Up":"Sign In"}</span></div></div>
<div style={{textAlign:"center",marginTop:14,color:"#888",fontSize:10}}>Lic #6145054 · Wichita, KS · (316) 252-6335</div></div></div>)}

/* ====== SETTINGS ====== */
function Settings({user,setUser,users,load,dk,setDk,onClose}){const[tab,setTab]=useState("account");const[np,setNp]=useState("");
const isOwn=user.role==="owner"||user.role==="manager";
return(<div className="fi" style={{maxWidth:500,margin:"0 auto",padding:"16px 12px"}}>
<div className="row mb"><button className="bo" onClick={onClose}>← Back</button><h2 style={{fontSize:20,color:B}}>⚙️ Settings</h2></div>
<div style={{display:"flex",gap:4,marginBottom:14}}>{["account","team","general"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:tab===t?B:"transparent",color:tab===t?"#fff":"#888",fontFamily:"'Oswald'"}}>{t}</button>)}</div>
{tab==="account"&&<div><div className="cd mb">{[["Name",user.name],["Email",user.email],["Role",user.role],["#",user.emp_num],["Rate","$"+(user.rate||55)+"/hr"],["Start",user.start_date]].map(([l,v],i)=><div key={i} className="sep" style={{fontSize:13}}><span className="dim">{l}:</span> {v||"—"}</div>)}</div>
<div className="cd mb"><h4 style={{fontSize:14,marginBottom:8}}>Change Password</h4><div className="row"><input type="password" value={np} onChange={e=>setNp(e.target.value)} placeholder="New password (min 6)"/><button className="bb" onClick={async()=>{if(np.length<6){alert("Min 6");return}await db.patch("profiles",user.id,{password:np});setUser({...user,password:np});setNp("");alert("Updated")}}>Save</button></div></div>
<div className="cd"><button className="br" onClick={()=>{setUser(null);onClose()}} style={{width:"100%"}}>Sign Out</button></div></div>}
{tab==="team"&&<div className="cd"><h4 style={{fontSize:14,marginBottom:8}}>Team ({users.length})</h4>{users.map(u=><div key={u.id} className="sep" style={{fontSize:13}}><div className="row" style={{justifyContent:"space-between"}}><div><b>{u.name}</b> <span className="dim">({u.role}) #{u.emp_num}</span></div>{isOwn?<div className="row"><span>$</span><input type="number" defaultValue={u.rate} style={{width:55,padding:"2px 4px",fontSize:12}} onBlur={async e=>{await db.patch("profiles",u.id,{rate:parseFloat(e.target.value)||0});load()}}/><span style={{fontSize:11}}>/hr</span></div>:<span>${u.id===user.id?user.rate:"—"}/hr</span>}</div></div>)}</div>}
{tab==="general"&&<div className="cd"><h4 style={{fontSize:14,marginBottom:8}}>Appearance</h4><div className="sep row" style={{justifyContent:"space-between"}}><span>Dark Mode</span><div onClick={()=>setDk(!dk)} style={{width:44,height:24,borderRadius:12,background:dk?B:"#ccc",position:"relative",cursor:"pointer"}}><div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:dk?23:3,transition:".3s"}}/></div></div></div>}
</div>)}

/* ====== DASHBOARD ====== */
function Dash({user,jobs,time,reviews,referrals,setPg,setShowSet,dk}){
  const active=jobs.filter(j=>j.status==="active").length;
  const quoted=jobs.filter(j=>j.status==="quoted").length;
  const toCollect=jobs.filter(j=>j.status!=="complete").reduce((s,j)=>s+(j.total||0),0);
  // Earned this week
  const now=new Date();const ws=new Date(now);ws.setDate(now.getDate()-now.getDay());ws.setHours(0,0,0,0);
  const weekJobs=jobs.filter(j=>{if(j.status!=="complete")return false;try{return new Date(j.job_date||j.created_at)>=ws}catch{return false}});
  const earnedWeek=weekJobs.reduce((s,j)=>s+(j.total||0),0);

  return(<div className="fi">
    <div className="row mb" style={{justifyContent:"space-between"}}><h2 style={{fontSize:22,color:B}}>Welcome, {user.name}</h2><button onClick={()=>setShowSet(true)} style={{background:"none",fontSize:20,color:dk?"#888":"#666"}}>⚙️</button></div>
    <div className="g4 mb">
      <div className="cd" style={{borderLeft:`3px solid ${B}`}}><div className="sl">Active Jobs</div><div className="sv" style={{color:B}}>{active}</div></div>
      <div className="cd" style={{borderLeft:`3px solid ${O}`}}><div className="sl">Quoted</div><div className="sv" style={{color:O}}>{quoted}</div></div>
      <div className="cd" style={{borderLeft:`3px solid ${Y}`}}><div className="sl">To Collect</div><div className="sv" style={{color:Y}}>${toCollect.toLocaleString()}</div></div>
      <div className="cd" style={{borderLeft:`3px solid ${G}`}}><div className="sl">Earned This Week</div><div className="sv" style={{color:G}}>${earnedWeek.toLocaleString()}</div></div>
    </div>
    {/* BIG QUOTEFORGE BUTTON */}
    <div onClick={()=>setPg("qf")} style={{background:`linear-gradient(135deg,${B},#1a4d8a)`,borderRadius:16,padding:"28px 20px",textAlign:"center",cursor:"pointer",marginBottom:16}}>
      <div style={{fontSize:36,marginBottom:4}}>⚡</div>
      <h2 style={{color:"#fff",fontSize:22,marginBottom:4}}>Start a Quote</h2>
      <p style={{color:"#ffffffaa",fontSize:13,fontFamily:"'Source Sans 3'",textTransform:"none",letterSpacing:"normal"}}>Upload a PDF, paste an inspection, or build from scratch</p>
    </div>
    {/* Recent pipeline */}
    {jobs.length>0&&<div className="cd"><h4 style={{fontSize:14,marginBottom:8}}>Pipeline</h4>{jobs.slice(0,6).map(j=><div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span style={{flex:1}}>{j.property}</span><span className="dim" style={{width:55}}>{j.status}</span><span style={{color:j.status==="complete"?G:O,fontFamily:"'Oswald'",width:65,textAlign:"right"}}>${(j.total||0).toFixed(0)}</span></div>)}</div>}
  </div>);
}

/* ====== QUOTEFORGE ====== */
function QF({user,users,jobs,load,setPg,dk}){
  const[mode,setMode]=useState(null);const[text,setText]=useState("");const[prop,setProp]=useState("");const[client,setClient]=useState("");
  const[rooms,setRooms]=useState([]);const[tab,setTab]=useState("quote");const[workers,setWorkers]=useState([]);
  const[nr,setNr]=useState("");const[nd,setNd]=useState("");const[nc,setNc]=useState("");const[nh,setNh]=useState("1");const[nm,setNm]=useState("20");
  const[parsing,setParsing]=useState(false);const fileRef=useRef();const rate=user.rate||55;

  const doParse=()=>{if(!text.trim())return;const p=parseZI(text);if(!p.length){const c=(text.match(/Maintenance/gi)||[]).length;alert(`Found ${c} "Maintenance" refs but couldn't parse. Try Upload PDF or Manual.`);return}
  const pm=text.match(/([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way|Circle|Place))/i);if(pm&&!prop)setProp(pm[1].trim());setRooms(p);setMode("edit")};
  const handleFile=async e=>{const f=e.target.files[0];if(!f)return;setParsing(true);try{if(f.name.endsWith(".pdf")){const t=await readPdf(f);setText(t);setParsing(false);setMode("paste")}else{const t=await f.text();setText(t);setParsing(false);setMode("paste")}}catch(err){console.error(err);alert("Error reading file");setParsing(false);setMode("paste")}};
  const addItem=()=>{if(!nr||!nd)return;const it={id:crypto.randomUUID().slice(0,8),detail:nd,condition:"-",comment:nc||"Per scope",laborHrs:parseFloat(nh)||1,materials:[{n:"Materials",c:parseFloat(nm)||0}]};const ex=rooms.find(r=>r.name===nr);if(ex)setRooms(rooms.map(r=>r.name===nr?{...r,items:[...r.items,it]}:r));else setRooms([...rooms,{name:nr,items:[it]}]);setNd("");setNc("");setNh("1");setNm("20");if(mode!=="edit")setMode("edit")};
  const rmItem=(rn,id)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.filter(i=>i.id!==id)}:r).filter(r=>r.items.length>0));
  const upItem=(rn,id,f,v)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.map(i=>i.id===id?{...i,[f]:v}:i)}:r));
  const toggleWorker=id=>setWorkers(w=>w.includes(id)?w.filter(x=>x!==id):[...w,id]);

  const all=rooms.flatMap(r=>r.items.map(i=>({room:r.name,...i,...calc(i,rate)})));
  const gt=all.reduce((s,i)=>s+i.tot,0),tl=all.reduce((s,i)=>s+i.lc,0),tm=all.reduce((s,i)=>s+i.mc,0),th=all.reduce((s,i)=>s+i.laborHrs,0);
  const issues=classify(rooms),guide=mkGuide(rooms);

  const saveJob=async()=>{if(!prop){alert("Enter address");return}
    const data={rooms:rooms,workers:workers.map(wid=>{const u=users.find(x=>x.id===wid);return{id:wid,name:u?.name||""}})};
    await db.post("jobs",{property:prop,client:client||"",job_date:new Date().toISOString().split("T")[0],rooms:JSON.stringify(data),total:gt,total_labor:tl,total_mat:tm,total_hrs:th,status:"quoted",created_by:user.name});
    await load();alert("✅ Job created: "+prop);setMode(null);setRooms([]);setText("");setProp("");setClient("");setWorkers([]);setPg("jobs")};

  // START SCREEN
  if(!mode)return(<div className="fi">
    <h2 style={{fontSize:22,color:B,marginBottom:14}}>⚡ QuoteForge Pro</h2>
    {parsing&&<div className="cd mb" style={{textAlign:"center",padding:20}}><h4 style={{color:B}}>Reading PDF...</h4></div>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
      <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:18}} onClick={()=>fileRef.current?.click()}><div style={{fontSize:28}}>📁</div><h4 style={{color:O,fontSize:12,marginTop:4}}>Upload PDF</h4><input ref={fileRef} type="file" accept=".pdf,.txt" style={{display:"none"}} onChange={handleFile}/></div>
      <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:18}} onClick={()=>setMode("paste")}><div style={{fontSize:28}}>📄</div><h4 style={{color:B,fontSize:12,marginTop:4}}>Paste Text</h4></div>
      <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:18}} onClick={()=>setMode("manual")}><div style={{fontSize:28}}>✏️</div><h4 style={{color:G,fontSize:12,marginTop:4}}>Manual</h4></div>
    </div>
  </div>);

  // PASTE MODE
  if(mode==="paste")return(<div className="fi">
    <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>←</button><h2 style={{fontSize:18,color:B}}>Parse Report</h2></div>
    <div className="cd"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste report text here..." style={{height:200,fontFamily:"monospace",fontSize:11}}/>
    <div className="g2 mt"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property address"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div>
    <div className="row mt"><button className="bb" onClick={doParse}>Parse →</button><button className="bo" onClick={()=>fileRef.current?.click()}>Upload PDF</button><input ref={fileRef} type="file" accept=".pdf,.txt" style={{display:"none"}} onChange={handleFile}/></div></div>
  </div>);

  // MANUAL (empty)
  if(mode==="manual"&&!rooms.length)return(<div className="fi">
    <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>←</button><h2 style={{fontSize:18,color:O}}>Manual Quote</h2></div>
    <div className="cd mb"><div className="g2"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div></div>
    <div className="cd"><div className="g2 mb"><input value={nr} onChange={e=>setNr(e.target.value)} placeholder="Room"/><input value={nd} onChange={e=>setNd(e.target.value)} placeholder="Item"/></div><input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Description" style={{marginBottom:8}}/><div className="g2"><div><label style={{fontSize:10}} className="dim">Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step=".25"/></div><div><label style={{fontSize:10}} className="dim">Mat $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div><button className="bg mt" onClick={addItem}>Add Item</button></div>
  </div>);

  // EDITING VIEW
  return(<div className="fi">
    <div className="row mb"><button className="bo" onClick={()=>{setMode(null);setRooms([])}}>←</button><h2 style={{fontSize:18,color:B}}>⚡ Quote</h2><span style={{fontSize:10}} className="dim">${rate}/hr</span></div>
    <div className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
      <div style={{flex:"1 1 160px"}}><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *" style={{marginBottom:4,fontSize:13}}/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client" style={{fontSize:13}}/></div>
      <div style={{textAlign:"right"}}><div className="sl">Total</div><div style={{fontSize:28,fontFamily:"'Oswald'",fontWeight:700,color:G}}>${gt.toFixed(2)}</div></div>
    </div>
    {/* Stats */}
    <div className="g4 mb">{[{l:"Labor",v:"$"+tl.toFixed(0),c:B},{l:"Materials",v:"$"+tm.toFixed(0),c:O},{l:"Hours",v:th.toFixed(1),c:Y},{l:"Days",v:(th/8).toFixed(1),c:G}].map((x,i)=><div key={i} className="cd" style={{textAlign:"center",padding:8}}><div className="sl">{x.l}</div><div style={{fontSize:16,fontFamily:"'Oswald'",color:x.c}}>{x.v}</div></div>)}</div>
    {/* Assign Workers */}
    <div className="cd mb"><h4 style={{fontSize:13,marginBottom:6}}>👷 Assign Workers</h4>
      <div className="row">{users.map(u=><button key={u.id} onClick={()=>toggleWorker(u.id)} style={{padding:"5px 12px",borderRadius:20,fontSize:12,background:workers.includes(u.id)?B+"33":"transparent",color:workers.includes(u.id)?B:dk?"#888":"#666",border:`1px solid ${workers.includes(u.id)?B:dk?"#1e1e2e":"#ddd"}`}}>{workers.includes(u.id)?"✓ ":""}{u.name}</button>)}</div>
    </div>
    {/* Tabs */}
    <div style={{display:"flex",gap:3,marginBottom:12,flexWrap:"wrap"}}>
      {[{id:"quote",l:"📄Quote"},{id:"guide",l:"🔧Guide"},{id:"issues",l:"⚠️Issues"},{id:"add",l:"➕Add"}].map(x=><button key={x.id} onClick={()=>setTab(x.id)} style={{padding:"5px 12px",background:tab===x.id?B:dk?"#12121a":"#fff",color:tab===x.id?"#fff":"#888",border:`1px solid ${tab===x.id?B:dk?"#1e1e2e":"#ddd"}`,borderRadius:"6px 6px 0 0",fontFamily:"'Oswald'",fontSize:11}}>{x.l}</button>)}
      <div style={{flex:1}}/><button className="bg" onClick={saveJob} style={{fontSize:12,padding:"6px 16px"}}>Save & Create Job →</button>
    </div>
    {/* QUOTE TAB */}
    {tab==="quote"&&rooms.map(rm=><div key={rm.name} style={{marginBottom:12}}><h4 style={{color:B,fontSize:13,marginBottom:4,borderBottom:`1px solid ${dk?"#1e1e2e":"#eee"}`,paddingBottom:3}}>{rm.name}</h4>
      {rm.items.map(it=>{const{lc,mc,tot}=calc(it,rate);return<div key={it.id} className="cd" style={{marginBottom:4,padding:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 180px"}}><b style={{fontSize:12}}>{it.detail}</b> <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:it.condition==="D"?R+"33":it.condition==="P"?O+"33":it.condition==="F"?Y+"33":G+"33",color:it.condition==="D"?R:it.condition==="P"?O:it.condition==="F"?Y:G}}>{it.condition==="D"?"DMG":it.condition==="P"?"POOR":it.condition==="F"?"FAIR":"OK"}</span><div style={{fontSize:11}} className="dim">{it.comment}</div></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{textAlign:"center"}}><div style={{fontSize:8}} className="dim">HRS</div><input type="number" value={it.laborHrs} step=".25" min="0" onChange={e=>upItem(rm.name,it.id,"laborHrs",parseFloat(e.target.value)||0)} style={{width:45,textAlign:"center",padding:"2px",fontSize:11}}/></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:8}} className="dim">MAT</div><input type="number" value={it.materials.reduce((s,m)=>s+(m.c||m.cost||0),0)} step="1" min="0" onChange={e=>upItem(rm.name,it.id,"materials",[{n:"Mat",c:parseFloat(e.target.value)||0}])} style={{width:50,textAlign:"center",padding:"2px",fontSize:11}}/></div>
            <div style={{minWidth:50,textAlign:"right"}}><div style={{fontSize:8}} className="dim">TOT</div><div style={{fontSize:13,fontFamily:"'Oswald'",color:G}}>${tot.toFixed(0)}</div></div>
            <button onClick={()=>rmItem(rm.name,it.id)} style={{background:"none",color:R,fontSize:13,padding:1}}>✕</button>
          </div>
        </div></div>})}</div>)}
    {/* GUIDE TAB */}
    {tab==="guide"&&<div><div className="g2 mb"><div className="cd"><h4 style={{color:B,fontSize:13,marginBottom:6}}>🧰 Tools ({guide.tools.length})</h4>{guide.tools.map((t,i)=><div key={i} style={{fontSize:12,padding:"3px 0",borderBottom:`1px solid ${dk?"#1e1e2e":"#eee"}`}}>☐ {t}</div>)}</div><div className="cd"><h4 style={{color:O,fontSize:13,marginBottom:6}}>🛒 Shopping (${guide.shop.reduce((s,i)=>s+(i.c||0),0)})</h4><div style={{maxHeight:300,overflowY:"auto"}}>{guide.shop.map((s,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0",borderBottom:`1px solid ${dk?"#1e1e2e":"#eee"}`}}><span>{s.n} <span className="dim">({s.room})</span></span><span style={{color:G}}>${s.c}</span></div>)}</div></div></div>
    <div className="cd"><h4 style={{color:G,fontSize:13,marginBottom:6}}>📋 Work Order ({guide.steps.length} tasks · {th.toFixed(1)}h)</h4>{guide.steps.map((s,i)=><div key={i} style={{padding:"4px 0",borderBottom:`1px solid ${dk?"#1e1e2e":"#eee"}`,fontSize:12}}><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,marginRight:6,background:s.pri==="HIGH"?R+"33":s.pri==="MED"?O+"33":G+"33",color:s.pri==="HIGH"?R:s.pri==="MED"?O:G}}>{s.pri}</span><b style={{color:B}}>{s.room}</b> → {s.detail} <span className="dim">({s.hrs}h)</span><div className="dim" style={{fontSize:11,paddingLeft:4}}>{s.action}</div></div>)}</div></div>}
    {/* ISSUES TAB */}
    {tab==="issues"&&[{t:"🚨 Critical",it:issues.critical,c:R},{t:"⚠️ Important",it:issues.important,c:O},{t:"💡 Minor",it:issues.minor,c:Y}].map((s,i)=><div key={i} className="cd mb" style={{borderLeft:`3px solid ${s.c}`}}><h4 style={{color:s.c,fontSize:13,marginBottom:4}}>{s.t} ({s.it.length})</h4>{!s.it.length?<span className="dim" style={{fontSize:11}}>None</span>:s.it.map((x,j)=><div key={j} style={{fontSize:12,padding:"3px 0",borderBottom:`1px solid ${dk?"#1e1e2e":"#eee"}`}}><b>{x.room}</b> — {x.detail}: {x.comment}</div>)}</div>)}
    {/* ADD TAB */}
    {tab==="add"&&<div className="cd"><div className="g2 mb"><div><label style={{fontSize:10}} className="dim">Room</label><input value={nr} onChange={e=>setNr(e.target.value)} list="rl"/><datalist id="rl">{rooms.map(r=><option key={r.name} value={r.name}/>)}</datalist></div><div><label style={{fontSize:10}} className="dim">Item</label><input value={nd} onChange={e=>setNd(e.target.value)}/></div></div><div style={{marginBottom:8}}><label style={{fontSize:10}} className="dim">Description</label><input value={nc} onChange={e=>setNc(e.target.value)}/></div><div className="g2 mb"><div><label style={{fontSize:10}} className="dim">Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step=".25"/></div><div><label style={{fontSize:10}} className="dim">Mat $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div><button className="bg" onClick={addItem}>Add to Quote</button></div>}
  </div>);
}

/* ====== JOBS ====== */
function Jobs({user,users,jobs,load,setPg,dk}){const[open,setOpen]=useState(null);const[rn,setRn]=useState("");const[ra,setRa]=useState("");
const getWorkers=j=>{try{const d=typeof j.rooms==="string"?JSON.parse(j.rooms):j.rooms;return d?.workers||[]}catch{return[]}};
const addR=async id=>{if(!rn||!ra)return;await db.post("receipts",{job_id:id,note:rn,amount:parseFloat(ra),receipt_date:new Date().toLocaleDateString()});setRn("");setRa("");load()};
const setSt=async(id,s)=>{await db.patch("jobs",id,{status:s});load()};
return(<div className="fi">
  <h2 style={{fontSize:22,color:B,marginBottom:14}}>📋 Jobs ({jobs.length})</h2>
  {!jobs.length?<div className="cd" style={{textAlign:"center",padding:24}}><p className="dim">No jobs — create one in QuoteForge</p><button className="bb mt" onClick={()=>setPg("qf")}>⚡ Start Quote</button></div>:
  jobs.map(j=>{const w=getWorkers(j);return<div key={j.id} className="cd mb">
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",flexWrap:"wrap",gap:6}} onClick={()=>setOpen(open===j.id?null:j.id)}>
      <div><h4 style={{fontSize:14}}>{j.property}</h4><div style={{fontSize:11}} className="dim">{j.client} · {j.job_date}{w.length>0&&" · 👷 "+w.map(x=>x.name).join(", ")}</div></div>
      <div className="row"><div style={{fontSize:18,fontFamily:"'Oswald'",color:G}}>${(j.total||0).toFixed(0)}</div>
        <select value={j.status||"quoted"} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setSt(j.id,e.target.value)}} style={{fontSize:10,padding:"2px 6px",width:"auto",background:j.status==="complete"?G+"22":j.status==="active"?B+"22":O+"22"}}><option value="quoted">Quoted</option><option value="active">Active</option><option value="complete">Complete</option></select>
      </div>
    </div>
    {open===j.id&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${dk?"#1e1e2e":"#eee"}`}}>
      <div className="row"><button className="bb" onClick={e=>{e.stopPropagation();setPg("sched")}} style={{fontSize:10,padding:"5px 12px"}}>📅 Schedule This</button><button className="bo" onClick={async e=>{e.stopPropagation();if(confirm("Delete?")){await db.del("jobs",j.id);load()}}} style={{fontSize:10,padding:"5px 10px",color:R}}>Delete</button></div>
      <div className="mt"><h5 style={{fontSize:12,marginBottom:4}}>Add Receipt</h5><div className="row"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Note" style={{flex:1}}/><input type="number" value={ra} onChange={e=>setRa(e.target.value)} placeholder="$" style={{width:60}}/><button className="bg" onClick={e=>{e.stopPropagation();addR(j.id)}} style={{fontSize:10,padding:"5px 10px"}}>Add</button></div></div>
    </div>}
  </div>})}
  <div style={{textAlign:"center",marginTop:16}}><p className="dim" style={{fontSize:12}}>💡 Next step: Schedule a job → then start the Timer</p></div>
</div>)}

/* ====== SCHEDULE ====== */
function Sched({jobs,sched,load,setPg,dk}){
  const[sd,setSd]=useState("");const[sj,setSj]=useState("");const[sn,setSn]=useState("");
  const addS=async()=>{if(!sd||!sj)return;await db.post("schedule",{sched_date:sd,job:sj,note:sn});setSd("");setSj("");setSn("");load()};
  const now=new Date();const ws=new Date(now);ws.setDate(now.getDate()-now.getDay());ws.setHours(0,0,0,0);
  const week=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return d});
  const dn=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return(<div className="fi">
    <h2 style={{fontSize:22,color:B,marginBottom:14}}>📅 Schedule</h2>
    <div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Add to Schedule</h4>
      <div className="row"><input type="date" value={sd} onChange={e=>setSd(e.target.value)} style={{width:130}}/><select value={sj} onChange={e=>setSj(e.target.value)} style={{flex:1}}><option value="">Select job</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><button className="bg" onClick={addS} style={{fontSize:11,padding:"6px 12px"}}>Add</button></div>
      <input value={sn} onChange={e=>setSn(e.target.value)} placeholder="Notes (optional)" style={{marginTop:6}}/>
    </div>
    <div className="cd mb">
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
        {week.map((d,i)=>{const ds=d.toISOString().split("T")[0];const items=sched.filter(s=>s.sched_date===ds);const isT=ds===now.toISOString().split("T")[0];
          return<div key={i} style={{background:isT?B+"22":dk?"#12121a":"#fff",border:`1px solid ${isT?B:dk?"#1e1e2e":"#ddd"}`,borderRadius:6,padding:4,minHeight:70}}>
            <div style={{fontSize:9,fontFamily:"'Oswald'",color:isT?B:"#888",textAlign:"center"}}>{dn[i]}</div>
            <div style={{fontSize:12,textAlign:"center",fontWeight:600,marginBottom:3}}>{d.getDate()}</div>
            {items.map(s=><div key={s.id} style={{fontSize:8,background:B+"22",borderRadius:2,padding:"2px 3px",marginBottom:1,color:B,cursor:"pointer"}} onClick={()=>setPg("time")}>{s.job}</div>)}
          </div>})}
      </div>
      <div className="row mt"><button className="bo" onClick={()=>window.print()} style={{fontSize:10}}>🖨 Print Schedule</button><button className="bb" onClick={()=>setPg("time")} style={{fontSize:10,padding:"5px 14px"}}>⏱ Start Working →</button></div>
    </div>
    {/* All scheduled */}
    {sched.length>0&&<div className="cd"><h4 style={{fontSize:13,marginBottom:6}}>All Scheduled</h4>{sched.map(s=><div key={s.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"center"}}><span>{s.sched_date}</span><span style={{color:B,flex:1,marginLeft:8}}>{s.job}</span><span className="dim">{s.note}</span><button onClick={async()=>{await db.del("schedule",s.id);load()}} style={{background:"none",color:R,fontSize:12}}>✕</button></div>)}</div>}
    <div style={{textAlign:"center",marginTop:16}}><p className="dim" style={{fontSize:12}}>💡 Next: Start the Timer on today's scheduled job</p></div>
  </div>)}

/* ====== TIMER ====== */
function Timer({user,jobs,sched,time,load,dk}){
  const[on,setOn]=useState(()=>ld("t_on",false));const[st,setSt]=useState(()=>ld("t_st",null));const[sj,setSj]=useState(()=>ld("t_sj",""));const[el,setEl]=useState(0);
  const[mh,setMh]=useState("");const[mj,setMj]=useState("");const rate=user.rate||55;
  useEffect(()=>{sv("t_on",on)},[on]);useEffect(()=>{sv("t_st",st)},[st]);useEffect(()=>{sv("t_sj",sj)},[sj]);
  useEffect(()=>{let iv;if(on&&st)iv=setInterval(()=>setEl(Date.now()-st),1000);return()=>clearInterval(iv)},[on,st]);
  const fmt=ms=>{const s=Math.floor(ms/1000);return`${Math.floor(s/3600).toString().padStart(2,"0")}:${Math.floor((s%3600)/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`};
  const start=()=>{setSt(Date.now());setOn(true)};
  const stop=async()=>{const hrs=Math.round(el/3600000*100)/100;if(hrs>=0.01){await db.post("time_entries",{job:sj||"General",entry_date:new Date().toLocaleDateString(),hours:hrs,amount:Math.round(hrs*rate*100)/100,user_id:user.id,user_name:user.name});await load()}setOn(false);setSt(null);setEl(0)};
  const addM=async()=>{const h=parseFloat(mh);if(!h)return;await db.post("time_entries",{job:mj||"General",entry_date:new Date().toLocaleDateString(),hours:h,amount:Math.round(h*rate*100)/100,user_id:user.id,user_name:user.name});setMh("");setMj("");load()};

  // Today's scheduled jobs
  const today=new Date().toISOString().split("T")[0];
  const todayJobs=sched.filter(s=>s.sched_date===today);
  const myTime=time.filter(e=>e.user_id===user.id||(!e.user_id&&e.user_name===user.name));

  return(<div className="fi">
    <h2 style={{fontSize:22,color:B,marginBottom:14}}>⏱ Timer</h2>
    {todayJobs.length>0&&<div className="cd mb"><h4 style={{fontSize:12,marginBottom:6}}>📅 Today's Jobs</h4><div className="row">{todayJobs.map(s=><button key={s.id} onClick={()=>setSj(s.job)} className={sj===s.job?"bb":"bo"} style={{fontSize:11,padding:"5px 12px"}}>{s.job}</button>)}</div></div>}
    <div className="cd mb" style={{textAlign:"center",padding:20}}>
      <div style={{fontSize:48,fontFamily:"'Oswald'",fontWeight:700,color:on?G:dk?"#555":"#ccc"}}>{fmt(el)}</div>
      <select value={sj} onChange={e=>setSj(e.target.value)} style={{maxWidth:300,margin:"10px auto",display:"block"}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select>
      {!on?<button className="bb" onClick={start} style={{fontSize:16,padding:"10px 36px"}}>▶ Start</button>:<button className="br" onClick={stop} style={{fontSize:16,padding:"10px 36px"}}>⏹ Stop & Log</button>}
      {on&&<div style={{marginTop:6,fontSize:11,color:G}}>Running — persists across pages</div>}
    </div>
    <div className="cd mb"><h4 style={{fontSize:13,marginBottom:6}}>Manual Entry</h4><div className="row"><select value={mj} onChange={e=>setMj(e.target.value)} style={{flex:1}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><input type="number" value={mh} onChange={e=>setMh(e.target.value)} placeholder="Hrs" step=".25" style={{width:70}}/><button className="bg" onClick={addM} style={{fontSize:11,padding:"7px 12px"}}>Log</button></div></div>
    <div className="cd"><h4 style={{fontSize:13,marginBottom:6}}>My Log ({myTime.length})</h4>{!myTime.length?<p className="dim" style={{fontSize:12}}>No entries</p>:myTime.map(e=><div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"center",gap:4}}><span style={{minWidth:65}}>{e.entry_date}</span><span style={{color:B,flex:1}}>{e.job}</span><input type="number" defaultValue={e.hours} step=".25" min="0" style={{width:45,textAlign:"center",padding:"2px",fontSize:11}} onBlur={async ev=>{await db.patch("time_entries",e.id,{hours:parseFloat(ev.target.value)||0,amount:Math.round((parseFloat(ev.target.value)||0)*rate*100)/100});load()}}/><span style={{color:G,minWidth:45}}>${(e.amount||0).toFixed(2)}</span><button onClick={async()=>{await db.del("time_entries",e.id);load()}} style={{background:"none",color:R,fontSize:12}}>✕</button></div>)}</div>
    <div style={{textAlign:"center",marginTop:16}}><p className="dim" style={{fontSize:12}}>💡 Next: Review hours in Payroll</p></div>
  </div>)}

/* ====== PAYROLL ====== */
function Pay({user,users,time,payH,load,dk}){
  const isOwn=user.role==="owner"||user.role==="manager";
  const[sel,setSel]=useState(user.id);const selU=users.find(u=>u.id===sel)||user;
  const entries=time.filter(e=>e.user_id===sel||(sel===user.id&&!e.user_id&&e.user_name===user.name));
  const th=entries.reduce((s,e)=>s+(e.hours||0),0);const tp=th*(selU.rate||55);
  const byJob={};entries.forEach(e=>{byJob[e.job||"General"]=(byJob[e.job||"General"]||0)+(e.hours||0)});
  const processPay=async()=>{if(!entries.length)return;await db.post("pay_history",{user_id:sel,name:selU.name,pay_date:new Date().toLocaleDateString(),hours:th,amount:tp,entries:entries.length});alert(`✅ Processed: ${selU.name} — $${tp.toFixed(2)}`);load()};
  return(<div className="fi">
    <h2 style={{fontSize:22,color:B,marginBottom:14}}>💰 Payroll</h2>
    {isOwn&&<div className="cd mb"><div className="row"><span className="dim" style={{fontSize:12}}>Employee:</span><select value={sel} onChange={e=>setSel(e.target.value)} style={{flex:1}}>{users.map(u=><option key={u.id} value={u.id}>{u.name} (${u.rate}/hr)</option>)}</select></div></div>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
      <div className="cd" style={{textAlign:"center"}}><div className="sl">Hours</div><div className="sv" style={{color:B}}>{th.toFixed(1)}</div></div>
      <div className="cd" style={{textAlign:"center"}}><div className="sl">Rate</div><div className="sv">${selU.rate||55}/hr</div></div>
      <div className="cd" style={{textAlign:"center"}}><div className="sl">Total</div><div className="sv" style={{color:G}}>${tp.toFixed(2)}</div></div>
    </div>
    <div className="cd mb"><div className="row"><h4 style={{fontSize:13}}>By Job</h4><div style={{flex:1}}/>{isOwn&&<button className="bg" onClick={processPay} style={{fontSize:10,padding:"5px 12px"}}>Process Pay</button>}</div>{Object.entries(byJob).map(([j,h])=><div key={j} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{j}</span><span>{h.toFixed(1)}h → <span style={{color:G}}>${(h*(selU.rate||55)).toFixed(2)}</span></span></div>)}</div>
    {payH.filter(p=>p.user_id===sel).length>0&&<div className="cd"><h4 style={{fontSize:13,marginBottom:6}}>Payment History</h4>{payH.filter(p=>p.user_id===sel).map(p=><div key={p.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{p.pay_date}</span><span>{(p.hours||0).toFixed(1)}h</span><span style={{color:G}}>${(p.amount||0).toFixed(2)}</span></div>)}</div>}
  </div>)}

/* ====== QUESTS ====== */
function Quest({jobs,reviews,setReviews,referrals,setReferrals,load,dk}){
  const[tab,setTab]=useState("quests");const[rn,setRn]=useState("");const[rt,setRt]=useState("");const[rr,setRr]=useState(5);const[fn,setFn]=useState("");const[fs,setFs]=useState("");
  const done=jobs.filter(j=>j.status==="complete").length;const stars=reviews.filter(r=>r.rating===5).length;const conv=referrals.filter(r=>r.status==="converted").length;
  const Q=[{t:"Complete 5 jobs",p:Math.min(done,5),g:5,xp:100,s:"completed"},{t:"Get 3 five-star reviews",p:Math.min(stars,3),g:3,xp:75,s:"5★"},{t:"Earn 5 referrals",p:Math.min(conv,5),g:5,xp:50,s:"converted"}];
  const xp=Q.reduce((s,q)=>s+(q.p>=q.g?q.xp:0),0);
  const addRev=async()=>{if(!rn||!rt)return;await db.post("reviews",{client_name:rn,review_text:rt,rating:rr});setRn("");setRt("");setRr(5);load()};
  const addRef=async()=>{if(!fn)return;await db.post("referrals",{name:fn,source:fs,status:"pending",ref_date:new Date().toLocaleDateString()});setFn("");setFs("");load()};
  return(<div className="fi">
    <h2 style={{fontSize:22,color:B,marginBottom:14}}>🎯 Quest Hub</h2>
    <div style={{display:"flex",gap:3,marginBottom:12}}>{["quests","reviews","referrals"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:tab===t?B:"transparent",color:tab===t?"#fff":"#888",fontFamily:"'Oswald'"}}>{t==="quests"?"🎯Quests":t==="reviews"?"⭐Reviews":"🤝Referrals"}</button>)}</div>
    {tab==="quests"&&<div><div className="cd mb" style={{textAlign:"center",padding:16}}><div className="sl">XP</div><div style={{fontSize:38,fontFamily:"'Oswald'",fontWeight:700,color:O}}>{xp}</div></div>
      {Q.map((q,i)=>{const d=q.p>=q.g;return<div key={i} className="cd mb" style={{borderLeft:`3px solid ${d?G:B}`}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,fontWeight:600}}>{d?"✅":"⏳"} {q.t}</span><span style={{fontFamily:"'Oswald'",color:O,fontSize:12}}>+{q.xp}XP</span></div><div style={{height:6,background:dk?"#1e1e2e":"#eee",borderRadius:3}}><div style={{height:6,background:d?G:B,borderRadius:3,width:`${Math.min(100,q.p/q.g*100)}%`}}/></div><div style={{fontSize:10,textAlign:"right",marginTop:2}} className="dim">{q.p}/{q.g} {q.s}</div></div>})}</div>}
    {tab==="reviews"&&<div><div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Add Review</h4><div className="row mb"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Client" style={{flex:1}}/><select value={rr} onChange={e=>setRr(Number(e.target.value))} style={{width:60}}>{[5,4,3,2,1].map(x=><option key={x} value={x}>{x}★</option>)}</select></div><textarea value={rt} onChange={e=>setRt(e.target.value)} placeholder="Review..." style={{height:50,marginBottom:6}}/><button className="bb" onClick={addRev} style={{fontSize:11}}>Add</button></div>
      {reviews.map(r=><div key={r.id} className="cd mb"><div style={{display:"flex",justifyContent:"space-between"}}><b style={{fontSize:13}}>{r.client_name}</b><span style={{color:Y}}>{"★".repeat(r.rating||0)}{"☆".repeat(5-(r.rating||0))}</span></div><p className="dim" style={{fontSize:12,marginTop:3}}>"{r.review_text}"</p></div>)}</div>}
    {tab==="referrals"&&<div><div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Add Referral</h4><div className="row"><input value={fn} onChange={e=>setFn(e.target.value)} placeholder="Name" style={{flex:1}}/><input value={fs} onChange={e=>setFs(e.target.value)} placeholder="Referred by" style={{flex:1}}/><button className="bb" onClick={addRef} style={{fontSize:11}}>Add</button></div></div>
      {referrals.map(r=><div key={r.id} className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><b style={{fontSize:13}}>{r.name}</b><div style={{fontSize:11}} className="dim">{r.source} · {r.ref_date}</div></div><select value={r.status} onChange={async e=>{await db.patch("referrals",r.id,{status:e.target.value});load()}} style={{width:"auto",fontSize:10,padding:"3px 6px"}}><option value="pending">Pending</option><option value="contacted">Contacted</option><option value="converted">Converted</option></select></div>)}</div>}
  </div>)}

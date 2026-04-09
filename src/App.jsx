import{useState,useEffect,useRef,useCallback}from"react";

/* ====== SUPABASE CONFIG ====== */
const SB="https://uwxirkvrotkeowfvrazq.supabase.co";
const SK="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3eGlya3Zyb3RrZW93ZnZyYXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MDkyMjIsImV4cCI6MjA5MTA4NTIyMn0.QXq7qP3Vv_t2T2Rs-pMN-r0_Jzw0gbv8nrTN2Z5nYlI";
const H={"apikey":SK,"Authorization":`Bearer ${SK}`,"Content-Type":"application/json","Prefer":"return=representation"};
const api={
  get:async(t,q="select=*")=>{try{const r=await fetch(`${SB}/rest/v1/${t}?${q}`,{headers:H});return await r.json()}catch(e){console.error(e);return[]}},
  post:async(t,d)=>{try{const r=await fetch(`${SB}/rest/v1/${t}`,{method:"POST",headers:H,body:JSON.stringify(d)});return await r.json()}catch(e){console.error(e);return null}},
  patch:async(t,id,d)=>{try{await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`,{method:"PATCH",headers:H,body:JSON.stringify(d)})}catch(e){console.error(e)}},
  del:async(t,id)=>{try{await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`,{method:"DELETE",headers:H})}catch(e){console.error(e)}}
};

/* ====== CONSTANTS ====== */
const B="#2E75B6",R="#C00000",DK="#0a0a0f",LT="#f0f2f5",G="#00cc66",O="#ff8800",Y="#ffcc00",LOGO="/CREED_LOGO.png";

/* ====== LOCAL STORAGE ====== */
const ld=(k,f)=>{try{const v=localStorage.getItem("c_"+k);return v?JSON.parse(v):f}catch{return f}};
const sv=(k,v)=>localStorage.setItem("c_"+k,JSON.stringify(v));

/* ====== PDF LOADER ====== */
async function loadPdf(){
  if(window.pdfjsLib)return window.pdfjsLib;
  return new Promise(res=>{
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";res(window.pdfjsLib)};
    document.head.appendChild(s);
  });
}
async function readPdf(file){
  const lib=await loadPdf();
  const buf=await file.arrayBuffer();
  const pdf=await lib.getDocument({data:buf}).promise;
  let txt="";
  for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();txt+=c.items.map(x=>x.str).join(" ")+"\n"}
  return txt;
}

/* ====== PARSER ====== */
function parseZI(text){
  if(!text||text.length<50)return[];
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean),rooms=[];let cur=null;
  const RP=[/^(Kitchen)\b/i,/^(Appliances)\b/i,/^(Laundry\s*Room)\b/i,/^(Living\s*Room)\b/i,/^(Dining\s*Room)\b/i,/^(Entry)\b/i,/^(Hallway\/Stairs)\b/i,/^(Bedroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Bathroom\s*[\d:]*\s*[:\-]?\s*\w*)/i,/^(Garage\/Parking)\b/i,/^(Compliance\s*[:\-]?\s*\w*)/i,/^(Exterior\s*[:\-]?\s*\w*)/i];
  const SK=new Set(["Image","View Image","View Video","None","S","F","P","D","-","Detail","Condition","Actions","Comment","Media"]);
  const skip=l=>SK.has(l)||/^\d{4}-\d{2}/.test(l)||/^\d+\.\d+,/.test(l)||l.startsWith("Page ")||l.startsWith("Report ")||l==="Maintenance";
  for(let i=0;i<lines.length;i++){
    const ln=lines[i];let rm=null;
    for(const p of RP){const m=ln.match(p);if(m&&ln.length<50&&!ln.includes("Condition")){rm=m[1];break}}
    if(rm){cur={name:rm.replace(/\s+/g," ").replace(/:/g," ").trim(),items:[]};rooms.push(cur);continue}
    if(!cur||ln!=="Maintenance")continue;
    let det="",cond="-";
    for(let j=i-1;j>=Math.max(0,i-5);j--){const p=lines[j];if("SFPD".includes(p)&&p.length===1){cond=p;continue}if(p==="-")continue;if(skip(p))continue;if(p.length>2){det=p;break}}
    let com="";
    for(let j=i+1;j<Math.min(lines.length,i+8);j++){const n=lines[j];if(skip(n))continue;if(n==="Maintenance"||n==="None")break;let nr=false;for(const p of RP)if(p.test(n)&&n.length<50){nr=true;break};if(nr)break;if(n.length>3){com+=(com?" ":"")+n}if(com.length>20)break}
    if(det||com)cur.items.push({id:crypto.randomUUID().slice(0,8),detail:det||"General",condition:cond,comment:com||"Maintenance required",laborHrs:aL(com+" "+det),materials:aM(com+" "+det)});
  }
  return rooms.filter(r=>r.items.length>0);
}
function aL(t){t=t.toLowerCase();if(t.includes("full replace")||t.includes("full repaint")||t.includes("complete repaint"))return 6;if(t.includes("replace")&&/floor|carpet|tile/.test(t))return 5;if(t.includes("water damage"))return 8;if(t.includes("repaint")||t.includes("full paint"))return 5;if(t.includes("replace door"))return 2.5;if(t.includes("refinish")||t.includes("tile wall"))return 10;if(/touch.?up/.test(t))return 1.5;if(t.includes("patch")&&t.includes("paint"))return 2;if(t.includes("install")&&!t.includes("bulb"))return 1;if(t.includes("replace"))return 1;if(t.includes("repair"))return 1;if(/bulb|battery|filter/.test(t))return .25;if(/secure|tighten/.test(t))return .5;return 1}
function aM(t){t=t.toLowerCase();const m=[];
if(t.includes("paint")&&/full|repaint/.test(t))m.push({n:"Paint+primer",c:70},{n:"Supplies",c:22});
else if(t.includes("paint"))m.push({n:"Paint(qt)",c:20});
if(t.includes("carpet"))m.push({n:"Carpet+pad",c:255});if(t.includes("tile")&&t.includes("floor"))m.push({n:"Floor tile",c:160});
if(t.includes("tile")&&t.includes("wall"))m.push({n:"Wall tile",c:190});if(t.includes("blind"))m.push({n:"Blind",c:18});
if(t.includes("door")&&t.includes("replace"))m.push({n:"Door+hw",c:80});if(/knob|doorknob/.test(t))m.push({n:"Knob",c:16});
if(/smoke alarm|smoke detector/.test(t))m.push({n:"Smoke alarm",c:20});if(t.includes("battery"))m.push({n:"9V",c:5});
if(t.includes("bulb"))m.push({n:"Bulbs",c:10});if(t.includes("fire ext"))m.push({n:"Extinguisher",c:28});
if(t.includes("caulk"))m.push({n:"Caulk",c:9});if(t.includes("shower head"))m.push({n:"Shower head",c:22});
if(/flapper|fill valve/.test(t))m.push({n:"Toilet kit",c:17});if(t.includes("hinge"))m.push({n:"Hinges",c:14});
if(/flooring|lvp/.test(t))m.push({n:"LVP",c:145});if(t.includes("sprayer"))m.push({n:"Sprayer",c:17});
if(t.includes("bifold"))m.push({n:"Bifold",c:70});if(t.includes("fixture"))m.push({n:"Fixture",c:33});
if(t.includes("screen"))m.push({n:"Screen kit",c:14});if(t.includes("mirror"))m.push({n:"Mirror",c:33});
if(t.includes("refinish"))m.push({n:"Refinish kit",c:55});if(/latch|gate/.test(t))m.push({n:"Latch",c:14});
if(t.includes("downspout"))m.push({n:"Downspout",c:22});if(t.includes("transition"))m.push({n:"Transition",c:14});
if(t.includes("towel"))m.push({n:"Towel bar",c:16});if(/tp holder|toilet paper/.test(t))m.push({n:"TP holder",c:12});
if(t.includes("stopper"))m.push({n:"Stopper",c:9});if(t.includes("striker"))m.push({n:"Striker",c:7});
if(m.length===0)m.push({n:"Materials",c:17});return m}

function classify(rooms){const c=[],im=[],mi=[];rooms.forEach(r=>r.items.forEach(it=>{const e={room:r.name,...it},t=(it.comment+" "+it.detail).toLowerCase();if(/water damage|water intrusion|ungrounded|missing smoke|smoke alarm.*(missing|no )|fire ext.*missing|electrician|code compliance|carbon monoxide|structural|mold/.test(t))c.push(e);else if(it.condition==="D"||/broken|horrible|severe|full replace|cracked|detached|off track|failed/.test(t))im.push(e);else mi.push(e)}));return{critical:c,important:im,minor:mi}}

function mkGuide(rooms){
  const tools=new Set(["Drill/driver","Tape measure","Level","Utility knife","Caulk gun","Putty knife","PPE","Step ladder","Shop vac"]);
  const shop=[],steps=[];
  rooms.forEach(r=>r.items.forEach(it=>{
    const t=(it.comment+" "+it.detail).toLowerCase();
    if(t.includes("paint")){["4in roller+covers","2in angled brush","Drop cloths","Painters tape","Paint tray","Spackle knife"].forEach(x=>tools.add(x))}
    if(t.includes("tile")){["Tile cutter","Notched trowel","Grout float","Tile spacers"].forEach(x=>tools.add(x))}
    if(/plumb|shower|toilet|faucet|sprayer/.test(t)){["Adjustable wrench","Plumbers tape","Basin wrench","Bucket"].forEach(x=>tools.add(x))}
    if(/electric|outlet|switch/.test(t)){["Voltage tester","Wire strippers"].forEach(x=>tools.add(x))}
    if(/door|hinge/.test(t)){["Chisel","Hammer","Shims"].forEach(x=>tools.add(x))}
    it.materials.forEach(m=>shop.push({...m,room:r.name,detail:it.detail}));
    const pri=it.condition==="D"?"HIGH":it.condition==="P"?"MED":"LOW";
    steps.push({room:r.name,detail:it.detail,action:it.comment,pri,hrs:it.laborHrs});
  }));
  steps.sort((a,b)=>({"HIGH":0,"MED":1,"LOW":2})[a.pri]-({"HIGH":0,"MED":1,"LOW":2})[b.pri]);
  return{tools:[...tools].sort(),shop,steps};
}

const calc=(it,rate)=>{const lc=it.laborHrs*rate,mc=it.materials.reduce((s,m)=>s+(m.c||m.cost||0),0);return{lc,mc,tot:Math.round((lc+mc)*100)/100}};

/* ====== CSS ====== */
const mkCss=d=>`
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:${d?DK:LT};color:${d?"#e2e2e8":"#1a1a2a"};font-family:'Source Sans 3',sans-serif}
h1,h2,h3,h4,h5{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.05em}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${B};border-radius:3px}
input,textarea,select{background:${d?"#1a1a28":"#f5f5f8"};border:1px solid ${d?"#1e1e2e":"#ddd"};color:${d?"#e2e2e8":"#1a1a2a"};padding:9px 12px;border-radius:8px;font-family:'Source Sans 3',sans-serif;font-size:14px;outline:none;width:100%}
input:focus,textarea:focus,select:focus{border-color:${B}}
button{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;border:none;transition:.2s;font-size:13px}
.bb{background:${B};color:#fff;padding:9px 18px;border-radius:8px}
.br{background:${R};color:#fff;padding:9px 18px;border-radius:8px}
.bg{background:${G};color:#fff;padding:9px 18px;border-radius:8px}
.bo{background:transparent;border:1px solid ${d?"#1e1e2e":"#ddd"};color:${d?"#8888a0":"#666"};padding:7px 14px;border-radius:8px}
.bo:hover{border-color:${B};color:${B}}
.cd{background:${d?"#12121a":"#fff"};border:1px solid ${d?"#1e1e2e":"#e0e0e0"};border-radius:12px;padding:16px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.mt{margin-top:14px}.mb{margin-bottom:14px}
.sv{font-size:24px;font-family:'Oswald';font-weight:700}
.sl{font-size:10px;color:${d?"#8888a0":"#888"};font-family:'Oswald';text-transform:uppercase;letter-spacing:.1em}
.sep{border-bottom:1px solid ${d?"#1e1e2e":"#eee"};padding:7px 0}
@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fi .25s ease forwards}
.vnav{position:fixed;right:0;top:0;bottom:0;width:54px;background:${d?"#0d0d18":"#e8edf5"};border-left:1px solid ${d?"#1e1e2e":"#ddd"};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;z-index:200;padding:8px 0}
.vnav button{width:44px;height:44px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:9px;letter-spacing:.04em;background:transparent;color:${d?"#8888a0":"#666"}}
.vnav button.act{background:${B};color:#fff}
.vnav img{width:32px;height:32px;border-radius:6px;cursor:pointer;margin:4px 0}
.main-content{margin-right:54px;padding:14px 12px;max-width:1000px}
@media(min-width:768px){.main-content{margin-right:54px;padding:20px 16px;margin-left:auto;margin-right:calc(54px + auto)}}
`;

/* ====== MAIN APP ====== */
export default function App(){
  const[dark,setDark]=useState(()=>ld("dark",true));
  const[user,setUser]=useState(()=>ld("user",null));
  const[page,setPage]=useState("dashboard");
  const[showSettings,setShowSettings]=useState(false);
  // Shared state from Supabase
  const[users,setUsers]=useState([]);
  const[jobs,setJobs]=useState([]);
  const[timeEntries,setTimeEntries]=useState([]);
  const[reviews,setReviews]=useState([]);
  const[referrals,setReferrals]=useState([]);
  const[schedule,setSchedule]=useState([]);
  const[payHist,setPayHist]=useState([]);
  const[loading,setLoading]=useState(true);

  // Load all data from Supabase
  const loadAll=useCallback(async()=>{
    const[p,j,t,rv,rf,s,ph]=await Promise.all([
      api.get("profiles"),api.get("jobs","select=*&order=id.desc"),
      api.get("time_entries","select=*&order=id.desc"),api.get("reviews"),
      api.get("referrals"),api.get("schedule"),api.get("pay_history","select=*&order=id.desc")
    ]);
    if(Array.isArray(p))setUsers(p);if(Array.isArray(j))setJobs(j);
    if(Array.isArray(t))setTimeEntries(t);if(Array.isArray(rv))setReviews(rv);
    if(Array.isArray(rf))setReferrals(rf);if(Array.isArray(s))setSchedule(s);
    if(Array.isArray(ph))setPayHist(ph);
    setLoading(false);
  },[]);

  useEffect(()=>{if(user)loadAll()},[user,loadAll]);
  // Poll for updates every 15s
  useEffect(()=>{if(!user)return;const iv=setInterval(loadAll,15000);return()=>clearInterval(iv)},[user,loadAll]);
  useEffect(()=>{sv("dark",dark)},[dark]);
  useEffect(()=>{sv("user",user)},[user]);

  if(!user)return<Login setUser={setUser} dark={dark}/>;
  if(loading)return<div style={{minHeight:"100vh",background:dark?DK:LT,display:"flex",alignItems:"center",justifyContent:"center"}}><style>{mkCss(dark)}</style><h2 style={{color:B}}>Loading...</h2></div>;

  if(showSettings)return<div style={{minHeight:"100vh",background:dark?DK:LT}}><style>{mkCss(dark)}</style><Settings user={user} setUser={setUser} users={users} loadAll={loadAll} dark={dark} setDark={setDark} onClose={()=>setShowSettings(false)}/></div>;

  const NAV=[{id:"quests",i:"🎯",l:"Quest"},{id:"payroll",i:"💰",l:"Pay"},{id:"time",i:"⏱",l:"Time"},{id:"_logo_",i:"",l:""},{id:"jobs",i:"📋",l:"Jobs"},{id:"quoteforge",i:"⚡",l:"Quote"},{id:"dashboard",i:"◆",l:"Dash"}];

  return(
    <div style={{minHeight:"100vh",background:dark?DK:LT}}>
      <style>{mkCss(dark)}</style>
      {/* VERTICAL NAV */}
      <div className="vnav">
        {NAV.map((n,i)=>n.id==="_logo_"?<img key={i} src={LOGO} alt="" onClick={()=>setShowSettings(true)} onError={e=>{e.target.style.display="none"}}/>:
          <button key={n.id} className={page===n.id?"act":""} onClick={()=>setPage(n.id)}><span style={{fontSize:16}}>{n.i}</span><span>{n.l}</span></button>
        )}
      </div>
      <div className="main-content">
        {page==="dashboard"&&<Dash user={user} jobs={jobs} timeEntries={timeEntries} quests={{jobs,reviews,referrals}} setPage={setPage} dark={dark}/>}
        {page==="quoteforge"&&<QF user={user} jobs={jobs} setJobs={setJobs} loadAll={loadAll} dark={dark}/>}
        {page==="jobs"&&<JobsPage jobs={jobs} setJobs={setJobs} schedule={schedule} setSchedule={setSchedule} loadAll={loadAll} dark={dark}/>}
        {page==="time"&&<TT user={user} jobs={jobs} timeEntries={timeEntries} setTimeEntries={setTimeEntries} loadAll={loadAll} dark={dark}/>}
        {page==="payroll"&&<Pay user={user} users={users} timeEntries={timeEntries} setTimeEntries={setTimeEntries} payHist={payHist} loadAll={loadAll} dark={dark}/>}
        {page==="quests"&&<Quests user={user} jobs={jobs} reviews={reviews} setReviews={setReviews} referrals={referrals} setReferrals={setReferrals} loadAll={loadAll} dark={dark}/>}
      </div>
    </div>
  );
}

/* ====== LOGIN ====== */
function Login({setUser,dark}){
  const[mode,setMode]=useState("login");
  const[email,setEmail]=useState("");const[pass,setPass]=useState("");const[name,setName]=useState("");const[err,setErr]=useState("");
  const login=async()=>{const res=await api.get("profiles",`email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(pass)}`);if(res&&res.length>0){setUser(res[0]);setErr("")}else setErr("Invalid credentials")};
  const signup=async()=>{if(!email||!pass||!name){setErr("Fill all fields");return}const ex=await api.get("profiles",`email=eq.${encodeURIComponent(email)}`);if(ex&&ex.length>0){setErr("Email exists");return}const num=String(Math.floor(Math.random()*900)+100);const res=await api.post("profiles",{email,password:pass,name,role:"tech",rate:35,start_date:new Date().toISOString().split("T")[0],emp_num:num});if(res&&res.length>0){setUser(res[0])}else setErr("Error creating account")};
  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${DK},#0d1530)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{mkCss(true)}</style>
      <div style={{width:340}}>
        <div style={{textAlign:"center",marginBottom:20}}><img src={LOGO} alt="" style={{height:72,marginBottom:8}} onError={e=>e.target.style.display="none"}/><h1 style={{color:B,fontSize:24}}>Creed Handyman</h1><div style={{color:R,fontSize:11,fontFamily:"'Oswald'",letterSpacing:".15em"}}>LLC</div></div>
        <div className="cd" style={{padding:24,background:"#12121a",border:"1px solid #1e1e2e"}}>
          <h3 style={{textAlign:"center",marginBottom:14,color:"#e2e2e8",fontSize:16}}>{mode==="login"?"Sign In":"Create Account"}</h3>
          {mode==="signup"&&<div style={{marginBottom:8}}><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>}
          <div style={{marginBottom:8}}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>
          <div style={{marginBottom:12}}><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Password" onKeyDown={e=>e.key==="Enter"&&(mode==="login"?login():signup())} style={{background:"#1a1a28",color:"#e2e2e8",border:"1px solid #1e1e2e"}}/></div>
          {err&&<div style={{color:R,fontSize:12,marginBottom:8,textAlign:"center"}}>{err}</div>}
          <button className="bb" onClick={mode==="login"?login:signup} style={{width:"100%",padding:11,fontSize:15}}>{mode==="login"?"Sign In":"Sign Up"}</button>
          <div style={{textAlign:"center",marginTop:12,fontSize:12,color:"#8888a0"}}>{mode==="login"?"No account? ":"Have account? "}<span onClick={()=>{setMode(mode==="login"?"signup":"login");setErr("")}} style={{color:B,cursor:"pointer",textDecoration:"underline"}}>{mode==="login"?"Sign Up":"Sign In"}</span></div>
        </div>
        <div style={{textAlign:"center",marginTop:14,color:"#8888a0",fontSize:10}}>Lic #6145054 · Wichita, KS · (316) 252-6335</div>
      </div>
    </div>
  );
}

/* ====== SETTINGS ====== */
function Settings({user,setUser,users,loadAll,dark,setDark,onClose}){
  const[tab,setTab]=useState("account");const[np,setNp]=useState("");
  const changePass=async()=>{if(!np||np.length<6){alert("Min 6 chars");return}await api.patch("profiles",user.id,{password:np});setUser({...user,password:np});setNp("");alert("Updated")};
  const updateRate=async(uid,rate)=>{await api.patch("profiles",uid,{rate:parseFloat(rate)||0});loadAll()};
  const isOwner=user.role==="owner"||user.role==="manager";
  return(
    <div className="fi" style={{maxWidth:500,margin:"0 auto",padding:"16px 12px"}}>
      <div className="row mb"><button className="bo" onClick={onClose}>← Back</button><h2 style={{fontSize:20,color:B}}>Settings</h2></div>
      <div style={{display:"flex",gap:4,marginBottom:14}}>{["account","employees","general"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:tab===t?B:"transparent",color:tab===t?"#fff":dark?"#8888a0":"#666",fontFamily:"'Oswald'"}}>{t}</button>)}</div>
      {tab==="account"&&<div>
        <div className="cd mb">{[["Name",user.name],["Email",user.email],["Role",user.role],["#",user.emp_num||"—"],["Rate","$"+(user.rate||55)+"/hr"],["Start",user.start_date||"—"]].map(([l,v],i)=><div key={i} className="sep" style={{fontSize:13}}><span style={{color:dark?"#8888a0":"#888"}}>{l}:</span> {v}</div>)}</div>
        <div className="cd mb"><h4 style={{marginBottom:8,fontSize:14}}>Change Password</h4><div className="row"><input type="password" value={np} onChange={e=>setNp(e.target.value)} placeholder="New password"/><button className="bb" onClick={changePass}>Update</button></div></div>
        <div className="cd"><button className="br" onClick={()=>{setUser(null);onClose()}} style={{width:"100%"}}>Sign Out</button></div>
      </div>}
      {tab==="employees"&&<div className="cd">
        <h4 style={{marginBottom:8,fontSize:14}}>Team ({users.length})</h4>
        {users.map(u=><div key={u.id} className="sep" style={{fontSize:13}}>
          <div className="row" style={{justifyContent:"space-between"}}>
            <div><b>{u.name}</b> <span style={{color:dark?"#8888a0":"#888"}}>({u.role}) #{u.emp_num}</span></div>
            {isOwner?<div className="row"><span>$</span><input type="number" defaultValue={u.rate} style={{width:55,padding:"2px 4px",fontSize:12}} onBlur={e=>updateRate(u.id,e.target.value)}/><span style={{fontSize:11}}>/hr</span></div>
            :<span>${u.id===user.id?user.rate:"—"}/hr</span>}
          </div>
        </div>)}
      </div>}
      {tab==="general"&&<div>
        <div className="cd mb"><h4 style={{marginBottom:8,fontSize:14}}>Appearance</h4>
          <div className="sep row" style={{justifyContent:"space-between"}}><span>Dark Mode</span>
            <div onClick={()=>setDark(!dark)} style={{width:44,height:24,borderRadius:12,background:dark?B:"#ccc",position:"relative",cursor:"pointer"}}><div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:dark?23:3,transition:".3s"}}/></div>
          </div>
        </div>
      </div>}
    </div>
  );
}

/* ====== DASHBOARD ====== */
function Dash({user,jobs,timeEntries,quests,setPage,dark}){
  const complete=jobs.filter(j=>j.status==="complete");
  const rev=complete.reduce((s,j)=>s+(j.total||0),0);
  const active=jobs.filter(j=>j.status==="active").length;
  const quoted=jobs.filter(j=>j.status==="quoted").length;
  const hrs=timeEntries.filter(e=>e.user_id===user.id||!e.user_id).reduce((s,e)=>s+(e.hours||0),0);
  const completedCount=complete.length;
  const fiveStars=quests.reviews.filter(r=>r.rating===5).length;
  const converted=quests.referrals.filter(r=>r.status==="converted").length;
  const qList=[{t:"Complete 5 jobs",p:Math.min(completedCount,5),g:5},{t:"Get 3 five-star reviews",p:Math.min(fiveStars,3),g:3},{t:"Earn 5 referrals",p:Math.min(converted,5),g:5}];
  return(
    <div className="fi">
      <h2 style={{fontSize:22,color:B,marginBottom:14}}>Welcome, {user.name}</h2>
      <div className="g4 mb">
        {[{l:"Active",v:active,c:B},{l:"Quoted",v:quoted,c:O},{l:"Net Earned",v:"$"+rev.toLocaleString(),c:G},{l:"My Hours",v:hrs.toFixed(1),c:Y}].map((s,i)=><div key={i} className="cd" style={{borderLeft:`3px solid ${s.c}`}}><div className="sl">{s.l}</div><div className="sv" style={{color:s.c}}>{s.v}</div></div>)}
      </div>
      <div className="g2">
        <div className="cd" style={{cursor:"pointer"}} onClick={()=>setPage("quoteforge")}><h3 style={{color:B,fontSize:15,marginBottom:4}}>⚡ QuoteForge</h3><p style={{color:dark?"#8888a0":"#888",fontSize:12}}>Parse PDFs or build quotes</p><button className="bb mt" style={{fontSize:11,padding:"6px 14px"}}>Launch →</button></div>
        <div className="cd"><h3 style={{color:O,fontSize:15,marginBottom:4}}>🎯 Quests</h3>{qList.map((q,i)=><div key={i} style={{marginTop:6}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span>{q.t}</span><span style={{color:B}}>{q.p}/{q.g}</span></div><div style={{height:3,background:dark?"#1e1e2e":"#eee",borderRadius:2,marginTop:2}}><div style={{height:3,background:q.p>=q.g?G:B,borderRadius:2,width:`${Math.min(100,q.p/q.g*100)}%`}}/></div></div>)}</div>
      </div>
      {jobs.length>0&&<div className="cd mt"><h4 style={{fontSize:14,marginBottom:8}}>Pipeline</h4>{jobs.slice(0,8).map(j=><div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span style={{flex:1}}>{j.property}</span><span style={{color:dark?"#8888a0":"#888",width:60}}>{j.status}</span><span style={{color:j.status==="complete"?G:O,fontFamily:"'Oswald'",width:70,textAlign:"right"}}>${(j.total||0).toFixed(0)}</span></div>)}</div>}
    </div>
  );
}

/* ====== QUOTEFORGE ====== */
function QF({user,jobs,setJobs,loadAll,dark}){
  const[mode,setMode]=useState(null);const[text,setText]=useState("");const[prop,setProp]=useState("");const[client,setClient]=useState("");
  const[rooms,setRooms]=useState([]);const[tab,setTab]=useState("quote");
  const[nr,setNr]=useState("");const[nd,setNd]=useState("");const[nc,setNc]=useState("");const[nh,setNh]=useState("1");const[nm,setNm]=useState("20");
  const[parsing,setParsing]=useState(false);
  const fileRef=useRef();const rate=user.rate||55;

  const doParse=()=>{if(!text.trim())return;const p=parseZI(text);if(!p.length){alert("No items found");return}const pm=text.match(/([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way|Circle|Place))/i);if(pm&&!prop)setProp(pm[1].trim());setRooms(p);setMode("editing")};

  const handleFile=async e=>{const f=e.target.files[0];if(!f)return;setParsing(true);try{
    if(f.name.endsWith(".pdf")){const t=await readPdf(f);setText(t);setParsing(false);setMode("paste")}
    else if(f.name.endsWith(".txt")){const t=await f.text();setText(t);setParsing(false);setMode("paste")}
    else{alert("Upload PDF or TXT");setParsing(false)}
  }catch(err){console.error(err);alert("Error reading file. Try pasting text instead.");setParsing(false);setMode("paste")}};

  const addItem=()=>{if(!nr||!nd)return;const it={id:crypto.randomUUID().slice(0,8),detail:nd,condition:"-",comment:nc||"Per scope",laborHrs:parseFloat(nh)||1,materials:[{n:"Materials",c:parseFloat(nm)||0}]};const ex=rooms.find(r=>r.name===nr);if(ex)setRooms(rooms.map(r=>r.name===nr?{...r,items:[...r.items,it]}:r));else setRooms([...rooms,{name:nr,items:[it]}]);setNd("");setNc("");setNh("1");setNm("20");if(mode!=="editing")setMode("editing")};
  const rmItem=(rn,id)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.filter(i=>i.id!==id)}:r).filter(r=>r.items.length>0));
  const upItem=(rn,id,f,v)=>setRooms(rooms.map(r=>r.name===rn?{...r,items:r.items.map(i=>i.id===id?{...i,[f]:v}:i)}:r));

  const all=rooms.flatMap(r=>r.items.map(i=>({room:r.name,...i,...calc(i,rate)})));
  const gt=all.reduce((s,i)=>s+i.tot,0),tl=all.reduce((s,i)=>s+i.lc,0),tm=all.reduce((s,i)=>s+i.mc,0),th=all.reduce((s,i)=>s+i.laborHrs,0);
  const issues=classify(rooms),guide=mkGuide(rooms);

  const saveJob=async()=>{if(!prop){alert("Enter address");return}
    await api.post("jobs",{property:prop,client:client||"",job_date:new Date().toISOString().split("T")[0],rooms:JSON.stringify(rooms),total:gt,total_labor:tl,total_mat:tm,total_hrs:th,status:"quoted",created_by:user.name});
    alert("Job created: "+prop);await loadAll();setMode(null);setRooms([]);setText("");setProp("");setClient("")};

  if(!mode)return(
    <div className="fi">
      <h2 style={{fontSize:22,color:B,marginBottom:14}}>⚡ QuoteForge</h2>
      {parsing&&<div className="cd mb" style={{textAlign:"center",padding:20}}><h4 style={{color:B}}>Reading PDF...</h4></div>}
      <div className="g3">
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:20}} onClick={()=>setMode("paste")}><div style={{fontSize:32,marginBottom:4}}>📄</div><h4 style={{color:B,fontSize:13}}>Paste Text</h4></div>
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:20}} onClick={()=>fileRef.current?.click()}><div style={{fontSize:32,marginBottom:4}}>📁</div><h4 style={{color:O,fontSize:13}}>Upload PDF</h4><input ref={fileRef} type="file" accept=".pdf,.txt" style={{display:"none"}} onChange={handleFile}/></div>
        <div className="cd" style={{cursor:"pointer",textAlign:"center",padding:20}} onClick={()=>setMode("manual")}><div style={{fontSize:32,marginBottom:4}}>✏️</div><h4 style={{color:G,fontSize:13}}>Manual</h4></div>
      </div>
      {jobs.length>0&&<div className="cd mt"><div className="sl mb">{jobs.length} jobs · ${jobs.reduce((s,j)=>s+(j.total||0),0).toFixed(0)} total</div>{jobs.slice(0,5).map(j=><div key={j.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{j.property}</span><span style={{color:G,fontFamily:"'Oswald'"}}>${(j.total||0).toFixed(0)}</span></div>)}</div>}
    </div>
  );

  if(mode==="paste")return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>←</button><h2 style={{fontSize:18,color:B}}>Parse Report</h2></div>
      <div className="cd"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste report text or upload PDF above..." style={{height:200,fontFamily:"monospace",fontSize:11}}/>
      <div className="g2 mt"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property address"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div>
      <div className="row mt"><button className="bb" onClick={doParse}>Parse →</button><button className="bo" onClick={()=>fileRef.current?.click()}>Upload PDF</button><input ref={fileRef} type="file" accept=".pdf,.txt" style={{display:"none"}} onChange={handleFile}/></div></div>
    </div>
  );

  if(mode==="manual"&&!rooms.length)return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>setMode(null)}>←</button><h2 style={{fontSize:18,color:O}}>Manual Quote</h2></div>
      <div className="cd mb"><div className="g2"><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *"/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client"/></div></div>
      <div className="cd"><div className="g2 mb"><input value={nr} onChange={e=>setNr(e.target.value)} placeholder="Room"/><input value={nd} onChange={e=>setNd(e.target.value)} placeholder="Item"/></div><input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Description" style={{marginBottom:8}}/><div className="g2"><div><label style={{fontSize:10}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step=".25"/></div><div><label style={{fontSize:10}}>Mat $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div><button className="bg mt" onClick={addItem}>Add</button></div>
    </div>
  );

  // EDITING VIEW
  return(
    <div className="fi">
      <div className="row mb"><button className="bo" onClick={()=>{setMode(null);setRooms([])}}>←</button><h2 style={{fontSize:18,color:B}}>⚡ Quote</h2><span style={{fontSize:10,color:dark?"#8888a0":"#888",fontFamily:"'Oswald'"}}>${rate}/hr</span></div>
      <div className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={{flex:"1 1 160px"}}><input value={prop} onChange={e=>setProp(e.target.value)} placeholder="Property *" style={{marginBottom:4,fontSize:13}}/><input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client" style={{fontSize:13}}/></div>
        <div style={{textAlign:"right"}}><div className="sl">Total</div><div style={{fontSize:28,fontFamily:"'Oswald'",fontWeight:700,color:G}}>${gt.toFixed(2)}</div></div>
      </div>
      <div className="g4 mb">{[{l:"Labor",v:"$"+tl.toFixed(0),s:th.toFixed(1)+"h",c:B},{l:"Materials",v:"$"+tm.toFixed(0),c:O},{l:"Items",v:all.length,c:R},{l:"Est Days",v:(th/8).toFixed(1),c:Y}].map((x,i)=><div key={i} className="cd" style={{textAlign:"center",padding:8}}><div className="sl">{x.l}</div><div style={{fontSize:16,fontFamily:"'Oswald'",color:x.c}}>{x.v}</div>{x.s&&<div style={{fontSize:9,color:dark?"#8888a0":"#888"}}>{x.s}</div>}</div>)}</div>

      <div style={{display:"flex",gap:3,marginBottom:12,flexWrap:"wrap"}}>
        {[{id:"quote",l:"📄Quote"},{id:"guide",l:"🔧Guide"},{id:"issues",l:"⚠️Issues"},{id:"add",l:"➕Add"}].map(x=><button key={x.id} onClick={()=>setTab(x.id)} style={{padding:"5px 12px",background:tab===x.id?B:dark?"#12121a":"#fff",color:tab===x.id?"#fff":dark?"#8888a0":"#666",border:`1px solid ${tab===x.id?B:dark?"#1e1e2e":"#ddd"}`,borderRadius:"6px 6px 0 0",fontFamily:"'Oswald'",fontSize:11}}>{x.l}</button>)}
        <div style={{flex:1}}/><button className="bb" onClick={saveJob} style={{fontSize:11,padding:"5px 14px"}}>Save Job</button>
      </div>

      {tab==="quote"&&rooms.map(room=><div key={room.name} style={{marginBottom:12}}><h4 style={{color:B,fontSize:13,marginBottom:4,borderBottom:`1px solid ${dark?"#1e1e2e":"#eee"}`,paddingBottom:3}}>{room.name}</h4>
        {room.items.map(it=>{const{lc,mc,tot}=calc(it,rate);return<div key={it.id} className="cd" style={{marginBottom:4,padding:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 180px"}}><div className="row"><b style={{fontSize:12}}>{it.detail}</b><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:it.condition==="D"?R+"33":it.condition==="P"?O+"33":it.condition==="F"?Y+"33":G+"33",color:it.condition==="D"?R:it.condition==="P"?O:it.condition==="F"?Y:G}}>{it.condition==="D"?"DMG":it.condition==="P"?"POOR":it.condition==="F"?"FAIR":"OK"}</span></div><div style={{fontSize:11,color:dark?"#8888a0":"#888",marginTop:2}}>{it.comment}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:8,color:dark?"#8888a0":"#888"}}>HRS</div><input type="number" value={it.laborHrs} step=".25" min="0" onChange={e=>upItem(room.name,it.id,"laborHrs",parseFloat(e.target.value)||0)} style={{width:45,textAlign:"center",padding:"2px",fontSize:11}}/></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:8,color:dark?"#8888a0":"#888"}}>MAT</div><input type="number" value={it.materials.reduce((s,m)=>s+(m.c||m.cost||0),0)} step="1" min="0" onChange={e=>upItem(room.name,it.id,"materials",[{n:"Mat",c:parseFloat(e.target.value)||0}])} style={{width:50,textAlign:"center",padding:"2px",fontSize:11}}/></div>
              <div style={{textAlign:"right",minWidth:50}}><div style={{fontSize:8,color:dark?"#8888a0":"#888"}}>TOT</div><div style={{fontSize:13,fontFamily:"'Oswald'",color:G}}>${tot.toFixed(0)}</div></div>
              <button onClick={()=>rmItem(room.name,it.id)} style={{background:"none",color:R,fontSize:13,padding:1}}>✕</button>
            </div>
          </div>
        </div>})}
      </div>)}

      {tab==="guide"&&<div>
        <div className="g2 mb">
          <div className="cd"><h4 style={{color:B,fontSize:13,marginBottom:6}}>🧰 Tools ({guide.tools.length})</h4>{guide.tools.map((t,i)=><div key={i} style={{fontSize:12,padding:"3px 0",borderBottom:`1px solid ${dark?"#1e1e2e":"#eee"}`}}>☐ {t}</div>)}</div>
          <div className="cd"><h4 style={{color:O,fontSize:13,marginBottom:6}}>🛒 Shopping (${guide.shop.reduce((s,i)=>s+(i.c||i.cost||0),0).toFixed(0)})</h4><div style={{maxHeight:300,overflowY:"auto"}}>{guide.shop.map((s,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0",borderBottom:`1px solid ${dark?"#1e1e2e":"#eee"}`}}><span>{s.n||s.name} <span style={{color:dark?"#8888a0":"#888"}}>({s.room})</span></span><span style={{color:G}}>${s.c||s.cost}</span></div>)}</div></div>
        </div>
        <div className="cd"><h4 style={{color:G,fontSize:13,marginBottom:6}}>📋 Work Order ({guide.steps.length} tasks · {th.toFixed(1)}h)</h4>
          {guide.steps.map((s,i)=><div key={i} style={{padding:"5px 0",borderBottom:`1px solid ${dark?"#1e1e2e":"#eee"}`,fontSize:12}}>
            <div className="row"><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:s.pri==="HIGH"?R+"33":s.pri==="MED"?O+"33":G+"33",color:s.pri==="HIGH"?R:s.pri==="MED"?O:G}}>{s.pri}</span><b style={{color:B}}>{s.room}</b><span>→ {s.detail}</span><span style={{color:dark?"#8888a0":"#888",fontSize:10}}>({s.hrs}h)</span></div>
            <div style={{color:dark?"#8888a0":"#888",fontSize:11,marginTop:1,paddingLeft:4}}>{s.action}</div>
          </div>)}
        </div>
      </div>}

      {tab==="issues"&&[{t:"🚨 Critical",it:issues.critical,c:R},{t:"⚠️ Important",it:issues.important,c:O},{t:"💡 Minor",it:issues.minor,c:Y}].map((s,i)=><div key={i} className="cd mb" style={{borderLeft:`3px solid ${s.c}`}}><h4 style={{color:s.c,fontSize:13,marginBottom:4}}>{s.t} ({s.it.length})</h4>{!s.it.length?<span style={{fontSize:11,color:dark?"#8888a0":"#888"}}>None</span>:s.it.map((x,j)=><div key={j} style={{fontSize:12,padding:"3px 0",borderBottom:`1px solid ${dark?"#1e1e2e":"#eee"}`}}><b>{x.room}</b> — {x.detail}: {x.comment}</div>)}</div>)}

      {tab==="add"&&<div className="cd"><div className="g2 mb"><div><label style={{fontSize:10}}>Room</label><input value={nr} onChange={e=>setNr(e.target.value)} list="rl"/><datalist id="rl">{rooms.map(r=><option key={r.name} value={r.name}/>)}</datalist></div><div><label style={{fontSize:10}}>Item</label><input value={nd} onChange={e=>setNd(e.target.value)}/></div></div><div style={{marginBottom:8}}><label style={{fontSize:10}}>Description</label><input value={nc} onChange={e=>setNc(e.target.value)}/></div><div className="g2 mb"><div><label style={{fontSize:10}}>Hours</label><input type="number" value={nh} onChange={e=>setNh(e.target.value)} min="0" step=".25"/></div><div><label style={{fontSize:10}}>Mat $</label><input type="number" value={nm} onChange={e=>setNm(e.target.value)} min="0"/></div></div><button className="bg" onClick={addItem}>Add</button></div>}
    </div>
  );
}

/* ====== JOBS ====== */
function JobsPage({jobs,setJobs,schedule,setSchedule,loadAll,dark}){
  const[view,setView]=useState("list");const[open,setOpen]=useState(null);
  const[rn,setRn]=useState("");const[ra,setRa]=useState("");
  const[np,setNp]=useState("");const[nc,setNc]=useState("");
  const[sd,setSd]=useState("");const[sj,setSj]=useState("");const[sn,setSn]=useState("");

  const addReceipt=async(jobId)=>{if(!rn||!ra)return;await api.post("receipts",{job_id:jobId,note:rn,amount:parseFloat(ra),receipt_date:new Date().toLocaleDateString()});setRn("");setRa("");loadAll()};
  const setSt=async(id,s)=>{await api.patch("jobs",id,{status:s});loadAll()};
  const del=async(id)=>{if(!confirm("Delete?"))return;await api.del("jobs",id);loadAll()};
  const createJob=async()=>{if(!np)return;await api.post("jobs",{property:np,client:nc,job_date:new Date().toISOString().split("T")[0],status:"active",created_by:"manual"});setNp("");setNc("");loadAll()};
  const addSched=async()=>{if(!sd||!sj)return;await api.post("schedule",{sched_date:sd,job:sj,note:sn});setSd("");setSj("");setSn("");loadAll()};

  const today=new Date();const ws=new Date(today);ws.setDate(today.getDate()-today.getDay());
  const week=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return d});
  const dn=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Get receipts for a job
  const getReceipts=(jobId)=>{ /* receipts are separate table - we'll fetch inline */ return []};

  return(
    <div className="fi">
      <div className="row mb"><h2 style={{fontSize:22,color:B}}>📋 Jobs</h2><div style={{flex:1}}/>
        {["list","schedule","create"].map(v=><button key={v} onClick={()=>setView(v)} style={{padding:"4px 10px",borderRadius:6,fontSize:10,background:view===v?B:"transparent",color:view===v?"#fff":dark?"#8888a0":"#666",fontFamily:"'Oswald'"}}>{v}</button>)}
      </div>

      {view==="list"&&<div>{!jobs.length?<div className="cd" style={{textAlign:"center",padding:24,color:dark?"#8888a0":"#888"}}>No jobs yet</div>:
        jobs.map(j=><div key={j.id} className="cd mb">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",flexWrap:"wrap",gap:6}} onClick={()=>setOpen(open===j.id?null:j.id)}>
            <div><h4 style={{fontSize:14}}>{j.property}</h4><div style={{fontSize:11,color:dark?"#8888a0":"#888"}}>{j.client} · {j.job_date}</div></div>
            <div className="row">
              <div style={{textAlign:"right"}}><div style={{fontSize:18,fontFamily:"'Oswald'",color:G}}>${(j.total||0).toFixed(0)}</div></div>
              <select value={j.status||"quoted"} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setSt(j.id,e.target.value)}} style={{fontSize:10,padding:"2px 6px",width:"auto",background:j.status==="complete"?G+"22":j.status==="active"?B+"22":O+"22"}}><option value="quoted">Quoted</option><option value="active">Active</option><option value="complete">Complete</option></select>
            </div>
          </div>
          {open===j.id&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${dark?"#1e1e2e":"#eee"}`}}>
            <div className="row mt"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Receipt note" style={{flex:1}}/><input type="number" value={ra} onChange={e=>setRa(e.target.value)} placeholder="$" style={{width:60}}/><button className="bb" onClick={e=>{e.stopPropagation();addReceipt(j.id)}} style={{fontSize:10,padding:"5px 10px"}}>Add</button></div>
            <button className="br mt" onClick={e=>{e.stopPropagation();del(j.id)}} style={{fontSize:9,padding:"4px 8px"}}>Delete</button>
          </div>}
        </div>)
      }</div>}

      {view==="schedule"&&<div>
        <div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Schedule Job</h4><div className="row"><input type="date" value={sd} onChange={e=>setSd(e.target.value)} style={{width:130}}/><select value={sj} onChange={e=>setSj(e.target.value)} style={{flex:1}}><option value="">Select job</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><input value={sn} onChange={e=>setSn(e.target.value)} placeholder="Notes" style={{flex:1}}/><button className="bg" onClick={addSched} style={{fontSize:10,padding:"5px 10px"}}>Add</button></div></div>
        <div className="cd" id="schedule-view"><h4 style={{fontSize:13,marginBottom:8}}>This Week</h4>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
            {week.map((d,i)=>{const ds=d.toISOString().split("T")[0];const items=schedule.filter(s=>s.sched_date===ds);const isT=ds===today.toISOString().split("T")[0];
              return<div key={i} style={{background:isT?B+"22":dark?"#12121a":"#fff",border:`1px solid ${isT?B:dark?"#1e1e2e":"#ddd"}`,borderRadius:6,padding:4,minHeight:70}}>
                <div style={{fontSize:9,fontFamily:"'Oswald'",color:isT?B:dark?"#8888a0":"#888",textAlign:"center"}}>{dn[i]}</div>
                <div style={{fontSize:11,textAlign:"center",fontWeight:600,marginBottom:3}}>{d.getDate()}</div>
                {items.map(s=><div key={s.id} style={{fontSize:8,background:B+"22",borderRadius:2,padding:"1px 3px",marginBottom:1,color:B}}>{s.job}</div>)}
              </div>})}
          </div>
          <button className="bo mt" onClick={()=>window.print()} style={{fontSize:10}}>Print Schedule</button>
        </div>
      </div>}

      {view==="create"&&<div className="cd"><h4 style={{fontSize:13,marginBottom:8}}>Create Job</h4><div className="g2 mb"><input value={np} onChange={e=>setNp(e.target.value)} placeholder="Property *"/><input value={nc} onChange={e=>setNc(e.target.value)} placeholder="Client"/></div><button className="bg" onClick={createJob}>Create</button></div>}
    </div>
  );
}

/* ====== TIME TRACKER ====== */
function TT({user,jobs,timeEntries,setTimeEntries,loadAll,dark}){
  const[on,setOn]=useState(()=>ld("t_on",false));
  const[st,setSt]=useState(()=>ld("t_st",null));
  const[sj,setSj]=useState(()=>ld("t_sj",""));
  const[el,setEl]=useState(0);
  const[mh,setMh]=useState("");const[mj,setMj]=useState("");
  const rate=user.rate||55;

  useEffect(()=>{sv("t_on",on)},[on]);useEffect(()=>{sv("t_st",st)},[st]);useEffect(()=>{sv("t_sj",sj)},[sj]);
  useEffect(()=>{let iv;if(on&&st)iv=setInterval(()=>setEl(Date.now()-st),1000);return()=>clearInterval(iv)},[on,st]);

  const fmt=ms=>{const s=Math.floor(ms/1000);return`${Math.floor(s/3600).toString().padStart(2,"0")}:${Math.floor((s%3600)/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`};

  const start=()=>{setSt(Date.now());setOn(true)};
  const stop=async()=>{
    const hrs=Math.round(el/3600000*100)/100;
    if(hrs>=0.01){
      const entry={job:sj||"General",entry_date:new Date().toLocaleDateString(),hours:hrs,amount:Math.round(hrs*rate*100)/100,user_id:user.id,user_name:user.name};
      await api.post("time_entries",entry);
      await loadAll();
    }
    setOn(false);setSt(null);setEl(0);
  };
  const addManual=async()=>{const h=parseFloat(mh);if(!h||h<=0)return;
    await api.post("time_entries",{job:mj||"General",entry_date:new Date().toLocaleDateString(),hours:h,amount:Math.round(h*rate*100)/100,user_id:user.id,user_name:user.name});
    setMh("");setMj("");loadAll()};
  const delEntry=async(id)=>{await api.del("time_entries",id);loadAll()};
  const editHrs=async(id,hrs)=>{await api.patch("time_entries",id,{hours:hrs,amount:Math.round(hrs*rate*100)/100});loadAll()};

  const myEntries=timeEntries.filter(e=>e.user_id===user.id||(!e.user_id&&e.user_name===user.name));

  return(
    <div className="fi">
      <h2 style={{fontSize:22,color:B,marginBottom:14}}>⏱ Time Tracker</h2>
      <div className="cd mb" style={{textAlign:"center",padding:20}}>
        <div style={{fontSize:48,fontFamily:"'Oswald'",fontWeight:700,color:on?G:dark?"#8888a0":"#ccc"}}>{fmt(el)}</div>
        <select value={sj} onChange={e=>setSj(e.target.value)} style={{maxWidth:300,margin:"10px auto",display:"block"}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select>
        {!on?<button className="bb" onClick={start} style={{fontSize:15,padding:"10px 32px"}}>▶ Start</button>:<button className="br" onClick={stop} style={{fontSize:15,padding:"10px 32px"}}>⏹ Stop & Log</button>}
        {on&&<div style={{marginTop:6,fontSize:11,color:G}}>Running — persists across pages</div>}
      </div>
      <div className="cd mb"><h4 style={{fontSize:13,marginBottom:6}}>Manual Entry</h4><div className="row"><select value={mj} onChange={e=>setMj(e.target.value)} style={{flex:1}}><option value="">General</option>{jobs.map(j=><option key={j.id} value={j.property}>{j.property}</option>)}</select><input type="number" value={mh} onChange={e=>setMh(e.target.value)} placeholder="Hrs" step=".25" min="0" style={{width:70}}/><button className="bg" onClick={addManual} style={{fontSize:11,padding:"7px 12px"}}>Log</button></div></div>
      <div className="cd"><h4 style={{fontSize:13,marginBottom:6}}>My Log ({myEntries.length})</h4>
        {!myEntries.length?<p style={{color:dark?"#8888a0":"#888",fontSize:12}}>No entries</p>:
        myEntries.map(e=><div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12,alignItems:"center",gap:4}}>
          <span style={{minWidth:65}}>{e.entry_date}</span><span style={{color:B,flex:1}}>{e.job}</span>
          <input type="number" defaultValue={e.hours} step=".25" min="0" style={{width:45,textAlign:"center",padding:"2px",fontSize:11}} onBlur={ev=>editHrs(e.id,parseFloat(ev.target.value)||0)}/>
          <span style={{color:G,minWidth:50,textAlign:"right"}}>${(e.amount||0).toFixed(2)}</span>
          <button onClick={()=>delEntry(e.id)} style={{background:"none",color:R,fontSize:12}}>✕</button>
        </div>)}
      </div>
    </div>
  );
}

/* ====== PAYROLL ====== */
function Pay({user,users,timeEntries,setTimeEntries,payHist,loadAll,dark}){
  const isOwner=user.role==="owner"||user.role==="manager";
  const[sel,setSel]=useState(user.id);
  const selU=users.find(u=>u.id===sel)||user;
  const entries=timeEntries.filter(e=>e.user_id===sel||(sel===user.id&&!e.user_id&&e.user_name===user.name));
  const th=entries.reduce((s,e)=>s+(e.hours||0),0);
  const tp=th*(selU.rate||55);
  const byJob={};entries.forEach(e=>{byJob[e.job||"General"]=(byJob[e.job||"General"]||0)+(e.hours||0)});

  const processPay=async()=>{if(!entries.length)return;
    await api.post("pay_history",{user_id:sel,name:selU.name,pay_date:new Date().toLocaleDateString(),hours:th,amount:tp,entries:entries.length});
    alert(`Processed: ${selU.name} — $${tp.toFixed(2)}`);loadAll()};

  return(
    <div className="fi">
      <h2 style={{fontSize:22,color:B,marginBottom:14}}>💰 Payroll</h2>
      {isOwner&&<div className="cd mb"><div className="row"><label style={{fontSize:11}}>Employee:</label><select value={sel} onChange={e=>setSel(e.target.value)} style={{flex:1}}>{users.map(u=><option key={u.id} value={u.id}>{u.name} (${u.rate}/hr)</option>)}</select></div></div>}
      <div className="g3 mb">
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Hours</div><div className="sv" style={{color:B}}>{th.toFixed(1)}</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Rate</div><div className="sv">${selU.rate||55}/hr</div></div>
        <div className="cd" style={{textAlign:"center"}}><div className="sl">Total</div><div className="sv" style={{color:G}}>${tp.toFixed(2)}</div></div>
      </div>
      <div className="cd mb"><div className="row"><h4 style={{fontSize:13}}>By Job</h4><div style={{flex:1}}/>{isOwner&&<button className="bg" onClick={processPay} style={{fontSize:10,padding:"5px 12px"}}>Process Pay</button>}</div>
        {Object.entries(byJob).map(([j,h])=><div key={j} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{j}</span><span>{h.toFixed(1)}h → <span style={{color:G}}>${(h*(selU.rate||55)).toFixed(2)}</span></span></div>)}
      </div>
      {payHist.filter(p=>p.user_id===sel).length>0&&<div className="cd mb"><h4 style={{fontSize:13,marginBottom:6}}>Payment History</h4>
        {payHist.filter(p=>p.user_id===sel).map(p=><div key={p.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>{p.pay_date}</span><span>{(p.hours||0).toFixed(1)}h</span><span style={{color:G}}>${(p.amount||0).toFixed(2)}</span></div>)}
      </div>}
      <div className="cd"><h4 style={{fontSize:13,marginBottom:6}}>Entries (editable)</h4>
        {entries.map(e=><div key={e.id} className="sep" style={{display:"flex",justifyContent:"space-between",fontSize:11,alignItems:"center",gap:4}}>
          <span>{e.entry_date}</span><span style={{color:B,flex:1}}>{e.job}</span>
          <input type="number" defaultValue={e.hours} step=".25" min="0" style={{width:45,textAlign:"center",padding:"2px",fontSize:10}} onBlur={async ev=>{const h=parseFloat(ev.target.value)||0;await api.patch("time_entries",e.id,{hours:h,amount:Math.round(h*(selU.rate||55)*100)/100});loadAll()}}/>
          <span style={{color:G}}>${((e.hours||0)*(selU.rate||55)).toFixed(2)}</span>
          {isOwner&&<button onClick={async()=>{await api.del("time_entries",e.id);loadAll()}} style={{background:"none",color:R,fontSize:11}}>✕</button>}
        </div>)}
      </div>
    </div>
  );
}

/* ====== QUESTS (Reviews + Referrals) ====== */
function Quests({user,jobs,reviews,setReviews,referrals,setReferrals,loadAll,dark}){
  const[tab,setTab]=useState("quests");
  const[rn,setRn]=useState("");const[rt,setRt]=useState("");const[rr,setRr]=useState(5);
  const[fn,setFn]=useState("");const[fs,setFs]=useState("");

  const completed=jobs.filter(j=>j.status==="complete").length;
  const fiveStars=reviews.filter(r=>r.rating===5).length;
  const converted=referrals.filter(r=>r.status==="converted").length;
  const qList=[{t:"Complete 5 jobs",p:Math.min(completed,5),g:5,xp:100,type:"completed"},{t:"Get 3 five-star reviews",p:Math.min(fiveStars,3),g:3,xp:75,type:"5★ reviews"},{t:"Earn 5 referrals",p:Math.min(converted,5),g:5,xp:50,type:"converted"}];
  const xp=qList.reduce((s,q)=>s+(q.p>=q.g?q.xp:0),0);

  const addReview=async()=>{if(!rn||!rt)return;await api.post("reviews",{client_name:rn,review_text:rt,rating:rr});setRn("");setRt("");setRr(5);loadAll()};
  const addRef=async()=>{if(!fn)return;await api.post("referrals",{name:fn,source:fs,status:"pending",ref_date:new Date().toLocaleDateString()});setFn("");setFs("");loadAll()};
  const updateRefStatus=async(id,s)=>{await api.patch("referrals",id,{status:s});loadAll()};

  return(
    <div className="fi">
      <h2 style={{fontSize:22,color:B,marginBottom:14}}>🎯 Quest Hub</h2>
      <div style={{display:"flex",gap:3,marginBottom:12}}>{["quests","reviews","referrals"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"5px 12px",borderRadius:6,fontSize:11,background:tab===t?B:"transparent",color:tab===t?"#fff":dark?"#8888a0":"#666",fontFamily:"'Oswald'"}}>{t==="quests"?"🎯Quests":t==="reviews"?"⭐Reviews":"🤝Referrals"}</button>)}</div>

      {tab==="quests"&&<div>
        <div className="cd mb" style={{textAlign:"center",padding:16}}><div className="sl">XP Earned</div><div style={{fontSize:38,fontFamily:"'Oswald'",fontWeight:700,color:O}}>{xp}</div></div>
        {qList.map((q,i)=>{const d=q.p>=q.g;return<div key={i} className="cd mb" style={{borderLeft:`3px solid ${d?G:B}`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,fontWeight:600}}>{d?"✅":"⏳"} {q.t}</span><span style={{fontFamily:"'Oswald'",color:O,fontSize:12}}>+{q.xp}XP</span></div>
          <div style={{height:6,background:dark?"#1e1e2e":"#eee",borderRadius:3}}><div style={{height:6,background:d?G:B,borderRadius:3,width:`${Math.min(100,q.p/q.g*100)}%`,transition:".5s"}}/></div>
          <div style={{fontSize:10,color:dark?"#8888a0":"#888",marginTop:2,textAlign:"right"}}>{q.p}/{q.g} {q.type}</div>
        </div>})}
      </div>}

      {tab==="reviews"&&<div>
        <div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Add Review</h4><div className="row mb"><input value={rn} onChange={e=>setRn(e.target.value)} placeholder="Client" style={{flex:1}}/><select value={rr} onChange={e=>setRr(Number(e.target.value))} style={{width:60}}>{[5,4,3,2,1].map(x=><option key={x} value={x}>{x}★</option>)}</select></div><textarea value={rt} onChange={e=>setRt(e.target.value)} placeholder="Review..." style={{height:50,marginBottom:6}}/><button className="bb" onClick={addReview} style={{fontSize:11}}>Add</button></div>
        {reviews.map(r=><div key={r.id} className="cd mb"><div style={{display:"flex",justifyContent:"space-between"}}><b style={{fontSize:13}}>{r.client_name}</b><span style={{color:Y}}>{"★".repeat(r.rating||0)}{"☆".repeat(5-(r.rating||0))}</span></div><p style={{color:dark?"#8888a0":"#888",fontSize:12,marginTop:3}}>"{r.review_text}"</p></div>)}
      </div>}

      {tab==="referrals"&&<div>
        <div className="cd mb"><h4 style={{fontSize:13,marginBottom:8}}>Add Referral</h4><div className="row"><input value={fn} onChange={e=>setFn(e.target.value)} placeholder="Name" style={{flex:1}}/><input value={fs} onChange={e=>setFs(e.target.value)} placeholder="Referred by" style={{flex:1}}/><button className="bb" onClick={addRef} style={{fontSize:11}}>Add</button></div></div>
        {referrals.map(r=><div key={r.id} className="cd mb" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><b style={{fontSize:13}}>{r.name}</b><div style={{fontSize:11,color:dark?"#8888a0":"#888"}}>{r.source} · {r.ref_date}</div></div><select value={r.status} onChange={e=>updateRefStatus(r.id,e.target.value)} style={{width:"auto",fontSize:10,padding:"3px 6px"}}><option value="pending">Pending</option><option value="contacted">Contacted</option><option value="converted">Converted</option></select></div>)}
      </div>}
    </div>
  );
}

import DxfParser from "dxf-parser";

const $ = id => document.getElementById(id);
const canvas = $("view"), ctx = canvas.getContext("2d");

let survey = [], dxf = null, entities = [];
let showSurvey = true, showDrawing = true;
let view = {cx:0, cy:0, scale:1, fitted:false};
let drag = null;

function resize(){ canvas.width=canvas.clientWidth*devicePixelRatio; canvas.height=canvas.clientHeight*devicePixelRatio; draw(); }
window.addEventListener("resize", resize);

function parseNumber(v){ const n=Number(String(v).replace(",", ".")); return Number.isFinite(n)?n:null; }

/* Generic SDR/CSV/TXT parser.
   Supports common rows such as:
   point,e,n,z,code
   or point e n z code
   or point,e,n,z
*/
function parseSurvey(text){
  const rows = text.replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const row of rows){
    const parts=row.includes(",") ? row.split(",").map(x=>x.trim()) : row.split(/\s+/);
    if(parts.length<4) continue;
    let nums=[];
    for(let i=0;i<parts.length;i++){ const n=parseNumber(parts[i]); if(n!==null) nums.push([i,n]); }
    if(nums.length<3) continue;
    const pnum = parts[0];
    // Heuristic: first 3 numeric values after a likely point id are E,N,Z.
    const start = (parseNumber(parts[0])===null || parts[0].length<12) ? 1 : 0;
    const vals=[];
    for(let i=start;i<parts.length;i++){const n=parseNumber(parts[i]); if(n!==null) vals.push(n);}
    if(vals.length<2) continue;
    const E=vals[0], N=vals[1], Z=vals.length>2?vals[2]:0;
    const code = parts.slice(Math.min(parts.length-1, start+3)).join(" ");
    out.push({id:pnum,E,N,Z,code});
  }
  return out;
}

function dxfBounds(ents){
  let xs=[],ys=[];
  for(const e of ents){
    const pts=[];
    if(e.vertices) pts.push(...e.vertices);
    if(e.startPoint) pts.push(e.startPoint);
    if(e.endPoint) pts.push(e.endPoint);
    if(e.center) pts.push(e.center);
    for(const p of pts) if(Number.isFinite(p.x)&&Number.isFinite(p.y)){xs.push(p.x);ys.push(p.y);}
  }
  if(!xs.length) return null;
  return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
}
function surveyBounds(){
  if(!survey.length)return null;
  return {minX:Math.min(...survey.map(p=>p.E)),maxX:Math.max(...survey.map(p=>p.E)),
          minY:Math.min(...survey.map(p=>p.N)),maxY:Math.max(...survey.map(p=>p.N))};
}
function unionBounds(){
  const a=dxfBounds(entities), b=surveyBounds();
  if(!a)return b;if(!b)return a;
  return {minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),
          minY:Math.min(a.minY,b.minY),maxY:Math.max(a.maxY,b.maxY)};
}
function fit(){
  const b=unionBounds(); if(!b)return;
  view.cx=(b.minX+b.maxX)/2; view.cy=(b.minY+b.maxY)/2;
  const w=Math.max(1,b.maxX-b.minX), h=Math.max(1,b.maxY-b.minY);
  view.scale=.85*Math.min(canvas.width/(devicePixelRatio*w),canvas.height/(devicePixelRatio*h));
  view.fitted=true; draw();
}
function sx(x){return canvas.width/2+(x-view.cx)*view.scale*devicePixelRatio}
function sy(y){return canvas.height/2-(y-view.cy)*view.scale*devicePixelRatio}

function drawEntity(e){
  ctx.beginPath();
  if(e.type==="LINE"){
    ctx.moveTo(sx(e.vertices[0].x),sy(e.vertices[0].y));ctx.lineTo(sx(e.vertices[1].x),sy(e.vertices[1].y));ctx.stroke();
  }else if(["LWPOLYLINE","POLYLINE"].includes(e.type)){
    const v=e.vertices||[]; if(!v.length)return;
    ctx.moveTo(sx(v[0].x),sy(v[0].y)); for(let i=1;i<v.length;i++)ctx.lineTo(sx(v[i].x),sy(v[i].y));
    if(e.shape||e.closed)ctx.closePath();ctx.stroke();
  }else if(e.type==="CIRCLE"||e.type==="ARC"){
    if(!e.center)return; const r=e.radius||0;
    const a1=e.type==="ARC"?(e.startAngle||0):0, a2=e.type==="ARC"?(e.endAngle||Math.PI*2):Math.PI*2;
    ctx.arc(sx(e.center.x),sy(e.center.y),r*view.scale*devicePixelRatio,-a1,-a2,true);ctx.stroke();
  }
}
function draw(){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#0b1020";ctx.fillRect(0,0,canvas.width,canvas.height);
  if(!view.fitted && (entities.length||survey.length))fit();
  if(showDrawing){
    ctx.strokeStyle="#94a3b8";ctx.lineWidth=1*devicePixelRatio;
    for(const e of entities)drawEntity(e);
  }
  if(showSurvey){
    const size=Number($("pointSize").value)||5;
    ctx.fillStyle="#f59e0b";ctx.font=`${11*devicePixelRatio}px Arial`;
    for(const p of survey){
      const x=sx(p.E),y=sy(p.N);
      ctx.beginPath();ctx.arc(x,y,size*devicePixelRatio,0,Math.PI*2);ctx.fill();
      ctx.fillText(String(p.id),x+7*devicePixelRatio,y-7*devicePixelRatio);
    }
  }
}
function report(){
  const sb=surveyBounds(), db=dxfBounds(entities);
  let html=`<b>Survey:</b> ${survey.length} نقطة<br>`;
  html+=`<b>DXF entities:</b> ${entities.length}<br>`;
  if(sb&&db){
    const gap=Math.hypot((sb.minX+sb.maxX-db.minX-db.maxX)/2,(sb.minY+sb.maxY-db.minY-db.maxY)/2);
    html+=`<b>Center offset:</b> ${gap.toFixed(3)} m<br>`;
    if(gap>Number($("tol").value)) html+=`⚠️ نطاق الرفع مختلف عن نطاق اللوحة. لا تم تغيير الإحداثيات تلقائيًا.`;
    else html+=`✓ النطاقات متقاربة ضمن حد المطابقة.`;
  }
  $("report").innerHTML=html;
}
function status(s){$("status").textContent=s}

$("sdr").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  const text=await f.text();survey=parseSurvey(text);
  $("sdrInfo").textContent=`${f.name} — ${survey.length} نقطة مقروءة`;
  status(`تم تحميل SDR: ${survey.length} نقطة`);view.fitted=false;fit();report();
});
$("dxf").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const text=await f.text();const parser=new DxfParser();dxf=parser.parseSync(text);
    entities=dxf.entities||[];
    $("dxfInfo").textContent=`${f.name} — ${entities.length} عنصر`;
    status(`تم تحميل DXF: ${entities.length} عنصر`);view.fitted=false;fit();report();
  }catch(err){$("dxfInfo").textContent="فشل قراءة DXF";status("خطأ في DXF");console.error(err)}
});
$("dwg").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f)return;
  $("dwgInfo").textContent=`${f.name} — تم استلام الملف`;
  status("DWG مرفوع. محرك DWG يحتاج Backend/Converter في المرحلة التالية.");
});
$("surveyToggle").onclick=()=>{showSurvey=!showSurvey;$("surveyToggle").textContent=showSurvey?"إخفاء الرفع":"إظهار الرفع";draw()};
$("drawingToggle").onclick=()=>{showDrawing=!showDrawing;$("drawingToggle").textContent=showDrawing?"إخفاء اللوحة":"إظهار اللوحة";draw()};
$("fit").onclick=fit;
$("reset").onclick=()=>{view={cx:0,cy:0,scale:1,fitted:false};fit()};
$("zoomIn").onclick=()=>{view.scale*=1.25;draw()};
$("zoomOut").onclick=()=>{view.scale/=1.25;draw()};
$("pointSize").oninput=draw;
$("tol").oninput=report;
$("searchBtn").onclick=()=>{
  const q=$("search").value.trim();const p=survey.find(x=>String(x.id)===q);
  if(!p){status("النقطة غير موجودة");return}
  view.cx=p.E;view.cy=p.N;view.scale=Math.max(view.scale,2);view.fitted=true;draw();status(`Point ${p.id}: E=${p.E}, N=${p.N}, Z=${p.Z}`);
};
canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,cx:view.cx,cy:view.cy}});
canvas.addEventListener("pointermove",e=>{
  if(!drag)return;
  const dx=(e.clientX-drag.x)/view.scale,dy=(e.clientY-drag.y)/view.scale;
  view.cx=drag.cx-dx;view.cy=drag.cy+dy;view.fitted=true;draw();
});
window.addEventListener("pointerup",()=>drag=null);
canvas.addEventListener("wheel",e=>{e.preventDefault();view.scale*=e.deltaY<0?1.12:.89;view.fitted=true;draw()},{passive:false});

$("export").onclick=()=>{
  if(!survey.length){status("ارفع SDR أولًا");return}
  let out="0\nSECTION\n2\nENTITIES\n";
  for(const p of survey){
    out+=`0\nPOINT\n8\nSURVEY_POINTS\n10\n${p.E}\n20\n${p.N}\n30\n${p.Z||0}\n`;
    out+=`0\nTEXT\n8\nSURVEY_TEXT\n10\n${p.E}\n20\n${p.N}\n30\n${p.Z||0}\n40\n0.25\n1\n${String(p.id).replace(/[^\\x20-\\x7E]/g,"")}\n`;
  }
  out+="0\nENDSEC\n0\nEOF\n";
  const blob=new Blob([out],{type:"application/dxf"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="survey_points.dxf";a.click();
  status("تم تصدير DXF للنقاط");
};

resize();

// Phase-1 test console served by the hub at "/". Lets you check the bridge from a phone
// before the real app exists. Key is kept only in this browser (localStorage).
export const TEST_PAGE = `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OI Trade Hub – Test</title>
<style>
:root{--bg:#0d0d0f;--card:#17171b;--line:#2a2a31;--tx:#eceae4;--mut:#8d8a83;--gold:#d8b45a;--up:#27c281;--dn:#ef4f4f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,"Noto Sans Thai",sans-serif;padding:14px 16px 40px}
h1{font-size:17px;margin:0 0 12px;color:var(--gold);letter-spacing:.3px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sp{flex:1}
.dot{width:10px;height:10px;border-radius:50%;background:var(--dn);display:inline-block}.dot.on{background:var(--up)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-variant-numeric:tabular-nums}
.k{color:var(--mut);font-size:13px}.v{text-align:right}
input,select,button{font:inherit;color:var(--tx);background:#101013;border:1px solid var(--line);border-radius:8px;padding:9px 10px;min-width:0}
input,select{width:100%}label{font-size:12px;color:var(--mut);display:block;margin-bottom:3px}
.f2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.f3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
button{cursor:pointer;font-weight:600}.buy{background:var(--up);border-color:var(--up);color:#04140c}.sell{background:var(--dn);border-color:var(--dn);color:#1a0505}
.big{flex:1;padding:12px}.sm{padding:5px 9px;font-size:13px}
.pos{border-top:1px solid var(--line);padding:8px 0;display:flex;gap:8px;align-items:center;font-size:14px}
.pos:first-child{border-top:0}.b{color:var(--up)}.s{color:var(--dn)}
.log{font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--mut);max-height:220px;overflow:auto;white-space:pre-wrap}
.err{color:var(--dn)}.ok{color:var(--up)}
</style></head><body>
<h1>OI Gold Pro Trade · Hub test</h1>

<div class="card" id="keyCard">
  <label>App key</label>
  <div class="row"><input id="key" type="password" autocomplete="off" placeholder="APP_KEY"><button id="saveKey" class="sm">บันทึก</button></div>
</div>

<div class="card">
  <div class="row"><span class="dot" id="dot"></span><b id="status">ยังไม่เชื่อมต่อ</b><span class="sp"></span><span class="k" id="age"></span></div>
  <div class="grid" style="margin-top:10px">
    <span class="k">บัญชี</span><span class="v" id="acc">–</span>
    <span class="k">Balance</span><span class="v" id="bal">–</span>
    <span class="k">Equity</span><span class="v" id="eq">–</span>
    <span class="k">กำไรลอย</span><span class="v" id="fl">–</span>
    <span class="k">Margin level</span><span class="v" id="ml">–</span>
    <span class="k">กำไรวันนี้</span><span class="v" id="pd">–</span>
    <span class="k" id="symName">ราคา</span><span class="v" id="px">–</span>
  </div>
</div>

<div class="card">
  <div class="f3">
    <div><label>ประเภท</label><select id="kind"><option>MARKET</option><option>LIMIT</option><option>STOP</option></select></div>
    <div><label>Lot</label><input id="lots" inputmode="decimal" value="0.01"></div>
    <div><label>ราคา (pending)</label><input id="price" inputmode="decimal"></div>
  </div>
  <div class="f2" style="margin-top:8px">
    <div><label>SL</label><input id="sl" inputmode="decimal"></div>
    <div><label>TP</label><input id="tp" inputmode="decimal"></div>
  </div>
  <div class="row" style="margin-top:10px"><button class="buy big" data-side="BUY">BUY</button><button class="sell big" data-side="SELL">SELL</button></div>
</div>

<div class="card"><b>ออเดอร์ที่เปิดอยู่</b><div id="positions" class="k" style="margin-top:6px">–</div></div>
<div class="card"><b>Pending</b><div id="orders" class="k" style="margin-top:6px">–</div></div>
<div class="card"><b>ผลคำสั่งล่าสุด</b><div id="log" class="log" style="margin-top:6px"></div></div>

<script>
const $=id=>document.getElementById(id);
let KEY="";try{KEY=localStorage.getItem("oit_key")||""}catch(e){}
$("key").value=KEY;
$("saveKey").onclick=()=>{KEY=$("key").value.trim();try{localStorage.setItem("oit_key",KEY)}catch(e){};poll()};
let S=null, digits=2;
const fx=(n,d=2)=>n==null||isNaN(n)?"–":Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const cls=n=>n>0?"ok":n<0?"err":"";

async function api(path,body){
  const r=await fetch(path,{method:body?"POST":"GET",headers:{"X-Key":KEY,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  return r.json();
}
async function poll(){
  if(!KEY||document.hidden)return;
  try{
    const d=await api("/app/state");
    if(!d.ok){$("status").textContent=d.error==="auth"?"App key ไม่ถูกต้อง":d.error;return}
    $("dot").classList.toggle("on",d.online);
    $("status").textContent=d.online?"EA ออนไลน์":"EA ออฟไลน์";
    $("age").textContent=d.age_ms==null?"":"ซิงก์ล่าสุด "+(d.age_ms/1000).toFixed(1)+" วิ";
    S=d.state; if(S) render(S);
    $("log").innerHTML=(d.results||[]).map(r=>{
      const t=new Date(r.at).toLocaleTimeString("th-TH");
      const c=r.ok===true?"ok":r.ok===false?"err":"";
      return '<div class="'+c+'">'+t+"  "+(r.type||"")+"  "+r.status+(r.ticket?"  #"+r.ticket:"")+(r.msg?"  "+r.msg:"")+"</div>";
    }).join("");
  }catch(e){$("status").textContent="เชื่อมต่อ hub ไม่ได้"}
}
function render(s){
  const a=s.account||{}, y=s.symbol||{}; digits=y.digits||2;
  $("acc").textContent=(a.login||"–")+" · "+(a.server||"")+" · "+(a.currency||"");
  $("bal").textContent=fx(a.balance); $("eq").textContent=fx(a.equity);
  $("fl").innerHTML='<span class="'+cls(a.profit)+'">'+fx(a.profit)+"</span>";
  $("ml").textContent=a.margin_level?fx(a.margin_level,0)+"%":"–";
  const p=s.pl||{}; $("pd").innerHTML='<span class="'+cls(p.today)+'">'+fx(p.today)+"</span>";
  $("symName").textContent=y.name||"ราคา";
  $("px").textContent=fx(y.bid,digits)+" / "+fx(y.ask,digits);
  const P=s.positions||[];
  $("positions").innerHTML=P.length?P.map(x=>'<div class="pos"><span class="'+(x.side==="BUY"?"b":"s")+'">'+x.side+'</span><span>'+x.lots+' @ '+fx(x.open,digits)+'</span><span class="sp"></span><span class="'+cls(x.profit)+'">'+fx(x.profit)+'</span><button class="sm" data-close="'+x.ticket+'">ปิด</button></div>').join(""):"ไม่มี";
  const O=s.orders||[];
  $("orders").innerHTML=O.length?O.map(x=>'<div class="pos"><span>'+x.type+'</span><span>'+x.lots+' @ '+fx(x.price,digits)+'</span><span class="sp"></span><button class="sm" data-cancel="'+x.ticket+'">ยกเลิก</button></div>').join(""):"ไม่มี";
}
async function send(cmd,label){
  if(!confirm("ยืนยัน: "+label+" ?"))return;
  const d=await api("/app/cmd",cmd);
  if(!d.ok)alert("ส่งไม่สำเร็จ: "+d.error); poll();
}
document.querySelectorAll("[data-side]").forEach(b=>b.onclick=()=>{
  const c={type:"OPEN",side:b.dataset.side,kind:$("kind").value,lots:$("lots").value,price:$("price").value,sl:$("sl").value,tp:$("tp").value};
  send(c,c.side+" "+c.kind+" "+c.lots+" lot"+(c.sl?" SL "+c.sl:"")+(c.tp?" TP "+c.tp:""));
});
document.addEventListener("click",e=>{
  const t=e.target;
  if(t.dataset.close)send({type:"CLOSE",ticket:t.dataset.close},"ปิดออเดอร์ #"+t.dataset.close);
  if(t.dataset.cancel)send({type:"CANCEL",ticket:t.dataset.cancel},"ยกเลิก #"+t.dataset.cancel);
});
setInterval(poll,1000); poll();
</script></body></html>`;

// Trial: closed M1 large candle body crossing EMA50 or an Envelope band. No trade execution or alerts.
(function(root){
  'use strict';
  function scan(B,now,period=20,upper=[],lower=[]){
    period=Number.isInteger(period)&&period>=1&&period<=500?period:20;
    const hits=[],alpha=2/51,bodies=[];
    let ema=null,bodySum=0;
    for(let i=0;i<B.length;i++){
      const b=B[i];
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.high<b.low)return [];
      ema=ema===null?b.close:alpha*b.close+(1-alpha)*ema;
      const body=Math.abs(b.close-b.open);
      if(i>=Math.max(49,period)&&b.time+60<=now){
        const avg=bodySum/period;
        const crosses=level=>Number.isFinite(level)&&Math.min(b.open,b.close)<level&&Math.max(b.open,b.close)>level;
        if(avg>0&&body>=avg*2&&(crosses(ema)||crosses(upper[i])||crosses(lower[i]))){
          hits.push({...b,ema,ratio:body/avg,dir:b.close>b.open?1:-1});
        }
      }
      bodies.push(body);
      bodySum+=body;
      if(i>=period)bodySum-=bodies[i-period];
    }
    return hits;
  }
  if(typeof module==='object'&&module.exports)module.exports={scan};
  const O=root.OI;if(!O?.chartM1||!O.series)return;
  const $=id=>document.getElementById(id),KEY='oit_vol_ema_box'+(O.sfx||'')+(O.psfx||'');
  let period=20;
  try{const v=JSON.parse(localStorage.getItem(KEY+'_period'));if(Number.isInteger(v)&&v>=1&&v<=500)period=v;}catch(e){}
  let on=true,requestUpdate=()=>{},hits=[];
  try{const v=JSON.parse(localStorage.getItem(KEY));if(typeof v==='boolean')on=v;}catch(e){}
  const invalidate=()=>{O.markDirty();requestUpdate();};
  function draw(ctx,w,h){
    hits=[];
    if(!on||O.tf!=='1m')return;
    const bars=O.chartM1();
    const [upper,,lower]=O.envelopeBands(bars.map(b=>b.close));
    hits=scan(bars,Date.now()/1000+(O.tzShift??25200),period,upper,lower);
    const ts=O.chart.timeScale(),width=ts.width(),step=ts.options().barSpacing||6;
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,h);ctx.clip();
    ctx.strokeStyle='#ffdf35';ctx.fillStyle='rgba(255,223,53,.045)';ctx.lineWidth=1.5;ctx.setLineDash([]);
    for(const b of hits){
      const x=ts.timeToCoordinate(b.time),top=O.series.priceToCoordinate(b.high),bottom=O.series.priceToCoordinate(b.low);
      if([x,top,bottom].some(v=>v===null||!Number.isFinite(v)))continue;
      const left=x-step*.55,y=Math.min(top,bottom)-2,height=Math.abs(bottom-top)+4;
      if(left>width||left+step*1.1<0)continue;
      ctx.fillRect(left,y,step*1.1,height);ctx.strokeRect(left,y,step*1.1,height);
    }
    ctx.restore();
  }
  if(O.series.attachPrimitive){
    const renderer={draw:target=>target.useMediaCoordinateSpace(s=>draw(s.context,s.mediaSize.width,s.mediaSize.height))};
    O.series.attachPrimitive({attached(p){requestUpdate=p.requestUpdate;requestUpdate();},detached(){requestUpdate=()=>{};},paneViews:()=>[{zOrder:()=> 'top',renderer:()=>renderer}]});
  }else O.hooks?.push((ctx,w,h)=>draw(ctx,w,h-O.chart.timeScale().height()));
  function mount(){
    const m=$('indMenu');if(!m||m.hidden||$('volEmaBox'))return;
    const el=document.createElement('div');el.id='volEmaBox';el.className='gsbox';
    el.innerHTML=`<div class="row"><button data-vebox class="gsb${on?' on':''}"><i style="background:#ffdf35"></i>ขนาดตัวแท่ง × EMA50 / Envelope</button></div><div class="row ps"><label>เฉลี่ยขนาดตัวแท่ง (จำนวนแท่ง)<input data-veperiod type="number" inputmode="numeric" min="1" max="500" step="1" value="${period}" style="width:70px"></label></div><div class="gsinfo">แท่งปิด M1 · ตัวแท่งคร่อม EMA50 หรือขอบบน/ล่าง Envelope ตามค่าที่ตั้ง · ขนาดเปิด–ปิด ≥ 2× ค่าเฉลี่ย ${period} แท่งก่อนหน้า<br>กรอบเฉพาะแท่งที่ผ่าน รวมไส้ · ดูบน M1 · ยังไม่แจ้งเตือน</div>`;
    m.querySelector('.t')?.after(el);
  }
  const menu=$('indMenu');
  if(menu){
    new MutationObserver(mount).observe(menu,{childList:true});
    menu.addEventListener('click',e=>{
      if(!e.target.closest('[data-vebox]'))return;
      on=!on;try{localStorage.setItem(KEY,JSON.stringify(on));}catch(e){}
      $('volEmaBox')?.remove();mount();invalidate();
    });
    menu.addEventListener('change',e=>{
      const input=e.target.closest('[data-veperiod]');if(!input)return;
      const v=Number(input.value);
      if(!Number.isInteger(v)||v<1||v>500){input.value=period;return;}
      period=v;try{localStorage.setItem(KEY+'_period',JSON.stringify(period));}catch(e){}
      $('volEmaBox')?.remove();mount();invalidate();
    });mount();
  }
  setInterval(()=>{if(on&&!document.hidden&&O.tf==='1m')invalidate();},1000);
  root.OIVolEmaBox={scan,get hits(){return hits;},get enabled(){return on;}};
})(typeof window==='undefined'?globalThis:window);

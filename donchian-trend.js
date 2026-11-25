// Donchian breakout with a volatility-adjusted ATR trailing band.
(() => {
  'use strict';
  const O = window.OI;
  if (!O) return;
  const button = document.querySelector('#trendPanelBtn');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'ตาราง Donchian Trend');
  dialog.style.cssText = 'width:min(360px,90vw);max-height:78dvh;overflow:auto;background:#101a28;color:#edf1f6;border:1px solid #998253;border-radius:14px;padding:16px';
  dialog.innerHTML = '<header style="display:flex;justify-content:space-between"><strong>Donchian Trend</strong><button aria-label="ปิด">✕</button></header><p><label><input type="checkbox"> แสดงเส้นบนกราฟ</label></p><p class="summary"></p><table style="width:100%;text-align:left"><thead><tr><th>ตัววัด</th><th>ทิศทาง</th><th>ค่า</th></tr></thead><tbody></tbody></table>';
  document.body.append(dialog);
  const toggle = dialog.querySelector('input'), key = 'oit_donchian_line' + O.psfx;
  try { toggle.checked = localStorage.getItem(key) === '1'; } catch {}
  const close = () => dialog.close();
  dialog.querySelector('button').onclick = close;
  window.bindRightSwipeDismiss?.(dialog, close);
  dialog.onclick = e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) close();
  };
  const line = O.chart.addLineSeries({lineType:1,lineWidth:3,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false});
  const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
  const fmt = x => Number.isFinite(x) ? x.toFixed(2) : '—';
  const green = '#20ca88', orange = '#ff7900';
  const bounds = a => [Math.max(...a.map(b=>b.high)), Math.min(...a.map(b=>b.low))];
  function calculate(bars) {
    let ema=bars[0].close, fast=ema, slow=ema, signal=0, atr=0, gain=0, loss=0, plus=0, minus=0, adx=0;
    let direction=0, trail, sar=bars[0].low, rising=true, extreme=bars[0].high, accel=.02;
    const points=[], ks=[], ds=[], ranges=[];
    let rows=[], entry='WAIT';
    for (let i=1;i<bars.length;i++) {
      const b=bars[i], p=bars[i-1], c=b.close, change=c-p.close;
      ema+=(c-ema)*2/51; fast+=(c-fast)*2/13; slow+=(c-slow)*2/27;
      const macd=fast-slow; signal+=(macd-signal)*.2;
      const tr=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
      atr+=(tr-atr)/14; ranges.push(atr);
      gain+=(Math.max(0,change)-gain)/14; loss+=(Math.max(0,-change)-loss)/14;
      const up=b.high-p.high, down=p.low-b.low;
      plus+=((up>down?Math.max(0,up):0)-plus)/14;
      minus+=((down>up?Math.max(0,down):0)-minus)/14;
      adx+=((plus+minus?100*Math.abs(plus-minus)/(plus+minus):0)-adx)/14;
      const older=bars[Math.max(0,i-2)];
      sar=rising?Math.min(sar+accel*(extreme-sar),p.low,older.low):Math.max(sar+accel*(extreme-sar),p.high,older.high);
      if (rising?b.low<sar:b.high>sar) {rising=!rising;sar=extreme;extreme=rising?b.high:b.low;accel=.02;}
      else if(rising?b.high>extreme:b.low<extreme){extreme=rising?b.high:b.low;accel=Math.min(.2,accel+.02);}
      if(i<19) continue;
      const recent=bars.slice(i-19,i+1), [hi,lo]=bounds(recent.slice(-14));
      ks.push(hi===lo?50:100*(c-lo)/(hi-lo)); ds.push(avg(ks.slice(-3)));
      if(i<20) continue;
      const [upper,lower]=bounds(bars.slice(i-20,i)), mid=(upper+lower)/2;
      const ratio=atr/(avg(ranges.slice(-50))||1), width=atr*(ratio>1.2?3.2:ratio<.8?1.8:2.5);
      entry=c>upper?'BUY':c<lower?'SELL':'WAIT';
      const next=c>upper?1:c<lower?-1:direction;
      if(next){
        const band=(b.high+b.low)/2-next*width;
        trail=next!==direction?band:next>0?Math.max(trail,band):Math.min(trail,band);
        points.push({time:b.time,value:trail,color:next>0?green:orange});
      }
      direction=next;
      if(i!==bars.length-1) continue;
      const prices=recent.map(x=>x.close), mean=avg(prices), sd=Math.sqrt(avg(prices.map(x=>(x-mean)**2)));
      const typ=recent.map(x=>(x.high+x.low+x.close)/3), tm=avg(typ), dev=avg(typ.map(x=>Math.abs(x-tm)));
      const cci=dev?(typ.at(-1)-tm)/(.015*dev):0, rsi=gain+loss?100*gain/(gain+loss):50;
      const k=ds.at(-1), d=avg(ds.slice(-3)), z=sd?(c-mean)/sd:0;
      const sweepUp=b.low<lower&&c>lower, sweepDown=b.high>upper&&c<upper;
      const pressure=avg(recent.map(x=>x.high===x.low?0:(2*x.close-x.high-x.low)/(x.high-x.low)));
      rows=[['EMA 50',c-ema,ema],['STO',k-d,k],['SAR',c-sar,sar],['SD',z,z],['ENV 1%',c>mean*1.01?1:c<mean*.99?-1:0,mean],['MACD',macd-signal,macd-signal],['RSI',rsi>55?1:rsi<45?-1:0,rsi],['CCI',Math.abs(cci)>100?cci:0,cci],['DON',c-mid,mid],['REGIME',adx>20?plus-minus:0,adx],['แรงปิดแท่ง',pressure,pressure],['ADAPT',direction,trail],['SWEEP',Number(sweepUp)-Number(sweepDown),null]];
    }
    return {points,rows,entry};
  }
  let frames=[], checked=0, pending=false, signature='';
  async function mtf(){
    if(pending||Date.now()-checked<60000) return;
    pending=true;
    try{
      frames=await Promise.all(['15m','1h','4h','1d'].map(async tf=>{
        try{const a=(await O.fetchTF(tf,100,true)).slice(0,-1);
          if(a.length<50)return null;
          const ema=a.reduce((v,b)=>v+2*(b.close-v)/51,a[0].close);
          return Math.sign(a.at(-1).close-ema);
        }catch{return null;}
      }));
    }finally{pending=false;checked=Date.now();signature='';refresh();}
  }
  function refresh(){
    if(document.hidden||(!dialog.open&&!toggle.checked))return;
    if(dialog.open)void mtf();
    const raw=O.rawBars, id=[O.tf,O.displayedTF,raw.length,raw[0]?.[0],raw.at(-2)?.join(','),O.adj,dialog.open,toggle.checked].join('|');
    if(id===signature)return;
    signature=id;
    const bars=O.chartBars().slice(0,-1);
    const {points,rows,entry}=bars.length>=51?calculate(bars):{points:[],rows:[],entry:'WAIT'};
    line.setData(toggle.checked?points:[]);
    if(!dialog.open)return;
    const tbody=dialog.querySelector('tbody');tbody.replaceChildren();
    if(rows.length)rows.push(['MTF',frames.length===4&&frames.every(Number.isFinite)?frames.reduce((a,b)=>a+b,0):null,null]);
    let up=0,down=0,used=0;
    for(const [label,value,metric] of rows){
      const sign=Math.sign(value??0), tr=tbody.insertRow();
      if(value!==null)used++;
      if(sign>0)up++;if(sign<0)down++;
      tr.insertCell().textContent=label;
      const status=tr.insertCell();status.textContent=value===null?'—':sign>0?'UP':sign<0?'DOWN':'MID';
      status.style.color=sign>0?green:sign<0?orange:'silver';
      tr.insertCell().textContent=label==='MTF'?frames.map(x=>x===null?'—':x>0?'↑':x<0?'↓':'·').join(' '):fmt(metric);
    }
    dialog.querySelector('.summary').textContent=used?O.tf+' · '+(up>used/2?'UP':down>used/2?'DOWN':'MID')+' · ขึ้น '+up+' / ลง '+down+' จาก '+used+' · Breakout '+entry:'รอข้อมูลแท่งปิด';
  }
  toggle.onchange=()=>{try{localStorage.setItem(key,toggle.checked?'1':'0');}catch{} refresh();};
  button.onclick=()=>{dialog.showModal();signature='';refresh();};
  setInterval(refresh,1200);refresh();
})();

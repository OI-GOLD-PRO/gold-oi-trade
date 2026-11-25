/* H1/M15 closed-bar engine. UTC seconds in/out; no broker orders, no OI-derived anchors. */
(function(root){
'use strict';
const defaults={lookback:24,tolerance:.15,buffer:.05,shock:2.5,maxWidth:6,chase:.6,wait:8,hold:6};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const median=a=>{a=[...a].sort((x,y)=>x-y);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:0;};
const tr=(b,p)=>Math.max(b.high-b.low,p?Math.abs(b.high-p.close):0,p?Math.abs(b.low-p.close):0);
function clean(bars,now){const m=new Map(); for(const b of bars||[]) if([b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.time%900===0&&b.time+900<=now&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close))m.set(b.time,{...b});return [...m.values()].sort((a,b)=>a.time-b.time);}
function hours(m){const groups=new Map(),out=[];for(const b of m){const t=Math.floor(b.time/3600)*3600;if(!groups.has(t))groups.set(t,[]);groups.get(t).push(b);}for(const [t,a] of groups)if(a.length===4&&a.every((b,i)=>b.time===t+i*900))out.push({time:t,open:a[0].open,high:Math.max(...a.map(b=>b.high)),low:Math.min(...a.map(b=>b.low)),close:a[3].close});return out;}
function anchor(h,c){if(h.length<c.lookback+20)return null;const a=h.slice(-c.lookback),prior=h.slice(-c.lookback-20,-c.lookback),base=median(prior.map((b,i)=>tr(b,prior[i-1])));if(!(base>0)||a.some(b=>b.quarantine||tr(b)>c.shock*base))return null;const top=Math.max(...a.map(b=>b.high)),bottom=Math.min(...a.map(b=>b.low)),tol=base*c.tolerance;
 const touches=k=>{let last=-9,n=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i][k]-(k==='high'?top:bottom))<=tol&&i-last>=3){n++;last=i;}return n;};
 if(touches('high')<2||touches('low')<2||top-bottom>c.maxWidth*base||top-bottom<base)return null;
 return {id:String(a[a.length-1].time),start:a[0].time,locked:a[a.length-1].time+3600,top,bottom,mid:(top+bottom)/2,atr:base,tol,buffer:base*c.buffer};}
function classify(a,box){if(!box||a.length<40)return {score:0,state:'RANGE'};const b=a.slice(-20),cl=b.map(x=>x.close),mu=mean(cl),sd=Math.sqrt(mean(cl.map(x=>(x-mu)**2))),atr=mean(b.map((x,i)=>tr(x,b[i-1])));let ema=cl[0];cl.slice(1).forEach(x=>ema+=2/21*(x-ema));const squeeze=mu+2*sd<=ema+1.5*atr&&mu-2*sd>=ema-1.5*atr;
 const recent=a.slice(-13),over=mean(recent.slice(-8).map((x,j)=>{const p=recent[recent.length-9+j];return Math.max(0,Math.min(x.high,p.high)-Math.max(x.low,p.low))/Math.max(1e-9,Math.max(x.high,p.high)-Math.min(x.low,p.low));}));let cuts=0,last=0;for(const x of recent){const s=x.close>box.mid+box.buffer?1:x.close<box.mid-box.buffer?-1:0;if(s&&last&&s!==last)cuts++;if(s)last=s;}
 let failed=false;for(let i=0;i<recent.length-1;i++){const x=recent[i];if(x.close>box.top||x.close<box.bottom)failed ||=recent.slice(i+1,i+3).some(z=>z.close<=box.top&&z.close>=box.bottom);}
 const contraction=mean(a.slice(-5).map((x,i,ar)=>tr(x,ar[i-1])))<.8*mean(a.slice(-25,-5).map((x,i,ar)=>tr(x,ar[i-1])));
 const score=[squeeze,over>.65,cuts>=3,failed,contraction].filter(Boolean).length;
 const er=x=>{let sum=0;for(let i=1;i<x.length;i++)sum+=Math.abs(x[i].close-x[i-1].close);return sum?Math.abs(x.at(-1).close-x[0].close)/sum:0;};
 const p=a.slice(-9),l=[0,3,6].map(i=>Math.min(...p.slice(i,i+3).map(x=>x.low))),u=[0,3,6].map(i=>Math.max(...p.slice(i,i+3).map(x=>x.high))),r=[0,3,6].map(i=>u[i/3]-l[i/3]);const risingER=er(a.slice(-10))>er(a.slice(-20,-10));const close=a.at(-1).close;
 const coil=risingER&&r[2]<r[1]&&r[1]<r[0]?(l[0]<l[1]&&l[1]<l[2]&&close>=box.top-box.atr*.5?'COIL_UP':u[0]>u[1]&&u[1]>u[2]&&close<=box.bottom+box.atr*.5?'COIL_DOWN':null):null;
 return {score,state:coil||'RANGE'};}
function gate(t,ctx={}){const n=ctx.calendar;if(!n||!Number.isFinite(n.checkedAt)||t<n.checkedAt-86400||t>n.checkedAt+86400||!(t>=n.from&&t<n.to))return 'NEWS_UNVERIFIED';if(n.events.some(x=>t>=x-1800&&t<=x+1800))return 'NEWS_FREEZE';const e=ctx.expiry;if(Number.isFinite(e)&&t>=e-1800&&t<Math.ceil(e/3600)*3600+3600)return 'EXPIRY_FREEZE';if(ctx.requireOI&&(!ctx.oiValid||!Number.isFinite(e)||t>=e))return 'OI_UNVERIFIED';return 'ALLOWED';}
function scan(input,now,options={},ctx={}){const c={...defaults,...options},m=clean(input,now),h=hours(m),events=[],plans=[];let hi=0,seen=[],box=null,state='BUILDING',candidate=null,active=null,score=0,streak=0,lastShock=0,reason='WAIT_H1_RANGE';
 for(let i=0;i<m.length;i++){const b=m[i],end=b.time+900;const gap=i>0&&b.time-m[i-1].time!==900;
 if(active){let why=null;const d=active.side;active.mfe=Math.max(active.mfe||0,d>0?b.high-active.entry:active.entry-b.low);if(gap)why='DATA_GAP';else if(d>0?b.low<=active.sl:b.high>=active.sl)why='SL';else if(d>0?b.high>=active.tp2:b.low<=active.tp2)why='TP2';else if(d>0?b.close<active.box.top-active.box.buffer:b.close>active.box.bottom+active.box.buffer)why='STRUCTURAL_EXIT';else if(end-active.time>=3*900&&active.mfe<.5*active.risk)why='SOFT_TIME_STOP';else if(end-active.time>=c.hold*900)why='TIME_STOP';if(why){active.exit={time:end,reason:why,price:why==='SL'?active.sl:why==='TP2'?active.tp2:b.close};events.push({time:end,state:why});active=null;box=null;candidate=null;state='BUILDING';}}
 if(gap){candidate=null;box=null;streak=0;state='BUILDING';}
 while(hi<h.length&&h[hi].time+3600<=end){const hb=h[hi++],prev=seen.slice(-20),base=median(prev.map((x,j)=>tr(x,prev[j-1])));seen.push(hb);const quarantine=Number.isFinite(ctx.expiry)&&hb.time<Math.ceil(ctx.expiry/3600)*3600+3600&&hb.time+3600>ctx.expiry;
 if((base&&tr(hb,seen.at(-2))>c.shock*base)||quarantine){hb.quarantine=true;lastShock=hb.time+3600;candidate=null;state='PROVISIONAL';reason='SHOCK_QUARANTINE';continue;}
 if(!box){box=anchor(seen,c);if(box){state='RANGE';reason='WAIT_BREAKOUT';}continue;}
 if(!candidate&&!active&&hb.time>=box.locked&&end>=lastShock+3600){const d=hb.close>box.top+box.buffer?1:hb.close<box.bottom-box.buffer?-1:0;if(d&&Math.abs(hb.close-hb.open)/Math.max(.0001,hb.high-hb.low)>=.5&&d*(hb.close-hb.open)>0){candidate={side:d,time:end,edge:d>0?box.top:box.bottom,count:0,retest:null};state='BREAKOUT_CANDIDATE';reason='WAIT_RETEST';events.push({time:end,state});}else if(d){box=null;state='BUILDING';reason='WEAK_BREAK';}}
 }
 if(!box)continue;
 const cl=classify(m.slice(0,i+1),box);score=cl.score;streak=score>=3?streak+1:0;
 if(!candidate&&!active){state=end<lastShock+3600?'PROVISIONAL':cl.state!=='RANGE'?cl.state:streak>=3?'SIDEWAYS':'RANGE';if(end-box.locked>24*3600){box=null;state='BUILDING';reason='BOX_EXPIRED';}continue;}
 if(!candidate||b.time<candidate.time||active)continue;
 const p=candidate,d=p.side,inside=d>0?b.close<box.top-box.buffer:b.close>box.bottom+box.buffer;
 if(inside||end-p.time>c.wait*900){state=inside?'FAILED_ESCAPE':'RETEST_EXPIRED';events.push({time:end,state});reason=state;candidate=null;box=null;continue;}
 const touch=b.low<=p.edge+box.tol&&b.high>=p.edge-box.tol;
 const wick=d>0?Math.max(0,Math.min(b.open,b.close,p.edge)-b.low):Math.max(0,b.high-Math.max(b.open,b.close,p.edge));
 if(touch&&wick/Math.max(.0001,b.high-b.low)>.6){state='REJECTION_RISK';reason='RETEST_WICK';candidate=null;box=null;events.push({time:end,state});continue;}
 if(!p.retest&&touch)p.retest={...b};
 const outside=d*(b.close-p.edge)>box.buffer;
 if(p.retest){p.count=outside?p.count+1:0;state='WAIT_ACCEPTANCE';}
 if(p.count>=2){const a15=mean(m.slice(Math.max(0,i-13),i+1).map((x,j,ar)=>tr(x,ar[j-1]))),contraction=(p.retest.high-p.retest.low)<=1.5*a15;reason=gate(end,ctx);if(end<lastShock+3600)reason='SHOCK_QUARANTINE';if(Math.abs(b.close-p.edge)>c.chase*box.atr)reason='CHASE_TOO_FAR';else if(!contraction)reason='RETEST_TOO_WIDE';
 state='BREAKOUT_CONFIRMED';events.push({time:end,state,reason});if(reason==='ALLOWED'){const entry=b.close,sl=d>0?Math.min(p.retest.low,box.top)-Math.max(box.buffer,.1*a15):Math.max(p.retest.high,box.bottom)+Math.max(box.buffer,.1*a15),risk=d*(entry-sl);if(risk>0){active={time:end,side:d,entry,sl,tp1:entry+d*risk,tp2:entry+d*2*risk,risk,box:{...box},status:'REFERENCE_ONLY'};plans.push(active);}}candidate=null;if(!active){box=null;} }
 }
 const latest=m.at(-1),stale=!latest||now-(latest.time+900)>1800;return {state,reason,score,box:box||active?.box||null,candidate,active,plans,events:events.slice(-40),gate:stale?'STALE_PRICE':now<lastShock+3600?'SHOCK_QUARANTINE':gate(now,ctx),bars:m.length,hours:h.length,lastTime:latest?.time,stale};}
const api={defaults,clean,hours,anchor,classify,gate,scan};if(typeof module==='object'&&module.exports)module.exports=api;else root.OIRangeCore=api;
})(typeof window==='object'?window:globalThis);

let P = null;
export default { url: 'http://127.0.0.1:8765/projects/mapping.html?nocoach&scene=loc', ready: "!!(window.__tb3 && __tb3.B)", settle: 2500, seconds: 70, speed: 3,
  before: async ({ ev }) => {
    P = await ev(`(()=>{const w=__tb3.B,f=[];for(let x=-6;x<=6;x+=0.05)for(let y=-6;y<=6;y+=0.05)if(w.freeOk(x,y))f.push([x,y]);
      f.sort((a,b)=>(a[0]+a[1])-(b[0]+b[1]));const a=f[Math.floor(f.length*0.03)],g=f[Math.floor(f.length*0.97)];
      return {n:f.length,a,g,sa:__tb3.screen(a[0],a[1]),sa2:__tb3.screen(a[0]+0.3,a[1]),sg:__tb3.screen(g[0],g[1])};})()`);
    console.log(JSON.stringify(P));
  },
  frame: async (t, { ev, mouse }) => {
    const at = (s) => Math.abs(t - s) < 0.01;
    if (at(0.2)) await mouse('mouseMoved', P.sa[0], P.sa[1], 0);
    if (at(0.5)) await mouse('mousePressed', P.sa[0], P.sa[1]);
    if (at(0.7)) await mouse('mouseMoved', P.sa2[0], P.sa2[1]);
    if (at(0.8)) await mouse('mouseReleased', P.sa2[0], P.sa2[1]);
    if (at(1.3)) await mouse('mouseMoved', P.sg[0], P.sg[1], 0);
    if (at(1.6)) await mouse('mousePressed', P.sg[0], P.sg[1]);
    if (at(1.7)) await mouse('mouseReleased', P.sg[0], P.sg[1]);
    if (at(2.2)) console.log('start', await ev("(()=>{const b=[...document.querySelectorAll('.ds-primary')].map(b=>b.textContent+(b.disabled?'(d)':''));const x=document.querySelector('.ds-flow .ds-primary');x&&x.click();return b.join('|')+' '+__tb3.B.placed+' '+!!__tb3.B.goal+' '+__tb3.B.state})()"));
  },
  done: "__tb3.B.state === 'arrived'", tail: 1.5 };

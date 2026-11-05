let P = null;
export default { url: 'http://127.0.0.1:8765/projects/ur5e.html?nocoach', ready: "!!document.querySelector('.u5-lab-hint')", settle: 3000, seconds: 11,
  before: async ({ ev }) => {
    P = await ev(`(()=>{const l=[...document.querySelectorAll('.u5-lab-hint')].find(e=>e.textContent==='Drag');const q=l.style.transform.slice(10).split('px'),m=[0,parseFloat(q[0]),parseFloat(q[1].replace(',',''))];
      const r=document.querySelector('.ds-view').getBoundingClientRect();return [r.left+ +m[1]-30, r.top+ +m[2]+12];})()`);
    console.log(JSON.stringify(P));
  },
  frame: async (t, { mouse }) => {
    const [x0, y0] = P, at = (s) => Math.abs(t - s) < 0.01;
    if (at(0.3)) await mouse('mouseMoved', x0, y0, 0);
    if (at(0.5)) await mouse('mousePressed', x0, y0);
    // a slow loop out and back: right, down, left, up, home
    if (t > 0.6 && t < 9.6) { const u = (t - 0.6) / 9 * 2 * Math.PI; await mouse('mouseMoved', x0 + 170 * Math.sin(u), y0 + 90 * (1 - Math.cos(u)) * 0.9 - 40 * Math.sin(2 * u)); }
    if (at(9.7)) await mouse('mouseReleased', x0, y0);
  } };

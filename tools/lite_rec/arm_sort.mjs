const click = (sel, txt) => `(()=>{const b=[...document.querySelectorAll('${sel}')].find(b=>b.textContent.trim()===${JSON.stringify(txt)});b&&b.click();return !!b})()`;
export default { url: 'http://127.0.0.1:8765/projects/rbe3001.html?nocoach', ready: "!!(window.__arm3d && __arm3d.frame && __arm3d.frame.blobs)", settle: 2500, seconds: 60, speed: 2.5,
  frame: async (t, { ev }) => { if (Math.abs(t - 0.6) < 0.01) console.log('sort', await ev(click('.ds-primary', 'Sort'))); },
  done: "__vt.t > 3000 && !__arm3d.busy", tail: 1.2 };

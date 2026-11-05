const click = (txt) => `(()=>{const b=[...document.querySelectorAll('.ds-primary')].find(b=>b.textContent.trim()===${JSON.stringify(txt)});b&&b.click();return !!b})()`;
export default { url: 'http://127.0.0.1:8765/projects/mapping.html?nocoach', ready: "!!(window.__tb3 && __tb3.A)", settle: 2500, seconds: 70, speed: 6,
  frame: async (t, { ev }) => { if (Math.abs(t - 0.4) < 0.01) console.log('start', await ev(click('Start mapping'))); },
  done: "__tb3.A.mode === 'done'", tail: 1.5 };

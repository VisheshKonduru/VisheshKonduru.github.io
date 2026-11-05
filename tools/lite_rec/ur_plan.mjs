export default { url: 'http://127.0.0.1:8765/projects/ur5e.html?nocoach', ready: "!!document.querySelector('.u5-lab-hint')", settle: 3000, seconds: 30,
  before: async ({ ev, sleep }) => { await ev("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Plan around obstacles').click(), true"); await sleep(1500); },
  frame: async (t, { ev }) => { if (Math.abs(t - 0.8) < 0.01) console.log('plan', await ev("(()=>{const b=[...document.querySelectorAll('.ds-primary')].find(b=>b.textContent.trim()==='Plan and move');b&&b.click();return !!b})()")); },
  done: "/Goal reached|arrived|Arrived/.test(document.querySelector('.ds-status').textContent)", tail: 1.5 };

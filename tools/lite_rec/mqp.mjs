const key = (type, k) => `document.querySelector('.ds-view').dispatchEvent(new KeyboardEvent('${type}',{key:'${k}',bubbles:true})), true`;
const plan = [[0.6, 'w'], [2.4, 'q'], [3.6, 'e'], [4.8, 's'], [6.6, null]];
export default { url: 'http://127.0.0.1:8765/projects/mqp.html?nocoach', ready: "!!document.querySelector('.ds-side-body canvas')", settle: 7000, seconds: 8.4,
  frame: async (t, { ev }) => { for (let i = 0; i < plan.length; i++) if (Math.abs(t - plan[i][0]) < 0.01) { if (i) await ev(key('keyup', plan[i - 1][1])); if (plan[i][1]) await ev(key('keydown', plan[i][1])); } },
  wait: 60 };

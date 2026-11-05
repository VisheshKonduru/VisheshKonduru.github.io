// Run: node test_ttt.mjs. Exhaustive check that the arm (O) never loses, in every position it can face.
import { bestMove, winner } from './ttt.js';
let positions = 0, losses = 0;
const seen = new Set();
function humanTurn(b) {          // human (X) tries every legal move
  const w = winner(b); if (w) { if (w === 'X') losses++; return; }
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'X'; armTurn(b); b[i] = null; }
}
function armTurn(b) {
  const w = winner(b); if (w) { if (w === 'X') losses++; return; }
  const k = b.map(v => v || '-').join(''); if (!seen.has(k)) { seen.add(k); positions++; }
  const m = bestMove(b); b[m] = 'O'; humanTurn(b); b[m] = null;
}
humanTurn(Array(9).fill(null));          // human moves first
armTurn(Array(9).fill(null));            // arm moves first
// Also every legal position with O to move (any history, even after O blunders): O must not lose from a non-lost position.
let fromAny = 0, anyLoss = 0;
function value(b, turn) { const w = winner(b); if (w) return w === 'O' ? 1 : w === 'X' ? -1 : 0;
  const v = []; for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = turn; v.push(value(b, turn === 'O' ? 'X' : 'O')); b[i] = null; }
  return turn === 'O' ? Math.max(...v) : Math.min(...v); }
function playFrom(b, turn) { // O plays bestMove, X plays everything; returns worst outcome
  const w = winner(b); if (w) return w === 'O' ? 1 : w === 'X' ? -1 : 0;
  if (turn === 'O') { const m = bestMove(b); b[m] = 'O'; const r = playFrom(b, 'X'); b[m] = null; return r; }
  let worst = 1; for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = 'X'; worst = Math.min(worst, playFrom(b, 'O')); b[i] = null; } return worst;
}
const all = new Set();
function enumerate(b, turn) { const w = winner(b); if (w) return; const k = b.join(',') + turn; if (all.has(k)) return; all.add(k);
  if (turn === 'O') { fromAny++; const opt = value(b, 'O'), got = playFrom(b, 'O'); if (got < opt) anyLoss++; }
  for (let i = 0; i < 9; i++) if (!b[i]) { b[i] = turn; enumerate(b, turn === 'O' ? 'X' : 'O'); b[i] = null; } }
enumerate(Array(9).fill(null), 'X'); enumerate(Array(9).fill(null), 'O');
// Perfect play from the empty board must draw.
function selfPlay(first) { const b = Array(9).fill(null); let t = first; while (!winner(b)) { b[bestMove(b, t)] = t; t = t === 'O' ? 'X' : 'O'; } return winner(b); }
const d1 = selfPlay('X'), d2 = selfPlay('O');
console.log(`games vs every human strategy: ${positions} arm positions, losses ${losses}`);
console.log(`all ${fromAny} legal O-to-move positions: arm does worse than the game-theoretic value in ${anyLoss}`);
console.log(`perfect play from empty board: ${d1} (X first), ${d2} (O first)`);
const ok = losses === 0 && anyLoss === 0 && d1 === 'draw' && d2 === 'draw';
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);

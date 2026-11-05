// Tic-tac-toe: full-depth minimax with alpha-beta. Board: array of 9, 'X' (human), 'O' (arm) or null.
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function winner(b) {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every(Boolean) ? 'draw' : null;
}
// Score from the arm's ('O') point of view; prefers quicker wins and slower losses.
function search(b, turn, depth, alpha, beta) {
  const w = winner(b);
  if (w === 'O') return 10 - depth;
  if (w === 'X') return depth - 10;
  if (w === 'draw') return 0;
  let best = turn === 'O' ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const s = search(b, turn === 'O' ? 'X' : 'O', depth + 1, alpha, beta);
    b[i] = null;
    if (turn === 'O') { best = Math.max(best, s); alpha = Math.max(alpha, s); }
    else { best = Math.min(best, s); beta = Math.min(beta, s); }
    if (beta <= alpha) break;
  }
  return best;
}
export function bestMove(board, turn = 'O') {
  const b = [...board];
  let best = -1, bestS = turn === 'O' ? -Infinity : Infinity;
  for (const i of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {      // fixed order: centre, corners, edges
    if (b[i]) continue;
    b[i] = turn;
    const s = search(b, turn === 'O' ? 'X' : 'O', 1, -Infinity, Infinity);
    b[i] = null;
    if (turn === 'O' ? s > bestS : s < bestS) { bestS = s; best = i; }
  }
  return best;
}
// Minimax score of each free cell if `turn` plays there (null for taken cells).
export function moveScores(board, turn = 'O') {
  const b = [...board];
  return b.map((c, i) => { if (c || winner(b)) return null; b[i] = turn; const s = search(b, turn === 'O' ? 'X' : 'O', 1, -Infinity, Infinity); b[i] = null; return s; });
}

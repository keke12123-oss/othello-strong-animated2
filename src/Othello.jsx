
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Othello / Reversi — enhanced AI with animations (framer-motion)
 * - Corner donation avoidance, X/C penalties, frontier, mobility, parity
 * - Spectate (AI vs AI), run-to-end, thinking time up to 10s
 */

// ---------------- Bitboard utils ----------------
const A_FILE = 0x8080808080808080n; // MSB side
const H_FILE = 0x0101010101010101n; // LSB side
const NOT_A_FILE = ~A_FILE & 0xffffffffffffffffn;
const NOT_H_FILE = ~H_FILE & 0xffffffffffffffffn;
const FULL = 0xffffffffffffffffn;

const DIRS = { N: 8n, S: -8n, E: -1n, W: 1n, NE: 7n, NW: 9n, SE: -9n, SW: -7n };
const CORNERS = (1n<<63n)|(1n<<56n)|(1n<<7n)|(1n<<0n);

function shift(b, dir) {
  switch (dir) {
    case DIRS.N:  return (b << 8n) & FULL;
    case DIRS.S:  return (b >> 8n) & FULL;
    case DIRS.E:  return (b >> 1n) & NOT_H_FILE;
    case DIRS.W:  return (b << 1n) & NOT_A_FILE;
    case DIRS.NE: return (b << 7n) & NOT_H_FILE;
    case DIRS.NW: return (b << 9n) & NOT_A_FILE;
    case DIRS.SE: return (b >> 9n) & NOT_H_FILE;
    case DIRS.SW: return (b >> 7n) & NOT_A_FILE;
    default: return 0n;
  }
}
function popcount(b){ let c=0n; while(b){ b&=b-1n; c++; } return Number(c); }
function idxToBit(idx){ return 1n << BigInt(63 - idx); } // 0..63 (A8..H1)
function bitAt(r,c){ return idxToBit(r*8 + c); }

// ---------------- Move generation ----------------
function legalMoves(P, O) {
  const empty = ~(P | O) & FULL; let moves = 0n;
  let mask = O & NOT_H_FILE; let x = mask & (P >> 1n);
  x |= mask & (x >> 1n); x |= mask & (x >> 1n); x |= mask & (x >> 1n); x |= mask & (x >> 1n); x |= mask & (x >> 1n);
  moves |= empty & (x >> 1n);
  mask = O & NOT_A_FILE; x = mask & (P << 1n);
  x |= mask & (x << 1n); x |= mask & (x << 1n); x |= mask & (x << 1n); x |= mask & (x << 1n); x |= mask & (x << 1n);
  moves |= empty & (x << 1n);
  mask = O; x = mask & (P << 8n);
  x |= mask & (x << 8n); x |= mask & (x << 8n); x |= mask & (x << 8n); x |= mask & (x << 8n); x |= mask & (x << 8n);
  moves |= empty & (x << 8n);
  x = mask & (P >> 8n);
  x |= mask & (x >> 8n); x |= mask & (x >> 8n); x |= mask & (x >> 8n); x |= mask & (x >> 8n); x |= mask & (x >> 8n);
  moves |= empty & (x >> 8n);
  mask = O & NOT_H_FILE; x = mask & (P << 7n);
  x |= mask & (x << 7n); x |= mask & (x << 7n); x |= mask & (x << 7n); x |= mask & (x << 7n); x |= mask & (x << 7n);
  moves |= empty & (x << 7n);
  mask = O & NOT_A_FILE; x = mask & (P << 9n);
  x |= mask & (x << 9n); x |= mask & (x << 9n); x |= mask & (x << 9n); x |= mask & (x << 9n); x |= mask & (x << 9n);
  moves |= empty & (x << 9n);
  mask = O & NOT_H_FILE; x = mask & (P >> 9n);
  x |= mask & (x >> 9n); x |= mask & (x >> 9n); x |= mask & (x >> 9n); x |= mask & (x >> 9n); x |= mask & (x >> 9n);
  moves |= empty & (x >> 9n);
  mask = O & NOT_A_FILE; x = mask & (P >> 7n);
  x |= mask & (x >> 7n); x |= mask & (x >> 7n); x |= mask & (x >> 7n); x |= mask & (x >> 7n); x |= mask & (x >> 7n);
  moves |= empty & (x >> 7n);
  return moves;
}
function flipsForMove(P, O, move) {
  if (!move) return 0n;
  let flips = 0n;
  for (const d of [DIRS.N,DIRS.S,DIRS.E,DIRS.W,DIRS.NE,DIRS.NW,DIRS.SE,DIRS.SW]) {
    let m = 0n, cur = shift(move, d);
    while (cur && (cur & O)) { m |= cur; cur = shift(cur, d); }
    if (cur & P) flips |= m;
  }
  return flips;
}
function playMove(P, O, move){ const f = flipsForMove(P,O,move); P ^= f | move; O ^= f; return [O,P]; }

// ---------------- Heuristics ----------------
const CORNER_CFG = [
  { corner: 1n<<63n, x: 1n<<54n, c: (1n<<62n)|(1n<<55n) },
  { corner: 1n<<56n, x: 1n<<49n, c: (1n<<57n)|(1n<<48n) },
  { corner: 1n<<7n,  x: 1n<<14n, c: (1n<<6n) |(1n<<15n) },
  { corner: 1n<<0n,  x: 1n<<9n,  c: (1n<<1n) |(1n<<8n)  },
];

function edgeStableApprox(P, O) {
  let sP = 0, sO = 0;
  const edges = [
    [63,62,61,60,59,58,57,56], // top
    [7,6,5,4,3,2,1,0],         // bottom
    [63,55,47,39,31,23,15,7],  // left
    [56,48,40,32,24,16,8,0],   // right
  ];
  for (const seq of edges) {
    let run=0;
    for (let i=0;i<seq.length;i++){
      const b = idxToBit(seq[i]);
      if (P & b){ if (run===0||run===1){sP++; run=1;} else break; }
      else if (O & b){ if (run===0||run===2){sO++; run=2;} else break; }
      else break;
    }
    run=0;
    for (let i=seq.length-1;i>=0;i--){
      const b = idxToBit(seq[i]);
      if (P & b){ if (run===0||run===1){sP++; run=1;} else break; }
      else if (O & b){ if (run===0||run===2){sO++; run=2;} else break; }
      else break;
    }
  }
  return { sP, sO };
}

function frontierDiff(P, O) {
  const empty = ~(P | O) & FULL;
  const adj = shift(empty,DIRS.N)|shift(empty,DIRS.S)|shift(empty,DIRS.E)|shift(empty,DIRS.W)
            | shift(empty,DIRS.NE)|shift(empty,DIRS.NW)|shift(empty,DIRS.SE)|shift(empty,DIRS.SW);
  const myF = popcount(P & adj), opF = popcount(O & adj);
  return -100 * (myF - opF) / (myF + opF + 1);
}

function evaluate(P, O) {
  const empties = 64 - popcount(P | O);
  const phase = empties / 64;

  const myC = popcount(P & CORNERS), opC = popcount(O & CORNERS);
  let score = 100 * (myC - opC);

  for (const {corner,x,c} of CORNER_CFG) {
    if (!(P & corner) && !(O & corner)) {
      score -= 35 * popcount(P & x) + 15 * popcount(P & c);
      score += 35 * popcount(O & x) + 15 * popcount(O & c);
    }
  }

  const myMob = popcount(legalMoves(P, O)), opMob = popcount(legalMoves(O, P));
  score += 2 * (myMob - opMob);

  const { sP, sO } = edgeStableApprox(P, O);
  score += 4 * (sP - sO);

  score += 0.25 * frontierDiff(P, O);
  score += (popcount(P) - popcount(O)) * (1 - phase) * 4;

  return Math.round(score);
}

// ---------------- Search ----------------
const INF = 1e9;
const TT = new Map();
const ttKey = (P,O,turn)=>`${P.toString(16)}_${O.toString(16)}_${turn?1:0}`;

function genMovesBB(P, O){ const bb = legalMoves(P,O); const ms=[]; let m=bb; while(m){ const b=m & -m; ms.push(b); m^=b; } return ms; }
function orderMoves(moves){ return moves.sort((a,b)=> Number((b&CORNERS)?1n:0n)-Number((a&CORNERS)?1n:0n)); }
function givesOpponentCorner(P, O, mv){ const [nO,nP]=playMove(P,O,mv); return !!(legalMoves(nO,nP) & CORNERS); }

function negamax(st, depth, alpha, beta, deadline){
  const { P,O,blackTurn } = st;
  if (performance.now() > deadline) throw new Error("TIME");

  const key = ttKey(P,O,blackTurn), hit = TT.get(key);
  if (hit && hit.depth >= depth){
    if (hit.flag===0) return hit.score;
    if (hit.flag===-1 && hit.score<=alpha) return hit.score;
    if (hit.flag=== 1 && hit.score>=beta ) return hit.score;
  }

  const myMoves = legalMoves(P,O);
  if (!myMoves){
    const oppMoves = legalMoves(O,P);
    if (!oppMoves){
      const discs = popcount(P) - popcount(O);
      return discs * 10000;
    }
    return -negamax({P:O,O:P,blackTurn:!blackTurn}, depth, -beta, -alpha, deadline);
  }

  if (depth===0) return evaluate(P,O);

  let best = -INF, a0 = alpha;
  const moves = orderMoves(genMovesBB(P,O));
  for (const mv of moves){
    const [nO,nP] = playMove(P,O,mv);
    let val = -negamax({P:nP,O:nO,blackTurn:!blackTurn}, depth-1, -beta, -alpha, deadline);
    if (givesOpponentCorner(P,O,mv)) val -= 200;
    if (val>best) best=val;
    if (best>alpha) alpha=best;
    if (alpha>=beta) break;
  }

  let flag = 0;
  if (best <= a0) flag = -1; else if (best >= beta) flag = 1;
  TT.set(key, {depth, flag, score:best});
  return best;
}

function searchBestMove(P,O,blackTurn,ms){
  const start = performance.now(), deadline = start + ms;
  let bestMove=0n, bestScore=-INF, depth=2;
  const base = genMovesBB(P,O);
  if (base.length===0) return 0n;
  if (base.length===1) return base[0];

  try{
    while(true){
      let localBest=0n, localScore=-INF, alpha=-INF, beta=INF;
      const ordered = orderMoves([...base]);
      for (const mv of ordered){
        const [nO,nP] = playMove(P,O,mv);
        let s = -negamax({P:nP,O:nO,blackTurn:!blackTurn}, depth-1, -beta, -alpha, deadline);
        if (givesOpponentCorner(P,O,mv)) s -= 200;
        if (s>localScore){ localScore=s; localBest=mv; }
        if (localScore>alpha) alpha=localScore;
        if (alpha>=beta) break;
      }
      bestMove=localBest; bestScore=localScore; depth++;
      if (performance.now() > deadline) break;
      const empties = 64 - popcount(P|O);
      if (empties<=14) depth++;
    }
  }catch(_){}
  return bestMove || base[0];
}

// ---------------- UI ----------------
const START_BLACK = 0x0000000810000000n;
const START_WHITE = 0x0000001008000000n;

function startPosition(){ return { P:START_BLACK, O:START_WHITE, blackTurn:true }; }

export default function OthelloReversi(){
  const [state, setState] = useState(startPosition());
  const [humanIsBlack, setHumanIsBlack] = useState(true);
  const [thinkingMs, setThinkingMs] = useState(1800);
  const [showMoves, setShowMoves] = useState(true);
  const [spectate, setSpectate] = useState(false);

  const { P,O,blackTurn } = state;
  const humansTurn = spectate ? false : ((humanIsBlack && blackTurn) || (!humanIsBlack && !blackTurn));
  const legal = useMemo(()=> (blackTurn ? legalMoves(P,O) : legalMoves(O,P)), [P,O,blackTurn]);
  const discs = useMemo(()=> ({ black: popcount(P), white: popcount(O) }), [P,O]);
  const gameOver = useMemo(()=> !legalMoves(P,O) && !legalMoves(O,P), [P,O]);
  const winner = gameOver ? (discs.black===discs.white ? "引き分け" : (discs.black>discs.white?"黒の勝ち":"白の勝ち")) : null;

  // AI
  useEffect(()=>{
    if (gameOver) return;
    const aiTurn = !humansTurn || spectate;
    if (!aiTurn) return;

    const bb = blackTurn ? legalMoves(P,O) : legalMoves(O,P);
    if (!bb){ const t=setTimeout(()=>setState(s=>({...s, blackTurn:!s.blackTurn})), 120); return ()=>clearTimeout(t); }

    let cancelled=false;
    (async()=>{
      await new Promise(r=>setTimeout(r, spectate?40:100));
      if (cancelled) return;
      const ms = Math.min(10000, Math.max(400, spectate?600:thinkingMs));
      if (blackTurn){
        const mv = searchBestMove(P,O,true,ms);
        const [nW,nB] = playMove(P,O,mv);
        if (!cancelled) setState({P:nB,O:nW,blackTurn:false});
      }else{
        const mv = searchBestMove(O,P,false,ms);
        const [nB,nW] = playMove(O,P,mv);
        if (!cancelled) setState({P:nB,O:nW,blackTurn:true});
      }
    })();
    return ()=>{ cancelled=true; };
  }, [P,O,blackTurn,humansTurn,spectate,thinkingMs,gameOver]);

  // Auto-pass
  useEffect(()=>{
    if (!humansTurn || gameOver) return;
    const bb = blackTurn? legalMoves(P,O):legalMoves(O,P);
    if (!bb){
      const t=setTimeout(()=>setState(s=>({...s, blackTurn:!s.blackTurn})), 150);
      return ()=>clearTimeout(t);
    }
  }, [P,O,blackTurn,humansTurn,gameOver]);

  function onCell(r,c){
    if (!humansTurn || gameOver) return;
    const bit = bitAt(r,c);
    if (blackTurn){
      const bb = legalMoves(P,O); if (!(bit & bb)) return;
      const [nW,nB] = playMove(P,O,bit); setState({P:nB,O:nW,blackTurn:false});
    }else{
      const bb = legalMoves(O,P); if (!(bit & bb)) return;
      const [nB,nW] = playMove(O,P,bit); setState({P:nB,O:nW,blackTurn:true});
    }
  }

  function reset(){ TT.clear(); setState(startPosition()); }

  function aiStepOnce(){
    if (gameOver) return;
    const bb = blackTurn? legalMoves(P,O):legalMoves(O,P);
    if (!bb){ setState(s=>({...s, blackTurn:!s.blackTurn})); return; }
    if (blackTurn){ const mv=searchBestMove(P,O,true,800); const [nW,nB]=playMove(P,O,mv); setState({P:nB,O:nW,blackTurn:false}); }
    else { const mv=searchBestMove(O,P,false,800); const [nB,nW]=playMove(O,P,mv); setState({P:nB,O:nW,blackTurn:true}); }
  }

  function runToEndFast(){
    let s={...state}; let safety=200; TT.clear();
    while(safety-->0){
      const bb = s.blackTurn? legalMoves(s.P,s.O):legalMoves(s.O,s.P);
      if (!bb){
        const opp = s.blackTurn? legalMoves(s.O,s.P):legalMoves(s.P,s.O);
        if (!opp) break;
        s.blackTurn=!s.blackTurn; continue;
      }
      if (s.blackTurn){ const mv=searchBestMove(s.P,s.O,true,500); const [nW,nB]=playMove(s.P,s.O,mv); s={P:nB,O:nW,blackTurn:false}; }
      else { const mv=searchBestMove(s.O,s.P,false,500); const [nB,nW]=playMove(s.O,s.P,mv); s={P:nB,O:nW,blackTurn:true}; }
    }
    setState(s);
  }

  const size = 420, cell = size/8;

  return (
    <div style={{minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center", padding:16}}>
      <div className="panel">
        <h1 style={{fontSize:22, fontWeight:700}}>Othello / Reversi（強化AI・アニメ）</h1>
        <div style={{opacity:0.7, fontSize:13}}>角献上を避け、X/Cを回避。観戦ONでAI同士。</div>

        <div style={{display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center"}}>
          <button onClick={reset}>リセット</button>
          <button onClick={()=>setHumanIsBlack(v=>!v)}>あなた：{humanIsBlack?"黒":"白"}</button>
          <label style={{display:"flex", gap:8, alignItems:"center"}}>
            思考時間 {Math.round(thinkingMs)}ms
            <input type="range" min={400} max={10000} value={thinkingMs} onChange={e=>setThinkingMs(Number(e.target.value))} />
          </label>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" checked={showMoves} onChange={e=>setShowMoves(e.target.checked)} /> 合法手を表示
          </label>
          <label style={{display:"flex", gap:6, alignItems:"center"}}>
            <input type="checkbox" checked={spectate} onChange={e=>setSpectate(e.target.checked)} /> 観戦（AI同士）
          </label>
          <button onClick={aiStepOnce}>1手進める</button>
          <button onClick={runToEndFast}>最後まで</button>
        </div>

        <div style={{position:"relative", width:size, height:size}}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <rect x="0" y="0" width={size} height={size} fill="#0a6e2f" />
            {Array.from({length:9},(_,i)=>(
              <line key={`v-${i}`} x1={i*cell} y1={0} x2={i*cell} y2={size} stroke="rgba(0,0,0,0.6)" strokeWidth="1" />
            ))}
            {Array.from({length:9},(_,i)=>(
              <line key={`h-${i}`} x1={0} y1={i*cell} x2={size} y2={i*cell} stroke="rgba(0,0,0,0.6)" strokeWidth="1" />
            ))}
            {[ [2,2],[2,6],[6,2],[6,6] ].map(([r,c],i)=>(
              <circle key={`star-${i}`} cx={(c+0.5)*cell} cy={(r+0.5)*cell} r={3} fill="rgba(0,0,0,0.6)" />
            ))}

            {Array.from({length:8}).flatMap((_,r)=>Array.from({length:8}).map((_,c)=>{
              const b = bitAt(r,c);
              const hasB = (P & b) !== 0n;
              const hasW = (O & b) !== 0n;
              const isLegal = (legal & b) !== 0n;
              return (
                <g key={`${r}-${c}`} onClick={()=>onCell(r,c)} style={{cursor:isLegal?'pointer':'default'}}>
                  <rect x={c*cell} y={r*cell} width={cell} height={cell} fill="transparent" />
                  <AnimatePresence>
                    {isLegal && (
                      <motion.circle
                        key={`hint-${r}-${c}`}
                        cx={(c+0.5)*cell} cy={(r+0.5)*cell} r={6}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 0.7 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        fill="rgba(255,255,255,0.7)"
                      />
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {hasB && (
                      <motion.circle
                        key={`b-${r}-${c}`}
                        cx={(c+0.5)*cell} cy={(r+0.5)*cell} r={cell*0.42}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 600, damping: 30 }}
                        fill="#111"
                      />
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {hasW && (
                      <motion.circle
                        key={`w-${r}-${c}`}
                        cx={(c+0.5)*cell} cy={(r+0.5)*cell} r={cell*0.42}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 600, damping: 30 }}
                        fill="#fafafa"
                      />
                    )}
                  </AnimatePresence>
                </g>
              );
            }))}
          </svg>
        </div>

        <div style={{display:"flex", gap:16, fontSize:13}}>
          <div>● 黒: {discs.black}</div>
          <div>○ 白: {discs.white}</div>
          <div>手番: {blackTurn ? "黒" : "白"}</div>
          {gameOver && <div style={{fontWeight:600}}>{winner}</div>}
        </div>
      </div>
    </div>
  );
}

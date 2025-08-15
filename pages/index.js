
import { useMemo, useState, useEffect } from "react";

/** ---------------------- Utilities & Types ---------------------- */
const SUITS = ["♣", "♦", "♥", "♠"];
const RANKS = [1,2,3,4,5,6,7,8,9,10,11,12,13]; // 1=A, 11=J,12=Q,13=K

const rankLabel = (r) => r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r);
const cardToString = (c) => `${rankLabel(c.r)}${c.s}`;
const cardValue15 = (r) => (r > 10 ? 10 : r);

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return d;
}

function shuffle(arr, rng) { // Fisher-Yates
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seededRng(seed) { // Mulberry32
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ---------------------- Combinatorics & Scoring ---------------------- */
function combos(arr) {
  const res = [];
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(arr[i]);
    res.push(subset);
  }
  return res;
}

function count15(cards) {
  let pts = 0;
  for (const subset of combos(cards)) {
    const sum = subset.reduce((a, c) => a + cardValue15(c.r), 0);
    if (sum === 15) pts += 2;
  }
  return pts;
}

function countPairs(cards) {
  let pts = 0;
  const ranks = {};
  for (const c of cards) ranks[c.r] = (ranks[c.r] || 0) + 1;
  for (const k in ranks) {
    const n = ranks[k];
    if (n >= 2) pts += (n * (n - 1)) / 2 * 2; // each pair 2 points
  }
  return pts;
}

function countRuns(cards) {
  // Runs anywhere (hand/crib scoring). Accounts for duplicates correctly.
  const byRank = {};
  for (const c of cards) byRank[c.r] = (byRank[c.r] || 0) + 1;
  const unique = Object.keys(byRank).map(Number).sort((a,b)=>a-b);
  let bestLen = 0, total = 0, i = 0;
  while (i < unique.length) {
    let j = i;
    while (j + 1 < unique.length && unique[j + 1] === unique[j] + 1) j++;
    const runLen = j - i + 1;
    if (runLen >= 3) {
      const mult = unique.slice(i, j + 1).reduce((m, r) => m * byRank[r], 1);
      if (runLen > bestLen) { bestLen = runLen; total = runLen * mult; }
      else if (runLen === bestLen) total += runLen * mult;
    }
    i = j + 1;
  }
  return total;
}

function flushPoints(hand, starter, isCrib) {
  const suits = hand.map(c=>c.s);
  const allSame = suits.every(s => s === suits[0]);
  if (!allSame) return 0;
  if (starter && starter.s === suits[0]) return 5;
  return isCrib ? 0 : 4;
}

function knobsPoints(hand, starter) {
  if (!starter) return 0;
  return hand.some(c => c.r === 11 && c.s === starter.s) ? 1 : 0;
}

// House rule: +3 for each distinct 7-9-8 triple in the five cards
const HOUSE_798 = true;
function hull798Bonus(allFive){
  if (!HOUSE_798) return 0;
  const cnt = {7:0,8:0,9:0};
  for (const c of allFive) if (cnt.hasOwnProperty(c.r)) cnt[c.r]++;
  return 3 * (cnt[7] * cnt[8] * cnt[9]);
}

function handPoints(hand4, starter, isCrib) {
  const all = hand4.concat([starter]);
  return count15(all) + countPairs(all) + countRuns(all) + flushPoints(hand4, starter, isCrib) + knobsPoints(hand4, starter) + hull798Bonus(all);
}

/** ---------------------- Pegging Logic ---------------------- */
function legalPlays(hand, total) {
  return hand.filter(c => total + cardValue15(c.r) <= 31);
}

function isPairRunPoints(stack, nextCard) {
  const seq = stack.concat([nextCard]);
  let pts = 0;

  // Pairs/trips/quads at end
  let k = seq.length - 1, same = 1;
  while (k - 1 >= 0 && seq[k - 1].r === seq[k].r) { same++; k--; }
  if (same === 2) pts += 2; else if (same === 3) pts += 6; else if (same === 4) pts += 12;

  // Runs: check longest tail length 3..N (any order in tail)
  for (let l = Math.min(7, seq.length); l >= 3; l--) {
    const tail = seq.slice(seq.length - l);
    const ranks = tail.map(c=>c.r).sort((a,b)=>a-b);
    let run = true;
    for (let i=1;i<ranks.length;i++) if (ranks[i] !== ranks[i-1] + 1) { run = false; break; }
    if (run) { pts += l; break; }
  }
  return pts;
}

function applyPlay(state, card, who) {
  const newTotal = state.total + cardValue15(card.r);
  const points15or31 = (newTotal === 15 ? 2 : 0) + (newTotal === 31 ? 2 : 0);
  const pairRun = isPairRunPoints(state.stack, card);
  const points = points15or31 + pairRun;
  const thirtyOne = newTotal === 31;
  return {
    ...state,
    stack: state.stack.concat([card]),
    total: newTotal,
    pHand: who === "P" ? state.pHand.filter(c=>c!==card) : state.pHand,
    aiHand: who === "AI" ? state.aiHand.filter(c=>c!==card) : state.aiHand,
    next: who === "P" ? "AI" : "P",
    pPassed: false,
    aiPassed: false,
    points,
    thirtyOne,
  };
}

/** ---------------------- AI (Optimal given seen info) ---------------------- */
function cardsEqual(a,b){ return a.r===b.r && a.s===b.s; }
function minus(set, rem){ return set.filter(c => !rem.some(r => cardsEqual(r, c))); }

function chooseDiscardsAI(aiHand6, seen, isDealer, sims, rng) {
  const all6 = aiHand6.slice();
  const choices = [];
  for (let i=0;i<6;i++) for (let j=i+1;j<6;j++) choices.push([all6[i], all6[j]]);
  const deck = minus(makeDeck(), seen.concat(all6));

  let bestScore = -1e9, best = { keep: all6.slice(0,4), toCrib: all6.slice(4) };

  for (const toss of choices) {
    const keep = minus(all6, toss);
    let sum = 0;
    for (let s=0; s<sims; s++) {
      const d = shuffle(deck, rng);
      const starter = d[0];
      const handPts = handPoints(keep, starter, false);
      const oppTwo = [d[1], d[2]];
      const cribCards = isDealer ? toss.concat(oppTwo) : oppTwo.concat(toss);
      const cribPts = handPoints(cribCards.slice(0,4), starter, true);
      sum += handPts + (isDealer ? cribPts : -cribPts * 0.9);
    }
    const ev = sum / sims;
    if (ev > bestScore) { bestScore = ev; best = { keep, toCrib: toss }; }
  }
  return best;
}

function aiPeggingMove(state, sims, rng) {
  const legal = legalPlays(state.aiHand, state.total);
  if (legal.length === 0) return { card: null, expected: 0 };

  const seenNow = state.seen.concat(state.stack);
  const maskedUnseen = minus(makeDeck(), seenNow.concat(state.aiHand));

  function rollout(play) {
    let totalScore = 0;
    for (let s=0; s<sims; s++) {
      const d = shuffle(maskedUnseen, rng);
      const oppCount = state.pHand.length;
      const oppSample = d.slice(0, oppCount);

      let turn = "P"; // after AI plays
      let total = state.total + cardValue15(play.r);
      let stack = state.stack.concat([play]);
      let aiRem = state.aiHand.filter(c=>c!==play);
      let pOptions = oppSample.slice();
      let aiPts = (total === 15 ? 2 : 0) + (total === 31 ? 2 : 0) + isPairRunPoints(state.stack, play);
      let pPassed = false, aiPassed = false;
      let lastMover = "AI";

      if (total === 31) { totalScore += aiPts + 1; continue; }

      while (true) {
        if (turn === "P") {
          const pLegal = pOptions.filter(c => total + cardValue15(c.r) <= 31);
          if (pLegal.length === 0) {
            if (aiPassed) { if (lastMover === "AI") aiPts += 1; break; }
            pPassed = true; turn = "AI"; continue;
          } else {
            pPassed = false;
            // opponent chooses max immediate points
            let best = null, bestPts = -1;
            for (const c of pLegal) {
              const t2 = total + cardValue15(c.r);
              const pts = (t2 === 15 ? 2 : 0) + (t2 === 31 ? 2 : 0) + isPairRunPoints(stack, c);
              if (pts > bestPts) { bestPts = pts; best = c; }
            }
            const playC = best;
            total += cardValue15(playC.r);
            aiPts -= bestPts;
            stack = stack.concat([playC]);
            pOptions = pOptions.filter(c=>c!==playC);
            lastMover = "P";
            if (total === 31) { break; }
            turn = "AI";
          }
        } else {
          const aiLegal = aiRem.filter(c => total + cardValue15(c.r) <= 31);
          if (aiLegal.length === 0) {
            if (pPassed) { if (lastMover === "AI") aiPts += 1; break; }
            aiPassed = true; turn = "P"; continue;
          } else {
            aiPassed = false;
            let best = null, bestPts = -1, bestTotal = 0;
            for (const c of aiLegal) {
              const t2 = total + cardValue15(c.r);
              const pts = (t2 === 15 ? 2 : 0) + (t2 === 31 ? 2 : 0) + isPairRunPoints(stack, c);
              if (pts > bestPts || (pts === bestPts && t2 > bestTotal)) { bestPts = pts; best = c; bestTotal = t2; }
            }
            const play2 = best;
            total += cardValue15(play2.r);
            aiPts += bestPts;
            stack = stack.concat([play2]);
            aiRem = aiRem.filter(c=>c!==play2);
            lastMover = "AI";
            if (total === 31) { break; }
            turn = "P";
          }
        }
      }
      totalScore += aiPts;
    }
    return totalScore / sims;
  }

  let best = null, bestEV = -1e9;
  for (const c of legal) {
    const ev = rollout(c);
    if (ev > bestEV) { bestEV = ev; best = c; }
  }
  return { card: best, expected: bestEV };
}

/** ---------------------- Game State Hook ---------------------- */
function useCribbageGame() {
  const [seed, setSeed] = useState(()=>Math.floor(Math.random()*1e9));
  const rng = useMemo(()=>seededRng(seed), [seed]);

  const [dealer, setDealer] = useState(Math.random()<0.5 ? "AI" : "P");
  const [deck, setDeck] = useState(()=>shuffle(makeDeck(), rng));
  const [pHand, setPHand] = useState([]);
  const [aiHand, setAIHand] = useState([]);
  const [crib, setCrib] = useState([]); // AI's two + player's two
  const [starter, setStarter] = useState(null);
  const [phase, setPhase] = useState("deal");
  const [scores, setScores] = useState({ P: 0, AI: 0 });
  const [prevScores, setPrevScores] = useState({ P: 0, AI: 0 });
  const [log, setLog] = useState([]);
  const [peg, setPeg] = useState(null);
  const [mcDiscard, setMcDiscard] = useState(400);
  const [mcPeg, setMcPeg] = useState(180);
  const [showHands, setShowHands] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);

  function addScore(who, delta) {
    if (delta <= 0 || gameOver) return;
    setScores(s => {
      const nextVal = Math.min(120, s[who] + delta);
      const next = { ...s, [who]: nextVal };
      setPrevScores(s);
      if (!gameOver && nextVal >= 120) { setGameOver(true); setWinner(who); }
      return next;
    });
  }

  function logLine(s){ setLog(l=>[s, ...l].slice(0,300)); }

  function redeal() {
    const d = shuffle(makeDeck(), rng);
    setDeck(d); setPHand([]); setAIHand([]); setCrib([]); setStarter(null);
    setPhase("deal");
  }

  function deal() {
    let d = deck.slice();
    const p = [], a = [];
    for (let i=0;i<6;i++) { a.push(d.pop()); p.push(d.pop()); }
    setDeck(d); setPHand(p); setAIHand(a); setCrib([]); setPhase("discard");
    logLine(`Dealt hands. ${dealer} is dealer.`);
  }

  function aiChooseDiscards() {
    const seen = [];
    const { keep, toCrib } = chooseDiscardsAI(aiHand, seen, dealer === "AI", mcDiscard, rng);
    setAIHand(keep);
    setCrib(c => c.concat(toCrib));
    logLine(`AI discards ${toCrib.map(cardToString).join(" ")}`);
  }

  function cutStarter() {
    const d = deck.slice();
    const cut = d.pop();
    setStarter(cut); setDeck(d);
    if (cut.r === 11) { addScore(dealer, 2); logLine(`${dealer} scores 2 for his heels (Jack cut).`); }
    const seen = crib.concat([cut]);
    const pState = {
      stack: [], total: 0, pHand: pHand, aiHand: aiHand, seen, starter: cut,
      next: dealer === "AI" ? "P" : "AI", pPassed: false, aiPassed: false,
    };
    setPeg(pState); setPhase("pegging");
  }

  function endPeggingAndScoreHands(finalPeg) {
    if (finalPeg.total > 0 && finalPeg.total < 31 && (finalPeg.pPassed || finalPeg.aiPassed)) {
      const last = finalPeg.pPassed ? "AI" : "P";
      addScore(last, 1);
      logLine(`${last} scores 1 for last card.`);
    }
    setPhase("show");
    const pone = dealer === "AI" ? "P" : "AI";
    const poneHand = pone === "P" ? pHand : aiHand;
    const dealerHand = dealer === "P" ? pHand : aiHand;
    const st = starter;
    const ponePts = handPoints(poneHand, st, false);
    const dealerPts = handPoints(dealerHand, st, false);
    const cribPts = handPoints(crib, st, true);

    addScore(pone, ponePts);
    addScore(dealer, dealerPts);
    addScore(dealer, cribPts);

    logLine(`Crib (${dealer}): ${crib.map(cardToString).join(" ")} + ${cardToString(st)} = ${cribPts}`);
    logLine(`${dealer} hand: ${dealerHand.map(cardToString).join(" ")} + ${cardToString(st)} = ${dealerPts}`);
    logLine(`${pone} hand: ${poneHand.map(cardToString).join(" ")} + ${cardToString(st)} = ${ponePts}`);

    setTimeout(()=>{
      if (!gameOver) { setDealer(d => d === "AI" ? "P" : "AI"); redeal(); }
    }, 2000);
  }

  function playPegCard(card) {
    if (gameOver) return;
    if (!peg) return;
    const who = peg.next;
    const s1 = applyPlay(peg, card, who);
    const player = who;
    const gain = s1.points;
    setPeg({ ...s1 });
    if (gain) {
      addScore(player, gain);
      logLine(`${player} plays ${cardToString(card)} for +${gain} (total ${s1.total}).`);
    } else {
      logLine(`${player} plays ${cardToString(card)} (total ${s1.total}).`);
    }
    if (s1.thirtyOne) {
      setPeg(ps => ps ? { ...ps, stack: [], total: 0, pPassed: false, aiPassed: false } : null);
      return;
    }
    if (s1.pHand.length === 0 && s1.aiHand.length === 0) { endPeggingAndScoreHands(s1); return; }
  }

  function declareGo(who) {
    if (gameOver) return;
    if (!peg) return;
    const other = who === "P" ? "AI" : "P";
    if (who === "P") {
      const pLegal = legalPlays(peg.pHand, peg.total);
      if (pLegal.length > 0) return;
      setPeg({ ...peg, pPassed: true, next: other });
      logLine(`P says Go.`);
    } else {
      const aLegal = legalPlays(peg.aiHand, peg.total);
      if (aLegal.length > 0) return;
      setPeg({ ...peg, aiPassed: true, next: other });
      logLine(`AI says Go.`);
    }
    setTimeout(()=>{
      setPeg(ps => {
        if (!ps) return ps;
        if (ps.pPassed && ps.aiPassed) {
          const last = ps.next === "P" ? "AI" : "P";
          addScore(last, 1);
          logLine(`${last} scores 1 for last card (Go).`);
          const ns = { ...ps, stack: [], total: 0, pPassed: false, aiPassed: false };
          if (ns.pHand.length === 0 && ns.aiHand.length === 0) {
            setTimeout(()=>{ endPeggingAndScoreHands(ns); }, 0);
          }
          return ns;
        }
        return ps;
      });
    }, 250);
  }

  function aiTakePegTurn() {
    if (gameOver) return;
    if (aiBusy) return;
    setAiBusy(true);
    setPeg(ps => {
      if (!ps) { setAiBusy(false); return ps; }
      if (ps.next !== "AI") { setAiBusy(false); return ps; }
      const legal = legalPlays(ps.aiHand, ps.total);
      if (legal.length === 0) { setAiBusy(false); declareGo("AI"); return ps; }
      const { card } = aiPeggingMove(ps, mcPeg, rng);
      if (card) {
        playPegCard(card);
      } else {
        declareGo("AI");
      }
      setTimeout(()=>setAiBusy(false), 0);
      return ps;
    });
  }

  useEffect(()=>{ if (phase === "discard" && aiHand.length === 6) aiChooseDiscards(); }, [phase]);
  useEffect(()=>{ if (phase === "deal") deal(); }, [phase]);
  useEffect(()=>{ if (phase === "pegging" && peg?.next === "AI" && !aiBusy) aiTakePegTurn(); }, [phase, peg?.next, aiBusy]);

  return {
    dealer, deck, pHand, aiHand, crib, starter, phase, scores, prevScores, log, gameOver, winner,
    setShowHands, showHands, setMcDiscard, setMcPeg, mcDiscard, mcPeg,
    cutStarter, declareGo, playPegCard, redeal, peg,
    commitDiscardsSelected: (selectedTwo) => {
      if (!selectedTwo || selectedTwo.length !== 2) return;
      setCrib(c => c.concat(selectedTwo));
      setPHand(pHand.filter(c => !selectedTwo.some(x => x.r===c.r && x.s===c.s)));
      setPhase("cut");
    }
  };
}


/** ---------------------- Cribbage Board (3‑Track SVG with Finish & Arrows) ---------------------- */
function threeTrackLayout(cols = 40) {
  // Indices: 0–39 top (L→R), 40–79 bottom (R→L), 80–120 middle (L→R)
  const gapX = 18;
  const left = 24;
  const topY = 28;
  const rowGap = 44;
  const yTop = topY;
  const yMid = topY + rowGap;
  const yBot = topY + rowGap * 2;

  function segFor(i) { return i < cols ? 0 : (i < cols*2 ? 1 : 2); }
  function colInSeg(i) {
    const seg = segFor(i);
    const idx = seg === 0 ? i : (seg === 1 ? i - cols : i - cols*2);
    return seg === 1 ? cols - 1 - idx : idx;
  }

  function xFor(i) { return left + Math.min(colInSeg(i), cols) * gapX; }
  function yForSeg(i) {
    const seg = segFor(i);
    return seg === 0 ? yTop : (seg === 1 ? yBot : yMid);
  }

  return { xFor, yForSeg, yTop, yMid, yBot, left, gapX, cols };
}

function CribbageBoard({ scores, prevScores }) {
  const { xFor, yForSeg, yTop, yMid, yBot, left, gapX, cols } = threeTrackLayout(40);
  const width  = left + 40 * gapX + 24;
  const height = yBot + 28;

  // Holes
  const holes = [];
  for (let c = 0; c < cols; c++) { const x = left + c * gapX; holes.push(<circle key={"t"+c} cx={x} cy={yTop} r={3} fill="#94a3b8" />); }
  for (let c = 0; c < cols; c++) { const x = left + c * gapX; holes.push(<circle key={"b"+c} cx={x} cy={yBot} r={3} fill="#94a3b8" />); }
  for (let c = 0; c <= cols; c++) { const x = left + c * gapX; holes.push(<circle key={"m"+c} cx={x} cy={yMid} r={3} fill="#94a3b8" />); }

  // Divider ticks every 5
  const ticks = [];
  for (let i = 5; i <= 120; i += 5) {
    const x = xFor(i);
    const y = yForSeg(i);
    ticks.push(<line key={"tick"+i} x1={x} y1={y-10} x2={x} y2={y+10} stroke="#cbd5e1" strokeWidth="1" />);
  }

  // Skunk ticks (short vertical)
  const skunks = [
    <line key="ds60" x1={xFor(60)} y1={yBot-6} x2={xFor(60)} y2={yBot+6} stroke="#dc2626" strokeWidth="2" />,
    <line key="sk90" x1={xFor(90)}  y1={yMid-6} x2={xFor(90)}  y2={yMid+6} stroke="#ef4444" strokeWidth="2" />,
  ];

  // Path arrows
  const xr = xFor(39); // top-right end
  const xl = xFor(79); // bottom-left end
  const arrows = [
    <g key="ar1">
      <line x1={xr} y1={yTop+10} x2={xr} y2={yBot-10} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 3" />
      <polygon points={`${xr-4},${yBot-10} ${xr+4},${yBot-10} ${xr},${yBot-4}`} fill="#64748b" />
    </g>,
    <g key="ar2">
      <line x1={xl} y1={yBot-10} x2={xl} y2={yMid+10} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 3" />
      <polygon points={`${xl-4},${yMid+10} ${xl+4},${yMid+10} ${xl},${yMid+4}`} fill="#64748b" />
    </g>,
  ];

  // Finish hole (index 120)
  const xf = xFor(120);
  const finish = (
    <g key="finish">
      <circle cx={xf} cy={yMid} r={7} fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
      <text x={xf+10} y={yMid+4} fontSize="12" fill="#92400e" style={{fontWeight:700}}>FINISH</text>
    </g>
  );

  // Pegs (offset above/below holes) — always show two for AI and two for Player.
  const GOLD = "#c9b037";   // AI
  const SILVER = "#b7b7b7"; // Player

  // Small x-offset for "trail" peg so both pegs are visible when overlapping.
  const TRAIL_SHIFT = -3;

  const peg = (i, color, dy, xShift=0, r = 6) => {
    const idx = Math.max(0, Math.min(120, i));
    const x = xFor(idx) + xShift;
    const y = yForSeg(idx) + dy;
    return <circle cx={x} cy={y} r={r} fill={color} stroke="#111827" strokeWidth="1" />;
  };

  return (
    <div style={{ width: "100%", padding: 8, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <svg width="100%" height="300" viewBox={`0 0 ${width} ${height}`}>
        <rect x="8" y="8" width={width-16} height={height-16} rx="12" ry="12" fill="#f1f5f9" stroke="#e2e8f0" />
        {ticks}
        {skunks}
        {arrows}
        {holes}
        {finish}

        {/* AI gold: trail (shifted) then lead — ABOVE holes (dy = -7) */}
        {peg(prevScores?.AI ?? 0, GOLD, -7, TRAIL_SHIFT, 6)}
        {peg(scores?.AI ?? 0,     GOLD, -7, 0,           6)}

        {/* Player silver: trail (shifted) then lead — BELOW holes (dy = +7). Starts on TOP row because yForSeg(0) == yTop */}
        {peg(prevScores?.P ?? 0, SILVER, +7, TRAIL_SHIFT, 6)}
        {peg(scores?.P ?? 0,     SILVER, +7, 0,           6)}
      </svg>
    </div>
  );
}

/** ---------------------- UI Components ---------------------- */
function CardView({ card, selectable=false, selected=false, onClick }) {
  const isRed = card.s === "♥" || card.s === "♦";
  const style = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 48, height: 64, borderRadius: 12, border: "1px solid #e5e7eb",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)", background: "white", marginRight: 8, marginBottom: 8,
    cursor: selectable ? "pointer" : "default", transform: selectable ? "translateY(0)" : "none", position: "relative"
  };
  return (
    <div onClick={onClick} style={style}>
      <div style={{ textAlign: "center", color: isRed ? "#ef4444" : "#111827" }}>
        <div style={{ fontWeight: 600, lineHeight: "1rem" }}>{rankLabel(card.r)}</div>
        <div style={{ fontSize: 18 }}>{card.s}</div>
        {selected && <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: "0 0 0 2px #6366f1 inset" }} />}
      </div>
    </div>
  );
}

function HandRow({ title, cards, selectable=false, selectedIds=[], onCardClick }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {cards.map((c,i)=> (
          <CardView key={i} card={c} selectable={selectable} selected={selectedIds.includes(cardToString(c))} onClick={()=>onCardClick && onCardClick(c)} />
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const G = useCribbageGame();
  const [discardSel, setDiscardSel] = useState([]);
  useEffect(()=>{ if (G.phase !== "discard") setDiscardSel([]); }, [G.phase]);
  const canCommit = G.phase === "discard" && discardSel.length === 2;
  const pegLegal = G.peg ? legalPlays(G.peg.pHand, G.peg.total) : [];

  return (
    <main style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f8fafc, #eef2ff)", padding: 16 }}>
      <div style={{textAlign:'center', fontSize: 28, fontWeight: 900, marginBottom: 12}}>Ahhh the fragility of lesser minds</div>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Cribbage vs Computer</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}>
            <div>AI sims — Peg: <input aria-label="AI Peg Sims" type="range" min="60" max="500" step="10" value={G.mcPeg} onChange={(e)=>G.setMcPeg(parseInt(e.target.value))} /></div>
            <div>Discard: <input aria-label="AI Discard Sims" type="range" min="200" max="2000" step="100" value={G.mcDiscard} onChange={(e)=>G.setMcDiscard(parseInt(e.target.value))} /></div>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={G.showHands} onChange={(e)=>G.setShowHands(e.target.checked)} />
              Show AI hand
            </label>
            <button onClick={G.redeal} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white" }}>New Deal</button>
          </div>
        </header>

        {G.gameOver && (
          <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', color:'#9a3412', padding:10, borderRadius:8, marginBottom:8, fontWeight:700 }}>
            GAME OVER — {G.winner === 'P' ? 'You win!' : 'AI wins!'}
          </div>
        )}
        <div style={{ fontSize: 14, color: "#374151", marginBottom: 8 }}>
          Dealer: <b>{G.dealer}</b> &nbsp;•&nbsp; Phase: <b>{G.phase}</b> &nbsp;•&nbsp; Scores — You: <b>{G.scores.P}</b> · AI: <b>{G.scores.AI}</b>
        </div>

        {/* Three-track board with finish & path arrows */}
        <div style={{ marginTop: 10, marginBottom: 10 }}>
          <CribbageBoard scores={G.scores} prevScores={G.prevScores} />
        </div>

        {G.starter && <div style={{ fontSize: 14, marginBottom: 6 }}>Starter: <b>{cardToString(G.starter)}</b></div>}
        {G.phase === "pegging" && G.peg && (
          <div style={{ fontSize: 14, marginBottom: 6 }}>Count: <b>{G.peg.total}</b> — Next: <b>{G.peg.next}</b></div>
        )}

        {G.phase !== "discard" && (
          <HandRow title={G.showHands ? "AI Hand (shown)" : "AI Hand"} cards={G.showHands? G.aiHand : []} />
        )}

        {G.phase === "discard" ? (
          <HandRow title="Your Hand — select 2 for crib" cards={G.pHand} selectable selectedIds={discardSel} onCardClick={(c)=>{
            const id = cardToString(c);
            setDiscardSel(sel => sel.includes(id) ? sel.filter(x=>x!==id) : (sel.length<2 ? sel.concat([id]) : sel));
          }} />
        ) : (
          <HandRow title="Your Hand" cards={G.peg ? G.peg.pHand : G.pHand} />
        )}

        {G.phase === "discard" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button disabled={!canCommit} onClick={()=>{
                const selectedCards = G.pHand.filter(c => discardSel.includes(cardToString(c)));
                G.commitDiscardsSelected(selectedCards);
              }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: canCommit ? "white" : "#f3f4f6", cursor: canCommit ? "pointer" : "not-allowed" }}>
                Put 2 in Crib
              </button>
            </div>
            <HandRow title={`Your Crib Toss (${discardSel.length}/2)`} cards={G.pHand.filter(c => discardSel.includes(cardToString(c)))} />
          </>
        )}

        {G.phase === "cut" && (
          <button onClick={G.cutStarter} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white" }}>Cut Starter</button>
        )}

        {G.phase === "pegging" && G.peg && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {pegLegal.map((c,i)=> (
              <button key={i} disabled={G.gameOver} onClick={()=>G.playPegCard(c)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: G.gameOver? "#f3f4f6":"white", cursor: G.gameOver? "not-allowed":"pointer" }}>
                Play {cardToString(c)}
              </button>
            ))}
            {pegLegal.length === 0 && (
              <button disabled={G.gameOver} onClick={()=>G.declareGo("P")} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: G.gameOver? "#f3f4f6":"white", cursor: G.gameOver? "not-allowed":"pointer" }}>
                Say Go
              </button>
            )}
          </div>
        )}

        {G.phase === "pegging" && G.peg && (
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Pegging Stack (total {G.peg.total})</div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>{G.peg.stack.map((c,i)=> <CardView key={i} card={c} />)}</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12, marginTop: 10 }}>
          <div />
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Game Log</div>
            <div style={{ maxHeight: 300, overflow: "auto", background: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 14, lineHeight: "1.5" }}>
              {G.log.map((l,i)=> <div key={i} style={{ color: "#374151" }}>{l}</div>)}
              {G.phase === "show" && <div style={{ color: "#6b7280" }}>Scoring complete. New deal will begin automatically.</div>}
            </div>
          </div>
        </div>

        <footer style={{ fontSize: 12, textAlign: "center", color: "#6b7280", padding: 16 }}>
          AI uses Monte Carlo rollouts based on seen information only — like a perfect, honest human opponent. House 7-9-8 bonus enabled.
        </footer>
      </div>
    </main>
  );
}

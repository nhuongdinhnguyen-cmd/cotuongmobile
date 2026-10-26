"use strict";

const $ = (id) => document.getElementById(id);
const setupPanel = $("setupPanel"), gamePanel = $("gamePanel");
const boardEl = $("board"), statusEl = $("status");
const setupMessage = $("setupMessage");
const dlg = $("confirmDialog");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const CHARS = {
  rK:"帥", rA:"仕", rE:"相", rH:"傌", rR:"俥", rC:"炮", rP:"兵",
  bK:"將", bA:"士", bE:"象", bH:"馬", bR:"車", bC:"砲", bP:"卒"
};
const VALUE = { K:10000, R:900, C:450, H:400, E:200, A:200, P:100 };
const files = "abcdefghi";
let S = null;
let ws = null;
let reconnectTimer = null;
let clockTimer = null;
let toastTimer = null;
let localMode = "local";
let myColor = "red";
let selected = null;
let legalForSelected = [];
let aiLevel = "trainee";
let aiBusy = false;
let pendingDraw = false;
let playerId = null;
let roomCode = null;
let serverColor = null;
let serverStarted = false;
let boardInitSent = false;
let lastServerState = null;
let serverClockStamp = Date.now();

function initialBoard() {
  const b = Array.from({length:10}, () => Array(9).fill(null));
  const back = ["R","H","E","A","K","A","E","H","R"];
  for (let x=0;x<9;x++) {
    b[0][x] = "b"+back[x];
    b[9][x] = "r"+back[x];
  }
  b[2][1]="bC"; b[2][7]="bC";
  b[7][1]="rC"; b[7][7]="rC";
  for (let x=0;x<9;x+=2) {
    b[3][x]="bP"; b[6][x]="rP";
  }
  return b;
}
function cloneBoard(b) { return b.map(row => row.slice()); }
function sideOf(p) { return p ? p[0] : null; }
function typeOf(p) { return p ? p[1] : null; }
function opponent(side) { return side === "red" ? "black" : "red"; }
function codeSide(side) { return side === "red" ? "r" : "b"; }
function inside(x,y) { return x>=0 && x<9 && y>=0 && y<10; }
function palace(side,x,y) {
  return x>=3 && x<=5 && (side==="red" ? y>=7 && y<=9 : y>=0 && y<=2);
}
function crossedRiver(side,y) { return side==="red" ? y<=4 : y>=5; }

function pseudoMoves(board,x,y,attacksOnly=false) {
  const p=board[y][x]; if(!p) return [];
  const side=p[0]==="r" ? "red" : "black", type=p[1], out=[];
  const add=(nx,ny)=> {
    if(!inside(nx,ny)) return false;
    const target=board[ny][nx];
    if(target && target[0]===p[0]) return false;
    out.push({x:nx,y:ny});
    return !target;
  };
  if(type==="K") {
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx,ny=y+dy;
      if(inside(nx,ny) && palace(side,nx,ny)) add(nx,ny);
    }
    // Flying generals: attack/capture opposing general along an open file.
    for(const d of [-1,1]) {
      for(let ny=y+d;inside(x,ny);ny+=d) {
        if(board[ny][x]) {
          if(typeOf(board[ny][x])==="K" && sideOf(board[ny][x])!==side)
            out.push({x,y:ny});
          break;
        }
      }
    }
  } else if(type==="A") {
    for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx=x+dx,ny=y+dy;
      if(inside(nx,ny)&&palace(side,nx,ny)) add(nx,ny);
    }
  } else if(type==="E") {
    for(const [dx,dy] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
      const nx=x+dx,ny=y+dy, ex=x+dx/2,ey=y+dy/2;
      if(!inside(nx,ny) || board[ey][ex]) continue;
      if(side==="red" ? ny<5 : ny>4) continue;
      add(nx,ny);
    }
  } else if(type==="H") {
    const moves=[
      [1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],
      [2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]
    ];
    for(const [dx,dy,lx,ly] of moves) {
      const nx=x+dx,ny=y+dy;
      if(inside(nx,ny)&&!board[y+ly][x+lx]) add(nx,ny);
    }
  } else if(type==="R" || type==="C") {
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      let screen=false;
      for(let nx=x+dx,ny=y+dy;inside(nx,ny);nx+=dx,ny+=dy) {
        const target=board[ny][nx];
        if(type==="R") {
          if(!target) out.push({x:nx,y:ny});
          else { if(target[0]!==side) out.push({x:nx,y:ny}); break; }
        } else {
          if(!screen) {
            if(!target) { if(!attacksOnly) out.push({x:nx,y:ny}); }
            else screen=true;
          } else if(target) {
            if(target[0]!==side) out.push({x:nx,y:ny});
            break;
          }
        }
      }
    }
  } else if(type==="P") {
    const forward=side==="red" ? -1 : 1;
    const ny=y+forward;
    if(inside(x,ny)) add(x,ny);
    if(crossedRiver(side,y)) {
      for(const dx of [-1,1]) if(inside(x+dx,y)) add(x+dx,y);
    }
  }
  return out;
}

function findGeneral(board,side) {
  const code=codeSide(side)+"K";
  for(let y=0;y<10;y++) for(let x=0;x<9;x++) if(board[y][x]===code) return {x,y};
  return null;
}
function isSquareAttacked(board,x,y,bySide) {
  for(let yy=0;yy<10;yy++) for(let xx=0;xx<9;xx++) {
    const p=board[yy][xx];
    if(p && sideOf(p)===codeSide(bySide)) {
      if(pseudoMoves(board,xx,yy,true).some(m=>m.x===x&&m.y===y)) return true;
    }
  }
  return false;
}
function inCheck(board,side) {
  const g=findGeneral(board,side);
  if(!g) return true;
  return isSquareAttacked(board,g.x,g.y,opponent(side));
}
function applyRaw(board,from,to) {
  const b=cloneBoard(board); b[to.y][to.x]=b[from.y][from.x]; b[from.y][from.x]=null; return b;
}
function legalMovesFrom(board,x,y) {
  const p=board[y][x]; if(!p) return [];
  return pseudoMoves(board,x,y).filter(to=>{
    const next=applyRaw(board,{x,y},to);
    return !inCheck(next,sideOf(p)==="r" ? "red" : "black");
  });
}
function allLegalMoves(board,side) {
  const out=[];
  for(let y=0;y<10;y++) for(let x=0;x<9;x++) {
    if(board[y][x] && sideOf(board[y][x])===codeSide(side)) {
      for(const to of legalMovesFrom(board,x,y)) out.push({from:{x,y},to});
    }
  }
  return out;
}
function sideHasLegal(board,side) { return allLegalMoves(board,side).length>0; }
function isCheckmate(board,side) { return inCheck(board,side) && !sideHasLegal(board,side); }
function coord(x,y) { return files[x]+(10-y); }
function moveText(piece,from,to,captured) {
  const name=CHARS[piece]||piece;
  return `${name} ${coord(from.x,from.y)} → ${coord(to.x,to.y)}${captured?" ×"+CHARS[captured]:""}`;
}
function initializeState(minutes=10) {
  return {
    board:initialBoard(), turn:"red",
    clocks:{red:minutes*60,black:minutes*60},
    timeMinutes:minutes, startedAt:Date.now(), lastTick:Date.now(),
    history:[], lastMove:null, result:null, resultText:"", drawOffer:null
  };
}
function showToast(msg) {
  const el=$("toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2800);
}
function fmtTime(n) {
  n=Math.max(0,Math.ceil(n));
  return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;
}
function render() {
  if(!S) return;
  boardEl.innerHTML="";
  for(let y=0;y<10;y++) for(let x=0;x<9;x++) {
    const cell=document.createElement("button");
    cell.type="button"; cell.className="cell"; cell.setAttribute("aria-label",`${files[x]}${10-y}`);
    if(selected && selected.x===x && selected.y===y) cell.classList.add("selected");
    if(S.lastMove && ((S.lastMove.from.x===x&&S.lastMove.from.y===y)||(S.lastMove.to.x===x&&S.lastMove.to.y===y))) cell.classList.add("lastmove");
    const p=S.board[y][x];
    if(p) {
      const token=document.createElement("span");
      token.className="piece "+(p[0]==="r"?"red-piece":"black-piece");
      token.textContent=CHARS[p];
      cell.appendChild(token);
    }
    cell.addEventListener("click",()=>onCell(x,y));
    boardEl.appendChild(cell);
  }
  $("redClock").textContent=fmtTime(S.clocks.red);
  $("blackClock").textContent=fmtTime(S.clocks.black);
  $("redClock").classList.toggle("low",S.clocks.red<=30);
  $("blackClock").classList.toggle("low",S.clocks.black<=30);
  $("redName").textContent=(lastServerState?.players?.red)||($("playerName").value.trim()||"Bạn");
  $("blackName").textContent=(lastServerState?.players?.black)||(localMode==="ai"?"Máy ("+levelLabel(aiLevel)+")":"Đối thủ");
  document.querySelector(".redbar").classList.toggle("active",S.turn==="red"&&!S.result);
  document.querySelector(".blackbar").classList.toggle("active",S.turn==="black"&&!S.result);
  const sideText=S.turn==="red"?"Đỏ":"Đen";
  if(S.result) statusEl.textContent=S.resultText||"Ván cờ đã kết thúc.";
  else statusEl.textContent=`Lượt ${sideText}${inCheck(S.board,S.turn)?" — ĐANG BỊ CHIẾU!":""}`;
  const hist=$("historyList"); hist.innerHTML="";
  S.history.slice(-120).forEach((item,i)=>{
    const li=document.createElement("li"); li.textContent=item; hist.appendChild(li);
  });
  $("drawBtn").disabled=!!S.result || localMode!=="online";
  $("resignBtn").disabled=!!S.result;
  $("newGameBtn").disabled=localMode==="online" && serverColor!=="red";
}
function levelLabel(level) {
  return ({trainee:"Tập sự",champion:"Kiện tướng",grandmaster:"Đại kiện tướng"})[level]||"Tập sự";
}
function updateStatus(msg) { statusEl.textContent=msg; }
function onCell(x,y) {
  if(!S || S.result || aiBusy) return;
  if(localMode==="online" && (!serverStarted || S.turn!==myColor)) {
    showToast(serverStarted?"Chưa đến lượt của bạn.":"Đang chờ người chơi thứ hai."); return;
  }
  if(localMode==="ai" && S.turn!==myColor) return;
  const p=S.board[y][x];
  if(selected) {
    const target=legalForSelected.find(m=>m.x===x&&m.y===y);
    if(target) { makeMove(selected,{x,y}); return; }
  }
  if(p && sideOf(p)===codeSide(S.turn)) {
    selected={x,y}; legalForSelected=legalMovesFrom(S.board,x,y); render();
  } else {
    selected=null; legalForSelected=[]; render();
  }
}
function makeMove(from,to,fromRemote=false) {
  if(!S || S.result) return;
  const piece=S.board[from.y][from.x];
  if(!piece || sideOf(piece)!==codeSide(S.turn)) return;
  if(!legalMovesFrom(S.board,from.x,from.y).some(m=>m.x===to.x&&m.y===to.y)) {
    showToast("Nước đi không hợp lệ."); return;
  }
  const captured=S.board[to.y][to.x];
  S.board[to.y][to.x]=piece; S.board[from.y][from.x]=null;
  S.lastMove={from:{...from},to:{...to}};
  S.history.push(`${S.history.length+1}. ${moveText(piece,from,to,captured)}`);
  S.turn=opponent(S.turn);
  selected=null; legalForSelected=[];
  if(!findGeneral(S.board,S.turn)) {
    S.result="win"; S.resultText=`${S.turn==="red"?"Đen":"Đỏ"} thắng do Tướng đối phương bị ăn.`;
  } else if(isCheckmate(S.board,S.turn)) {
    S.result="checkmate"; S.resultText=`Chiếu bí! ${S.turn==="red"?"Đen":"Đỏ"} thắng.`;
  } else if(!sideHasLegal(S.board,S.turn)) {
    S.result="stalemate"; S.resultText=`${S.turn==="red"?"Đen":"Đỏ"} thắng vì đối phương hết nước đi hợp lệ.`;
  }
  render();
  if(localMode==="online" && !fromRemote) sendOnlineMove();
  if(localMode==="ai" && !S.result && S.turn!==myColor) setTimeout(playAI,220);
}
function sendOnlineMove() {
  if(!ws || ws.readyState!==WebSocket.OPEN) { showToast("Mất kết nối máy chủ; nước đi chưa được đồng bộ."); return; }
  ws.send(JSON.stringify({type:"move",board:S.board,turn:S.turn,history:S.history,last_move:S.lastMove,result:S.result,result_text:S.resultText}));
}
function tickClock() {
  if(!S || S.result) return;
  const now=Date.now(), elapsed=Math.min(2,(now-S.lastTick)/1000);
  S.lastTick=now;
  if(localMode==="ai" || localMode==="online" && serverStarted) {
    S.clocks[S.turn]=Math.max(0,S.clocks[S.turn]-elapsed);
    if(S.clocks[S.turn]<=0) {
      S.result="timeout"; S.resultText=`Hết giờ! ${S.turn==="red"?"Đen":"Đỏ"} thắng.`;
      if(localMode==="online" && ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:"timeout"}));
    }
    render();
  }
}
function showGame(mode) {
  localMode=mode; setupPanel.classList.add("hidden"); gamePanel.classList.remove("hidden");
  $("copyCodeBtn").classList.toggle("hidden",mode!=="online");
  $("roomLabel").textContent=mode==="online"?(roomCode||""):"";
  $("modeLabel").textContent=mode==="online"?"Chơi online":mode==="ai"?"Chơi với máy":"Chơi thử";
  $("newGameBtn").textContent=mode==="online"?"Ván mới":"Ván mới";
}
function returnHome() {
  if(ws) { try{ws.close();}catch{} ws=null; }
  clearInterval(clockTimer); clockTimer=null;
  selected=null; S=null; roomCode=null; playerId=null; serverColor=null; serverStarted=false; boardInitSent=false; lastServerState=null;
  gamePanel.classList.add("hidden"); setupPanel.classList.remove("hidden");
  $("joinArea").classList.add("hidden"); $("aiArea").classList.add("hidden");
  setupMessage.textContent="";
}
function openDialog(title,text) {
  $("dialogTitle").textContent=title; $("dialogText").textContent=text;
  return new Promise(resolve=>{
    const handler=(event)=>{
      if(event.target!==dlg) return;
      dlg.removeEventListener("close",handler);
      resolve(dlg.returnValue==="ok");
    };
    dlg.addEventListener("close",handler);
    dlg.showModal();
  });
}
async function createRoom() {
  const name=$("playerName").value.trim()||"Đỏ";
  const minutes=Number($("timeChoice").value);
  setupMessage.textContent="Đang tạo phòng...";
  try {
    const res=await fetch("/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,time_minutes:minutes})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.detail||"Không tạo được phòng.");
    roomCode=data.code; playerId=data.player_id; serverColor=data.color; myColor=serverColor;
    S=initializeState(minutes); serverStarted=false; boardInitSent=false;
    showGame("online"); connectRoom();
    setupMessage.textContent="";
  } catch(e) { setupMessage.textContent="Lỗi: "+e.message; }
}
async function joinRoom() {
  const name=$("playerName").value.trim()||"Đen";
  const code=$("roomCode").value.trim().toUpperCase();
  if(!code) { setupMessage.textContent="Hãy nhập mã phòng."; return; }
  setupMessage.textContent="Đang tham gia phòng...";
  try {
    const res=await fetch("/api/rooms/join",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,code})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.detail||"Không vào được phòng.");
    roomCode=data.code; playerId=data.player_id; serverColor=data.color; myColor=serverColor; boardInitSent=false;
    S=initializeState(Number($("timeChoice").value));
    showGame("online"); connectRoom(); setupMessage.textContent="";
  } catch(e) { setupMessage.textContent="Lỗi: "+e.message; }
}
function connectRoom() {
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(`${proto}//${location.host}/ws/${roomCode}/${playerId}`);
  ws.onopen=()=>showToast("Đã kết nối máy chủ.");
  ws.onmessage=(event)=>{
    const msg=JSON.parse(event.data);
    if(msg.type==="error") { showToast(msg.message); return; }
    if(msg.type==="welcome") {
      serverColor=msg.color;
      // The online player's local color must match the color assigned by the server.
      // Without this, the player joining as Black is incorrectly blocked from moving.
      myColor=serverColor;
      applyServerState(msg.state);
      return;
    }
    if(msg.type==="state") { applyServerState(msg.state); return; }
    if(msg.type==="draw_offer") {
      if(msg.from!==serverColor) handleDrawOffer(msg.name);
      else showToast("Đã gửi lời cầu hòa.");
      return;
    }
    if(msg.type==="draw_reply") {
      showToast(msg.accept?"Đối thủ đồng ý hòa.":"Đối thủ từ chối hòa.");
      return;
    }
    if(msg.type==="notice") showToast(msg.message);
  };
  ws.onclose=()=>{ if(localMode==="online") showToast("Mất kết nối máy chủ. Hãy tải lại trang nếu không tự kết nối lại."); };
}
function applyServerState(state) {
  if(!state) return;
  lastServerState=state;
  serverStarted=!!state.started;
  if(state.board) {
    if(!S || !S.board || JSON.stringify(S.board)!==JSON.stringify(state.board)) {
      S= S || initializeState(state.time_minutes||10);
      S.board=state.board; S.turn=state.turn; S.history=state.history||[];
      S.lastMove=state.last_move; S.result=state.result; S.resultText=state.result_text||"";
    } else {
      S.turn=state.turn; S.history=state.history||[]; S.lastMove=state.last_move;
      S.result=state.result; S.resultText=state.result_text||"";
    }
  } else if(!S) S=initializeState(state.time_minutes||10);
  if(state.clocks) S.clocks={red:Number(state.clocks.red),black:Number(state.clocks.black)};
  if(state.draw_offer && state.draw_offer!==serverColor) pendingDraw=true;
  else pendingDraw=false;
  if(serverStarted && !state.board && serverColor==="red" && !boardInitSent) {
    if(!S.board) S.board=initialBoard();
    if(ws?.readyState===WebSocket.OPEN) {
      ws.send(JSON.stringify({type:"init_board",board:S.board}));
      boardInitSent=true;
    }
  }
  if(state.players) {
    $("redName").textContent=state.players.red||"Đỏ";
    $("blackName").textContent=state.players.black||"Đang chờ...";
  }
  if(!state.started) updateStatus("Đã tạo phòng. Chia sẻ mã phòng và chờ đối手 tham gia.");
  render();
  serverClockStamp=Date.now();
  if(!clockTimer) clockTimer=setInterval(tickClock,250);
}
async function handleDrawOffer(name) {
  const yes=await openDialog("Đối thủ cầu hòa",`${name||"Đối thủ"} đề nghị hòa. Bạn có đồng ý không?`);
  if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:"draw_reply",accept:yes}));
}
async function startAI() {
  aiLevel=$("aiLevel").value; myColor=$("humanColor").value;
  const minutes=Number($("timeChoice").value);
  S=initializeState(minutes); S.lastTick=Date.now();
  showGame("ai");
  $("redName").textContent=myColor==="red"?($("playerName").value.trim()||"Bạn"):"Máy ("+levelLabel(aiLevel)+")";
  $("blackName").textContent=myColor==="black"?($("playerName").value.trim()||"Bạn"):"Máy ("+levelLabel(aiLevel)+")";
  clockTimer=setInterval(tickClock,250); render();
  if(myColor==="black") { aiBusy=true; setTimeout(playAI,350); }
}
function evaluate(board, perspective) {
  let score=0;
  for(let y=0;y<10;y++) for(let x=0;x<9;x++) {
    const p=board[y][x]; if(!p) continue;
    const side=p[0]==="r"?"red":"black", type=p[1];
    let val=VALUE[type]||0;
    if(type==="P") val += (side==="red" ? 6-y : y-3)*7 + (crossedRiver(side,y)?35:0);
    if(type==="H" || type==="R" || type==="C") {
      val += 10 - Math.abs(4-x)*2;
    }
    score += side===perspective?val:-val;
  }
  if(inCheck(board,opponent(perspective))) score+=35;
  if(inCheck(board,perspective)) score-=35;
  return score;
}
function orderedMoves(board, side) {
  return allLegalMoves(board,side).sort((a,b)=>{
    const va=board[a.to.y][a.to.x]?VALUE[typeOf(board[a.to.y][a.to.x])]||0:0;
    const vb=board[b.to.y][b.to.x]?VALUE[typeOf(board[b.to.y][b.to.x])]||0:0;
    return vb-va;
  });
}
function minimax(board, side, depth, alpha, beta, perspective) {
  if(depth===0) return evaluate(board,perspective);
  const moves=orderedMoves(board,side);
  if(!moves.length) return inCheck(board,side)?(side===perspective?-99999:99999):0;
  const maximizing=side===perspective;
  let best=maximizing?-Infinity:Infinity;
  for(const m of moves) {
    const next=applyRaw(board,m.from,m.to);
    const val=minimax(next,opponent(side),depth-1,alpha,beta,perspective);
    if(maximizing) { best=Math.max(best,val); alpha=Math.max(alpha,best); }
    else { best=Math.min(best,val); beta=Math.min(beta,best); }
    if(beta<=alpha) break;
  }
  return best;
}
async function playAI() {
  if(!S || S.result || S.turn===myColor || aiBusy) return;
  aiBusy=true; updateStatus("Máy đang suy nghĩ...");
  await sleep(120);
  const moves=allLegalMoves(S.board,S.turn);
  if(!moves.length) {
    S.result=inCheck(S.board,S.turn)?"checkmate":"stalemate";
    S.resultText=`${myColor==="red"?"Đỏ":"Đen"} thắng!`; aiBusy=false; render(); return;
  }
  let chosen;
  if(aiLevel==="trainee") {
    // A beginner-level bot chooses a legal move, with a small preference for captures.
    const weighted=moves.map(m=>({m,w:1+(S.board[m.to.y][m.to.x]?2:0)}));
    let n=Math.random()*weighted.reduce((a,b)=>a+b.w,0);
    for(const item of weighted) { n-=item.w; if(n<=0){chosen=item.m;break;} }
    chosen=chosen||moves[0];
  } else {
    const depth=aiLevel==="champion"?1:2;
    const perspective=S.turn;
    let best=-Infinity, options=[];
    const candidates=orderedMoves(S.board,S.turn);
    for(let i=0;i<candidates.length;i++) {
      const m=candidates[i], next=applyRaw(S.board,m.from,m.to);
      const score=minimax(next,opponent(S.turn),depth-1,-Infinity,Infinity,perspective);
      if(score>best) {best=score;options=[m];}
      else if(score===best) options.push(m);
      if(aiLevel==="grandmaster" && i>80) break; // keep mobile/browser response bounded
      if(i%12===0) await sleep(0);
    }
    chosen=options[Math.floor(Math.random()*options.length)]||candidates[0];
  }
  aiBusy=false;
  if(chosen) makeMove(chosen.from,chosen.to);
}
async function offerDraw() {
  if(localMode!=="online" || !ws || ws.readyState!==WebSocket.OPEN) return;
  ws.send(JSON.stringify({type:"draw_offer"}));
}
async function resign() {
  if(!S || S.result) return;
  const yes=await openDialog("Xin thua","Bạn chắc chắn muốn xin thua ván này?");
  if(!yes) return;
  if(localMode==="online" && ws?.readyState===WebSocket.OPEN) {
    ws.send(JSON.stringify({type:"resign"}));
  } else {
    S.result="resign"; S.resultText=`${myColor==="red"?"Đỏ":"Đen"} xin thua. ${myColor==="red"?"Đen":"Đỏ"} thắng.`;
    render();
  }
}
function newGame() {
  if(localMode==="online") {
    if(serverColor!=="red") { showToast("Chỉ người tạo phòng có thể bắt đầu ván mới."); return; }
    if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:"new_game",board:initialBoard()}));
    return;
  }
  const minutes=Number($("timeChoice").value);
  S=initializeState(minutes); selected=null; legalForSelected=[]; aiBusy=false; render();
  if(localMode==="ai" && myColor==="black") setTimeout(playAI,250);
}
$("createRoomBtn").addEventListener("click",createRoom);
$("joinRoomBtn").addEventListener("click",()=>$("joinArea").classList.toggle("hidden"));
$("joinConfirmBtn").addEventListener("click",joinRoom);
$("computerBtn").addEventListener("click",()=>$("aiArea").classList.toggle("hidden"));
$("startAiBtn").addEventListener("click",startAI);
$("drawBtn").addEventListener("click",offerDraw);
$("resignBtn").addEventListener("click",resign);
$("newGameBtn").addEventListener("click",newGame);
$("exitBtn").addEventListener("click",returnHome);
$("homeBtn").addEventListener("click",returnHome);
$("rulesBtn").addEventListener("click",()=>{$("rulesDetails").open=true;$("rulesDetails").scrollIntoView({behavior:"smooth",block:"center"});});
$("copyCodeBtn").addEventListener("click",async()=>{
  try { await navigator.clipboard.writeText(roomCode); showToast("Đã sao chép mã phòng."); }
  catch { showToast("Mã phòng: "+roomCode); }
});
window.addEventListener("beforeunload",()=>{if(ws) ws.close();});

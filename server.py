import os, random, string, asyncio
from typing import Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
BASE=os.path.dirname(os.path.abspath(__file__)); STATIC=os.path.join(BASE,'static')
app=FastAPI(title='Co Ganh Online'); app.mount('/static',StaticFiles(directory=STATIC),name='static')
def rc(i): return divmod(i,5)
def idx(r,c): return r*5+c
def neighbors(i):
 r,c=rc(i); out=[]
 for dr,dc in [(-1,0),(1,0),(0,-1),(0,1)]:
  rr,cc=r+dr,c+dc
  if 0<=rr<5 and 0<=cc<5: out.append(idx(rr,cc))
 if (r+c)%2==0:
  for dr,dc in [(-1,-1),(-1,1),(1,-1),(1,1)]:
   rr,cc=r+dr,c+dc
   if 0<=rr<5 and 0<=cc<5: out.append(idx(rr,cc))
 return sorted(set(out))
EDGES=sorted({tuple(sorted((i,j))) for i in range(25) for j in neighbors(i)})
def initial_board():
 b=['.']*25
 # Người chơi 1/Đỏ ở nửa dưới; đối thủ/Xanh ở nửa trên.
 for p in [10,15,20,21,22,23,24,19]: b[p]='R'
 for p in [5,0,1,2,3,4,9,14]: b[p]='B'
 return b
def legal_moves(board,side): return [(i,j) for i,v in enumerate(board) if v==side for j in neighbors(i) if board[j]=='.']
def components(board,side):
 seen=set(); out=[]
 for i,v in enumerate(board):
  if v!=side or i in seen: continue
  stack=[i]; seen.add(i); comp=[]
  while stack:
   x=stack.pop(); comp.append(x)
   for y in neighbors(x):
    if board[y]==side and y not in seen: seen.add(y); stack.append(y)
  out.append(comp)
 return out
def resolve_move(board,src,dst,side):
 if not (0<=src<25 and 0<=dst<25) or board[src]!=side or board[dst]!='.' or dst not in neighbors(src): raise ValueError('Nước đi không hợp lệ.')
 b=board[:]; b[src]='.'; b[dst]=side; enemy='B' if side=='R' else 'R'; flips=[]; r,c=rc(dst)
 for dr,dc in [(1,0),(0,1),(1,1),(1,-1)]:
  a=(r-dr,c-dc); z=(r+dr,c+dc)
  if all(0<=v<5 for v in (*a,*z)):
   x,y=idx(*a),idx(*z)
   if b[x]==enemy and b[y]==enemy: b[x]=side; b[y]=side; flips += [x,y]
 for _ in range(25):
  changed=False
  for comp in components(b,enemy):
   if not any(b[y]=='.' for x in comp for y in neighbors(x)):
    for x in comp: b[x]=side; flips.append(x); changed=True
  if not changed: break
 return b,sorted(set(flips))
def winner_for(board,turn):
 if 'R' not in board:return 'B'
 if 'B' not in board:return 'R'
 if not legal_moves(board,turn):return 'B' if turn=='R' else 'R'
 return None
def ai_move(board,side,difficulty):
 moves=legal_moves(board,side)
 if not moves:return None
 if difficulty=='easy':return random.choice(moves)
 enemy='B' if side=='R' else 'R'; scored=[]
 for m in moves:
  b,flips=resolve_move(board,*m,side); val=len(flips)*12
  opp=legal_moves(b,enemy)
  if opp:
   danger=max(len(resolve_move(b,a,z,enemy)[1]) for a,z in opp)
   val-=danger*(4 if difficulty=='hard' else 1)
  r,c=rc(m[1]); val+=(4-abs(2-r)-abs(2-c))*.4; scored.append((val,m))
 scored.sort(key=lambda x:x[0],reverse=True)
 return scored[0][1] if difficulty=='hard' else random.choice(scored[:min(4,len(scored))])[1]
class Room:
 def __init__(self,code,mode,difficulty):
  self.code=code;self.mode=mode;self.difficulty=difficulty;self.board=initial_board();self.turn='R';self.phase='rps' if mode=='ai' else 'waiting';self.players={};self.names={'R':'Đỏ','B':'Xanh'};self.scores={'R':0,'B':0};self.history=[];self.winner=None;self.rps_choices={};self.lock=asyncio.Lock()
 def state(self,side=None):
  if self.phase=='waiting': msg='Đang chờ người chơi thứ hai tham gia phòng.'
  elif self.phase=='rps': msg='Kéo – Búa – Bao để chọn quyền đi trước.'
  elif self.winner: msg=f'{self.names[self.winner]} chiến thắng!'
  else: msg=f'Đến lượt {self.names[self.turn]}.'
  return {'type':'state','room':self.code,'mode':self.mode,'phase':self.phase,'board':self.board,'turn':self.turn,'names':self.names,'scores':self.scores,'history':self.history[-100:],'winner':self.winner,'difficulty':self.difficulty,'yourSide':side,'message':msg,'rpsChoices':{k:bool(v) for k,v in self.rps_choices.items()}}
 async def broadcast(self):
  for side,ws in list(self.players.items()):
   try: await ws.send_json(self.state(side))
   except Exception: self.players.pop(side,None)
rooms:Dict[str,Room]={}
def new_code():
 while True:
  c=''.join(random.choices(string.ascii_uppercase+string.digits,k=5))
  if c not in rooms:return c
@app.get('/')
async def home():return FileResponse(os.path.join(STATIC,'index.html'))
@app.get('/health')
async def health():return {'status':'ok','service':'co-ganh-online'}
@app.get('/version')
async def version():return {'service':'co-ganh-online','build':'2026-10-22-A','frontend':'static/index.html'}
@app.post('/api/rooms')
async def create_room(payload:Dict[str,Any]):
 mode=payload.get('mode','online')
 if mode not in ('online','ai'):raise HTTPException(400,'Chế độ không hợp lệ')
 diff=payload.get('difficulty','medium');diff=diff if diff in ('easy','medium','hard') else 'medium';code=new_code();r=Room(code,mode,diff)
 r.names['R']=(str(payload.get('name','Người chơi 1')).strip()[:24] or 'Người chơi 1')
 if mode=='ai':r.names['B']='Máy ('+{'easy':'Dễ','medium':'Trung bình','hard':'Khó'}[diff]+')'
 rooms[code]=r;return {'code':code,'mode':mode,'side':'R'}
@app.websocket('/ws/{code}')
async def socket(ws:WebSocket,code:str):
 await ws.accept();room=rooms.get(code.upper())
 if not room:await ws.send_json({'type':'error','message':'Không tìm thấy phòng.'});await ws.close();return
 side=ws.query_params.get('side','').upper();name=ws.query_params.get('name','').strip()[:24]
 async with room.lock:
  if side not in ('R','B'):side='R' if 'R' not in room.players else 'B'
  if side in room.players:await ws.send_json({'type':'error','message':'Bên này đã có người chơi.'});await ws.close();return
  if room.mode=='ai' and side=='B':await ws.send_json({'type':'error','message':'Phòng này đang chơi với máy.'});await ws.close();return
  room.players[side]=ws
  if name:room.names[side]=name
  room.phase='rps' if room.mode=='ai' or len(room.players)==2 else 'waiting'
  if room.phase=='rps': room.rps_choices={}
  await ws.send_json({'type':'you','side':side,'room':room.code,'mode':room.mode});await room.broadcast()
 try:
  while True:
   msg=await ws.receive_json();action=msg.get('action')
   async with room.lock:
    if action=='rps':
     if room.phase!='rps': await ws.send_json({'type':'error','message':'Lượt chọn Kéo – Búa – Bao đã kết thúc.'}); continue
     choice=str(msg.get('choice','')).lower()
     if choice not in ('rock','paper','scissors'): await ws.send_json({'type':'error','message':'Lựa chọn không hợp lệ.'}); continue
     room.rps_choices[side]=choice
     if room.mode=='ai' and side=='R' and 'B' not in room.rps_choices:
      room.rps_choices['B']=random.choice(('rock','paper','scissors'))
     if len(room.rps_choices)==2:
      a,b=room.rps_choices['R'],room.rps_choices['B']
      beats={'rock':'scissors','scissors':'paper','paper':'rock'}
      if a==b:
       room.rps_choices={}
       room.phase='rps'
      else:
       room.turn='R' if beats[a]==b else 'B'
       room.phase='playing'
       room.rps_choices={}
     await room.broadcast()
     # If the computer wins Kéo–Búa–Bao, it owns the first turn.
     # Play that opening move immediately; otherwise the game appears stuck
     # waiting for the human even though it is the computer's turn.
     if room.mode=='ai' and room.phase=='playing' and room.turn=='B' and not room.winner:
      await asyncio.sleep(.4)
      m=ai_move(room.board,'B',room.difficulty)
      if m:
       room.board,flips=resolve_move(room.board,m[0],m[1],'B')
       room.history.append({'side':'B','name':room.names['B'],'from':m[0],'to':m[1],'flips':flips})
       room.turn='R'
       room.winner=winner_for(room.board,room.turn)
       if room.winner:room.scores[room.winner]+=1
      else:
       room.winner='R';room.scores['R']+=1
      await room.broadcast()
    elif action=='move':
     if room.phase!='playing' or room.winner:await ws.send_json({'type':'error','message':'Ván chưa sẵn sàng.'});continue
     if side!=room.turn:await ws.send_json({'type':'error','message':'Chưa đến lượt bạn.'});continue
     try:src=int(msg['from']);dst=int(msg['to']);room.board,flips=resolve_move(room.board,src,dst,side)
     except Exception as e:await ws.send_json({'type':'error','message':str(e)});continue
     room.history.append({'side':side,'name':room.names[side],'from':src,'to':dst,'flips':flips});room.turn='B' if side=='R' else 'R';room.winner=winner_for(room.board,room.turn)
     if room.winner:room.scores[room.winner]+=1
     await room.broadcast()
     if room.mode=='ai' and room.turn=='B' and not room.winner:
      await asyncio.sleep(.4);m=ai_move(room.board,'B',room.difficulty)
      if m:
       room.board,flips=resolve_move(room.board,m[0],m[1],'B');room.history.append({'side':'B','name':room.names['B'],'from':m[0],'to':m[1],'flips':flips});room.turn='R';room.winner=winner_for(room.board,room.turn)
       if room.winner:room.scores[room.winner]+=1
      await room.broadcast()
    elif action=='new_game':
     room.board=initial_board();room.turn='R';room.winner=None;room.history=[];room.rps_choices={};room.phase='rps' if room.mode=='ai' or len(room.players)==2 else 'waiting';await room.broadcast()
 except WebSocketDisconnect:
  async with room.lock:
   if room.players.get(side) is ws:room.players.pop(side,None)
   if room.mode=='online' and len(room.players)<2 and not room.winner:room.phase='waiting'
   await room.broadcast()

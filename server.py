import asyncio
import json
import secrets
import string
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

rooms = {}
rooms_lock = asyncio.Lock()


def make_code():
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(5))
        if code not in rooms:
            return code


def public_room(room):
    now = time.monotonic()
    clocks = dict(room["clocks"])
    if room["started"] and not room["result"]:
        elapsed = max(0, now - room["last_clock"])
        clocks[room["turn"]] = max(0, clocks[room["turn"]] - elapsed)
    return {
        "code": room["code"],
        "players": room["players"],
        "time_minutes": room["time_minutes"],
        "clocks": {k: round(v, 1) for k, v in clocks.items()},
        "turn": room["turn"],
        "started": room["started"],
        "result": room["result"],
        "result_text": room["result_text"],
        "board": room["board"],
        "history": room["history"],
        "last_move": room["last_move"],
        "draw_offer": room["draw_offer"],
    }


async def send_room(room, message):
    stale = []
    for player_id, socket in list(room["sockets"].items()):
        try:
            await socket.send_json(message)
        except Exception:
            stale.append(player_id)
    for player_id in stale:
        room["sockets"].pop(player_id, None)


async def room_state(room):
    await send_room(room, {"type": "state", "state": public_room(room)})


async def clock_loop():
    while True:
        await asyncio.sleep(0.5)
        async with rooms_lock:
            for room in list(rooms.values()):
                if room["started"] and not room["result"]:
                    now = time.monotonic()
                    elapsed = max(0, now - room["last_clock"])
                    room["clocks"][room["turn"]] = max(
                        0, room["clocks"][room["turn"]] - elapsed
                    )
                    room["last_clock"] = now
                    if room["clocks"][room["turn"]] <= 0:
                        loser = room["turn"]
                        winner = "black" if loser == "red" else "red"
                        room["result"] = "timeout"
                        room["result_text"] = (
                            f"Hết giờ! {room['players'].get(winner, winner)} thắng."
                        )
                        await room_state(room)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(clock_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Co Tuong Online", lifespan=lifespan)


class CreateRoom(BaseModel):
    name: str = "Người chơi"
    time_minutes: int = 10


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "co-tuong-online"}


@app.post("/api/rooms")
async def create_room(data: CreateRoom):
    if data.time_minutes not in (10, 15, 30):
        raise HTTPException(status_code=400, detail="Thời gian phải là 10, 15 hoặc 30 phút.")
    async with rooms_lock:
        code = make_code()
        player_id = secrets.token_urlsafe(12)
        room = {
            "code": code,
            "players": {"red": data.name.strip()[:30] or "Đỏ"},
            "player_ids": {"red": player_id},
            "sockets": {},
            "time_minutes": data.time_minutes,
            "clocks": {"red": data.time_minutes * 60.0, "black": data.time_minutes * 60.0},
            "turn": "red",
            "started": False,
            "result": None,
            "result_text": "",
            "board": None,
            "history": [],
            "last_move": None,
            "draw_offer": None,
            "last_clock": time.monotonic(),
        }
        rooms[code] = room
    return {"code": code, "player_id": player_id, "color": "red"}


class JoinRoom(BaseModel):
    code: str
    name: str = "Người chơi"


@app.post("/api/rooms/join")
async def join_room(data: JoinRoom):
    code = data.code.strip().upper()
    async with rooms_lock:
        room = rooms.get(code)
        if not room:
            raise HTTPException(status_code=404, detail="Không tìm thấy phòng.")
        if "black" in room["players"]:
            raise HTTPException(status_code=409, detail="Phòng đã đủ 2 người.")
        if room["result"]:
            raise HTTPException(status_code=409, detail="Ván này đã kết thúc.")
        player_id = secrets.token_urlsafe(12)
        room["players"]["black"] = data.name.strip()[:30] or "Đen"
        room["player_ids"]["black"] = player_id
        room["started"] = True
        room["last_clock"] = time.monotonic()
    return {"code": code, "player_id": player_id, "color": "black"}


@app.websocket("/ws/{code}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, code: str, player_id: str):
    code = code.upper()
    await websocket.accept()
    async with rooms_lock:
        room = rooms.get(code)
        if not room or player_id not in room["player_ids"].values():
            await websocket.send_json({"type": "error", "message": "Mã phòng hoặc mã người chơi không hợp lệ."})
            await websocket.close()
            return
        color = next(k for k, v in room["player_ids"].items() if v == player_id)
        room["sockets"][player_id] = websocket
        await websocket.send_json({"type": "welcome", "color": color, "state": public_room(room)})
        await room_state(room)

    try:
        while True:
            data = await websocket.receive_json()
            async with rooms_lock:
                room = rooms.get(code)
                if not room:
                    break
                kind = data.get("type")

                if kind == "init_board":
                    if color == "red" and room["board"] is None:
                        room["board"] = data.get("board")
                        await room_state(room)

                elif kind == "move":
                    if room["result"]:
                        continue
                    now = time.monotonic()
                    elapsed = max(0, now - room["last_clock"])
                    room["clocks"][room["turn"]] = max(
                        0, room["clocks"][room["turn"]] - elapsed
                    )
                    room["last_clock"] = now
                    if room["clocks"][room["turn"]] <= 0:
                        loser = room["turn"]
                        winner = "black" if loser == "red" else "red"
                        room["result"] = "timeout"
                        room["result_text"] = f"Hết giờ! {room['players'].get(winner, winner)} thắng."
                    elif color != room["turn"]:
                        await websocket.send_json({"type": "error", "message": "Chưa đến lượt của bạn."})
                    else:
                        # The browser checks move legality. Server enforces player turn and
                        # broadcasts the authoritative room snapshot for the current session.
                        room["board"] = data.get("board", room["board"])
                        room["turn"] = data.get("turn", ("black" if color == "red" else "red"))
                        room["history"] = data.get("history", room["history"])[-300:]
                        room["last_move"] = data.get("last_move")
                        room["result"] = data.get("result")
                        room["result_text"] = data.get("result_text", "")
                        room["draw_offer"] = None
                    await room_state(room)

                elif kind == "draw_offer":
                    if not room["result"]:
                        room["draw_offer"] = color
                        await send_room(room, {
                            "type": "draw_offer",
                            "from": color,
                            "name": room["players"].get(color, color),
                        })

                elif kind == "draw_reply":
                    if room["draw_offer"] and room["draw_offer"] != color:
                        if data.get("accept"):
                            room["result"] = "draw"
                            room["result_text"] = "Hai bên đồng ý hòa."
                        room["draw_offer"] = None
                        await room_state(room)
                        await send_room(room, {"type": "draw_reply", "accept": bool(data.get("accept"))})

                elif kind == "resign":
                    if not room["result"]:
                        winner = "black" if color == "red" else "red"
                        room["result"] = "resign"
                        room["result_text"] = f"{room['players'].get(color, color)} xin thua. {room['players'].get(winner, winner)} thắng."
                        await room_state(room)

                elif kind == "new_game":
                    if color == "red":
                        room["clocks"] = {
                            "red": room["time_minutes"] * 60.0,
                            "black": room["time_minutes"] * 60.0,
                        }
                        room["turn"] = "red"
                        room["result"] = None
                        room["result_text"] = ""
                        room["history"] = []
                        room["last_move"] = None
                        room["draw_offer"] = None
                        room["board"] = data.get("board")
                        room["started"] = "black" in room["players"]
                        room["last_clock"] = time.monotonic()
                        await room_state(room)
                        await send_room(room, {"type": "notice", "message": "Ván mới bắt đầu!"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        async with rooms_lock:
            room = rooms.get(code)
            if room:
                room["sockets"].pop(player_id, None)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

# Cờ Gánh Online — bản D

## Tính năng
- Chơi online 2 người qua mã phòng hoặc chơi với máy (3 mức độ).
- Kéo – Búa – Bao trước mỗi ván; người thắng được đi trước, hòa thì chọn lại.
- Người chơi 1/quân Đỏ bố trí phía dưới; đối thủ/quân Xanh phía trên.
- Menu trên: Giới thiệu game, Luật chơi, Cách chơi.
- Thanh thao tác trong ván: Trang chủ, Thoát game, Ván mới, Mã phòng.
- Giao diện responsive cho điện thoại và máy tính.
- Điểm thắng được giữ trong cùng phòng khi chọn Ván mới.

## Triển khai Render
1. Giải nén ZIP.
2. Đưa các file và thư mục trong `coganh_online_complete` vào repository dành riêng cho Cờ Gánh, không dùng repository Ô ăn quan.
3. Root Directory để trống nếu `server.py`, `requirements.txt`, `render.yaml` nằm ở thư mục gốc.
4. Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Commit và push; chờ Render deploy xong.
6. Kiểm tra `/version` — cần trả về build `2026-10-21-D`.

## Chạy thử cục bộ
```bash
py -3.13 -m pip install -r requirements.txt
py -3.13 -m uvicorn server:app --host 127.0.0.1 --port 8000
```
Mở `http://127.0.0.1:8000`.

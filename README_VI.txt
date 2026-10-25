CO TUONG ONLINE - HUONG DAN CAI DAT (Windows + Render)
=====================================================

THU MUC
-------
CoTuongOnline/
  server.py
  requirements.txt
  render.yaml
  static/
    index.html
    style.css
    game.js

A. CHAY THU TREN WINDOWS
------------------------
1. Giai nen thu muc CoTuongOnline vao:
   D:\Python\Hoc\CoTuongOnline

2. Mo CMD va chay:
   cd /d D:\Python\Hoc\CoTuongOnline
   py -3.13 -m pip install -r requirements.txt
   py -3.13 -m uvicorn server:app --host 127.0.0.1 --port 8000

3. Mo trinh duyet:
   http://127.0.0.1:8000

4. Dung may chu: nhan Ctrl+C trong CMD.

B. DAY LEN GITHUB
-----------------
1. Tao repository moi, vi du: co-tuong-online
2. Upload cac file va thu muc ben trong CoTuongOnline.
   Khong upload ca thu muc long long dan toi duong dan sai.
3. Dam bao server.py, requirements.txt va render.yaml nam o thu muc goc repository.
4. Thu muc static chua index.html, style.css, game.js.

C. DEPLOY RENDER
----------------
1. Render -> New -> Web Service -> ket noi repository GitHub.
2. Build Command:
   pip install -r requirements.txt
3. Start Command:
   uvicorn server:app --host 0.0.0.0 --port $PORT
4. Health Check Path (neu Render cho nhap):
   /api/health
5. Deploy va mo URL Render duoc cap.

LUU Y QUAN TRONG
----------------
- Phong va trang thai van co trong RAM cua mot tien trinh may chu. Neu Render restart,
  phong co the mat. Ban nay phu hop thu nghiem; muon luu phong dai han can them database.
- May chu kiem tra luot di va dong bo trang thai, nhung phan kiem tra nuoc di hop le
  chinh hien tai chay trong trinh duyet. Khong dung ban nay cho giai dau co tinh canh tranh.
- Cap may "Dai kien tuong" dung tim kiem gioi han de tranh lam treo trinh duyet; khong
  dong nghia trinh do tuong duong dai kien tuong that.
- Khi tao phong, nguoi tao cam Do; nguoi tham gia cam Den. Dong ho bat dau khi co ca hai.
- De ván online moi, nguoi tao phong (Do) bam "Van moi".

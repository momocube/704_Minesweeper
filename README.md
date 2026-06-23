# 704 Minesweeper

把 704 場館的 5 面感應牆當地雷棋盤,地板兩半當「旗子 / 揭露」模式按鈕的踩地雷遊戲。

牆面**頂部 2 排**(身高觸不到)留作 HUD,顯示計時器 + 分數 + 剩餘地雷數。

```
牆 (摸格選定鎖定)  →  TouchService  →  game-server  →  6 個 view (WallProjector 投到對應面)
地板 (左半旗子 / 右半揭露 →  套用到鎖定格)
```

## 一格 = 8 顆晶片

每個棋盤格 = 2 cols × 4 rows 感應格 = 8 顆晶片(對齊舊 Unity 軟體 Size64 模式),展開圖 canvas 上自然就是 64×64 px 正方形。

5 面牆 grid 各自尺寸 ×(扣掉**物理頂 2 排** HUD)= 合計 **800 個遊戲格**(預設 15% 是雷 = 120 顆):

| 面 | grid | reservedSide (物理頂在展開圖的位置) | HUD 占 | 遊戲格 |
|---|---|---|---|---|
| Wall Top | 22×10 | top (展開圖 row 0,1) | 22×2 = 44 | 22×8 = 176 |
| Wall Button | 22×10 | **bottom** (展開圖 row 8,9) | 22×2 = 44 | 22×8 = 176 |
| Wall Left | 10×32 | **left** (展開圖 col 0,1) | 2×32 = 64 | 8×32 = 256 |
| Wall Right Big | 10×20 | **right** (展開圖 col 8,9) | 2×20 = 40 | 8×20 = 160 |
| Wall Right little | 10×4 | **right** (展開圖 col 8,9) | 2×4 = 8 | 8×4 = 32 |
| Floor | — | — | — | 模式按鈕(左半旗子 / 右半揭露)+ 重新開始按鈕(中央 3×3) |
| Entrance | — | — | — | 不互動 |

「物理頂」= 站在房間內看,該面牆靠近天花板的那一邊。展開圖把每面往外攤平,該面的「outward edge」就是物理頂。
Wall Top 往上展開所以展開圖 row 0 = 物理頂;Wall Left 往左展開所以展開圖 col 0 = 物理頂;Wall Button 往下展開所以展開圖 row max = 物理頂;依此類推。

## 玩法

1. **遊戲開始時 phase = idle**,地板中央顯示綠色閃爍 ▶ 開始按鈕(3×3 board cells),計時器停在 0:00,牆面摸了沒反應
2. **踩開始按鈕** → phase = playing,計時器開始走
3. **摸**牆面任一格(頂部 HUD 區除外) → 該格被鎖定(投影高亮),5 秒沒動作會自動解鎖
4. 走到地板,踩**左半**(🚩) → 鎖定格 toggle 旗子;踩**右半**(⛏) → 鎖定格揭露
5. 揭露 0 格會 flood-fill;**揭露雷 = BOOM**,紅色從炸彈那格依空間距離快速擴散填滿**整個場域(含 HUD、Floor、Entrance,不只 game 區)**,約 1.8 秒
6. **第一次揭露保護**:第一次踩的格子 + 它的 8 鄰居,server 保證都不會是地雷(地雷會被搬到別處)— 經典踩地雷規則,讓開局不會直接 BOOM
7. 動畫結束後,地板中央出現**紅色閃爍 ↻ 重新開始按鈕**(3×3 board cells = 75×75 cm),踩它**直接重來**(skip idle,timer 重置且立刻開始計時)
8. 揭完所有非雷格 = 過關(同樣出現重新開始按鈕)

## 啟動

**最快**:雙擊 `start.bat` → 自動裝套件(首次)→ 啟動 **Electron app**:
- Server(child process,Electron-as-Node)在 port 3000
- **高畫質**:canvas 內部 buffer = 2688×3840 venue 原生解析度(每面也用自己 native size,例如 Wall Top 1408×640),由 browser / 投影機自己 downscale → OBS 截到的是 native res 降下來的清晰像素,不是 JS 先模糊化一遍
- 控制台視窗:`http://localhost:3000/?face=all`,header 右邊有 **📺 投播** 按鈕
- 點投播 → 列出所有螢幕(Electron `screen` API)→ 選一個就會開**全螢幕投影視窗**到那個螢幕
- 還有 **🪟 視窗模式** 選項(專給 OBS / NDI 截取用,視窗 title = `704 Minesweeper Projector — capture this window`)
- 還有 **🖥 自動 → 第二螢幕** 快捷(自動挑非主螢幕全螢幕投影)
- ESC 關閉投影視窗

會自動殺掉上次忘了關的 server(避免 port 衝突)。

**手動**:
```powershell
npm install
npm start         # 啟動 Electron app(內含 server + 控制台 + 投播)
npm run server    # 只啟動 server(純瀏覽器用,跳過 Electron)
npm run dist      # 打包成 portable exe (704-Minesweeper.exe)
```

兩種檢視模式:

| URL | 用途 |
|---|---|
| `http://localhost:3000/?face=all` | **本機玩 / 展示** — 單一視窗看到 5 面棋盤 + 地板模式按鈕 + Entrance,滑鼠點任何格子模擬觸控(沒硬體也能玩) |
| `http://localhost:3000/?face=wall-top` 等 6 個 | **場館投影** — WallProjector 每面投不同 URL |

TouchService 連 `ws://127.0.0.1:20111`(可用 `TOUCHSERVICE_URL` 環境變數蓋掉)。沒 TouchService 在跑時 server 仍會 serve view,只是只有滑鼠注入會觸發。

調整:
- `MINE_RATE=0.1 npm start` → 10% 地雷率
- `SEED=42 npm start` → 固定隨機種子(debug)
- `PORT=4000 npm start` → 改埠號

## 本機無硬體測試

**最簡單**:雙擊 `start.bat` → 瀏覽器自動開 `?face=all` → 滑鼠點牆面格子 → 點地板兩半 → 看到完整流程。

**有 TouchService 但無硬體**:
1. 啟動 TouchService(NangangProjection/builds 下的 exe)
2. 雙擊 `start.bat`
3. 跑 SensorSimulator 灌假觸控:`SensorSimulator.exe scenario scenarios/single-stomp.json`
4. 觀察 `?face=all` 即時跟著動;`?face=wall-top` 等也同步

## 現場部署

1. server: `npm start`(這個 repo 在現場機器跑)
2. WallProjector:把 `wallprojector-template/projections.json` 複製到 WallProjector 安裝目錄、覆蓋它原本的 `projections.json`,重啟它
3. 開機順序:**TouchService → Minesweeper server → WallProjector**

詳細現場 SOP 看 [docs/SOP.md](docs/SOP.md)。

## 跨面接合與調校

[config/board-topology.json](config/board-topology.json) 定義 5 條跨面接合邊。
現場玩起來如果跨面 0 格擴散方向不對,把該條 edge 的 `reverse` 改成 `true`,重啟 server。

## 檔案結構

```
704_Minesweeper/
├── start.bat    # 雙擊啟動(本機玩用)
├── server/      # Node.js 遊戲伺服器
├── views/       # all/wall/floor 三種 view + 共用 client.js
├── config/      # venue + 跨面拓樸
├── wallprojector-template/  # 給 WallProjector 用的範本
├── docs/SOP.md  # 現場啟動 SOP
└── test/        # node --test 單元測試
```

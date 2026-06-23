# 704 Minesweeper — 現場 SOP

## 第一次部署

1. **這個 repo 放到場館機**(跟 TouchService、WallProjector 同一台機器),路徑任意例如 `C:\704_Minesweeper\`。
2. 第一次裝套件:
   ```powershell
   cd C:\704_Minesweeper
   npm install
   ```
3. 把 `wallprojector-template\projections.json` 複製覆蓋到 WallProjector 安裝目錄(例如 `C:\WallProjector\projections.json`)。**先備份它原本的**。
4. 確認 `config\venue-704.json` 跟 TouchService 的 `venues\704.json` **欄位一致**(若 TouchService 之後重校過,要把更新後的版本複製過來覆蓋本 repo 的 venue-704.json,然後重啟 server)。

## 每場啟動順序

1. 開 TouchService(它的 .exe 或托盤圖示)— 確認狀態 listening
2. 開 minesweeper server:
   ```powershell
   cd C:\704_Minesweeper
   npm start
   ```
   啟動成功 console 會印:
   ```
   [TouchService] connected
   [TouchService] hello, venue=704, canvas=2688x3840
   [minesweeper] http://localhost:3000/
   [minesweeper] board: 1000 cells, 150 mines
   ```
3. 開 WallProjector,管理頁 `http://127.0.0.1:20121/` 按「還原全部 enabled」— 6 個牆面跟地板會同時投影起來

## 旋轉校正

走進場內看每面,如果內容是「橫的 / 倒的」:
- 打開 WallProjector 管理頁
- 在該面那一列把 rotation 下拉換一檔(0 / 90 / 180 / 270)
- 即時重啟那個槽套用,看正了就完成 — 值自動寫回 projections.json

## 跨面接合校正

走到任兩面相接的牆角,在邊界格摸一下,然後地板踩「揭露」。如果揭出 0 格的時候**只有自己這面在擴散、另一面沒同步擴散**,代表這條接合邊方向錯。

修法:
1. 編輯 `config\board-topology.json`
2. 找到對應的 edge(例如 `Wall Top` ↔ `Wall Left`)
3. `reverse` 從 `false` 改 `true`(或反過來)
4. 重啟 server(`Ctrl+C` 然後 `npm start`)

5 條 edge 一條一條試,記下最後的正確組合。

## 常見問題

- **server 啟動印 `[TouchService] disconnected`**:TouchService 沒在跑或 port 不對。確認 `ws://127.0.0.1:20111` 是 listening 的(瀏覽器開 `http://127.0.0.1:20111/` 應該看到 testpage)。
- **牆面 view 看不到棋盤**:打開 WallProjector 管理頁看那個槽狀態。如果是「重啟中」反覆出現,代表 minesweeper server 沒起來或 URL 不對。
- **摸牆沒反應**:看 server console 應該印觸控 log(目前沒設,要看可以加)。或開 TouchService 的 testpage 即時驗證硬體層收得到。
- **跨面擴散太瘋狂**:5 條 edge 的「比例對應」造成邊界格鄰居數 >8,揭 0 會傳得很遠。如果想要保守一點,把 mineRate 拉高(例如 `MINE_RATE=0.25 npm start`),0 格變稀少擴散就慢。

## 玩法調整(改參數重啟)

| 想要 | 改法 |
|---|---|
| 地雷少一點 | `MINE_RATE=0.08 npm start` |
| 地雷多一點 | `MINE_RATE=0.25 npm start` |
| 同一盤可重玩(固定佈局) | `SEED=42 npm start` |
| 鎖定 timeout 改長/短 | 改 `server/game.js` 的 `LOCK_TIMEOUT_MS` |
| 結束後 reset 等久一點 | 改 `server/game.js` 的 `RESET_DELAY_MS` |

## 關場

依序關 WallProjector → minesweeper server → TouchService。

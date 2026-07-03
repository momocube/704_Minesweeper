# TouchOSC 遙控投播

跟 704_GenerativeArt 同套流程 —— iPad(或任何 OSC client)發 UDP OSC 到操作員筆電,
Electron main 直接呼叫既有的投播函式。**不需要開 renderer**,不會跟遊戲狀態競爭。

## 網路設定

- **筆電**:跑 `704 Minesweeper.exe`(或 `npm start` dev 模式)。UDP OSC listener 開在 **9001**
- **iPad**:跟筆電同一個區網,TouchOSC 設 destination:
  - Host: 筆電內網 IP(例如 `192.168.1.42`)
  - Port: **9001**
  - Protocol: UDP

改 port 用環境變數:`OSC_PORT=9002 npm start`。

## OSC 位址對應表

| 位址 | 對應動作 | 對應控制台 UI |
|---|---|---|
| `/704mine/projector/windowed` | 開視窗模式投影(NDI Screen Capture HX / OBS 抓) | 🪟 視窗模式 |
| `/704mine/projector/secondary` | 全螢幕開到第二螢幕 | 🖥 自動 → 第二螢幕 |
| `/704mine/projector/close` | 關閉投影窗 | STOP_BROADCAST |
| `/704mine/projector/toggle` | 有就關、沒就開第二螢幕 | (綜合) |
| `/704mine/ping` | 只寫 log,測試連線用 | — |

**Value convention**:很多 TouchOSC 控件按下 + 放開都會送(先 1、放開 0)。
Listener 直接忽略 first arg = 0 的訊息,免得放開再觸發一次。所以 button 送 `1` 或
沒帶 arg 都行。

## TouchOSC layout 建議

4 顆 momentary button + 一顆 ping 測試按鈕,長按判定 = 100 ms 以下都可以觸發:

```
┌─────────────────────────────────┐
│         704 MINESWEEPER          │
│                                  │
│   ┌──────────┐   ┌──────────┐   │
│   │ 🪟 WINDOW│   │ 🖥 SECOND │   │
│   │  MODE    │   │  DISPLAY │   │
│   └──────────┘   └──────────┘   │
│                                  │
│   ┌──────────┐   ┌──────────┐   │
│   │ ⏻ CLOSE  │   │  TOGGLE  │   │
│   └──────────┘   └──────────┘   │
│                                  │
│                    ┌──────┐      │
│                    │ PING │      │
│                    └──────┘      │
└─────────────────────────────────┘
```

TouchOSC editor 設定每顆 button:
- Type: Push
- OSC address: 上表對應位址
- Value: `1`(或空白讓 TouchOSC 送預設 1)

## Arena / NDI 建議命名

- **704_Generative-Art**:目前 GA 的視窗 title(NDI source name 沿用)
- **704 Minesweeper Projector**:Minesweeper windowed 模式的視窗 title
  - Screen Capture HX 抓這個 title 出來就是獨立 NDI source
  - Arena 可以同時掛兩個 source,想 crossfade / 熱切都行

**分開頻道的好處**:兩支 exe 可以同時開,Arena 不用 close/open 來回切;
現場想切風格或 emergency fallback 都是一個 crossfade 就過去。

## 除錯

- 沒收到訊息 → 檢查筆電防火牆有沒有擋 UDP 9001(Windows Defender 通常會問)
- 收到但沒動作 → 看 Electron 的 log(從 `start.bat` 或 dev console),應該有
  `[electron] OSC <- /704mine/projector/xxx []` 這種行。沒的話是 iPad 網段 / IP 錯
- OSC port busy → 有其他 app 占用 9001,用 `OSC_PORT=9002 704Minesweeper.exe` 換

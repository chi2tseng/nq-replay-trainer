# -*- coding: utf-8 -*-
p = r"C:\Users\chi2t\Downloads\replay-trainer\index.html"
h = open(p, encoding="utf-8").read()

FONT = ('<link rel="stylesheet" href="src/styles.css" />\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0&display=block">')

def ms(n): return '<span class="material-symbols-outlined">%s</span>' % n

R = [
 ('<link rel="stylesheet" href="src/styles.css" />', FONT),
 ('<button id="btnToStart" title="回到此 session 開頭">⏮</button>',
  '<button id="btnToStart" title="回到此 session 開頭">%s</button>' % ms("skip_previous")),
 ('<button id="btnStepBack" title="退一根 (僅空手時)">◀</button>',
  '<button id="btnStepBack" title="退一根 (僅空手時)">%s</button>' % ms("chevron_left")),
 ('<button id="btnPlay" class="play" title="播放 / 暫停 (P)">▶</button>',
  '<button id="btnPlay" class="play material-symbols-outlined" title="播放 / 暫停 (P)">play_arrow</button>'),
 ('<button id="btnStepFwd" title="前進一根 (空白鍵)">▶|</button>',
  '<button id="btnStepFwd" title="前進一根 (空白鍵)">%s</button>' % ms("skip_next")),
 ('<button id="btnPickStart" title="點圖設 replay 起點 (空手時)">📍</button>',
  '<button id="btnPickStart" title="點圖設 replay 起點 (空手時)">%s</button>' % ms("my_location")),
 ('<button id="annUp" title="放上向上箭頭">↑ 箭頭</button>',
  '<button id="annUp" class="ico-btn" title="放上向上箭頭">%s箭頭</button>' % ms("arrow_upward")),
 ('<button id="annDown" title="放上向下箭頭">↓ 箭頭</button>',
  '<button id="annDown" class="ico-btn" title="放上向下箭頭">%s箭頭</button>' % ms("arrow_downward")),
 ('<button id="annLong" class="buy" title="標記做多">做多 L</button>',
  '<button id="annLong" class="ico-btn buy" title="標記做多">%s做多</button>' % ms("trending_up")),
 ('<button id="annShort" class="sell" title="標記做空">做空 S</button>',
  '<button id="annShort" class="ico-btn sell" title="標記做空">%s做空</button>' % ms("trending_down")),
 ('<button id="annClear" class="flat" title="清除所有標註">清除標註</button>',
  '<button id="annClear" class="ico-btn flat" title="清除所有標註">%s清除標註</button>' % ms("delete")),
 ('<button id="drwHL" title="水平線:點一下放在該價位">— 水平線</button>',
  '<button id="drwHL" class="ico-btn" title="水平線:點一下放在該價位">%s水平線</button>' % ms("horizontal_rule")),
 ('<button id="drwTL" title="趨勢線:點兩個端點">／ 趨勢線</button>',
  '<button id="drwTL" class="ico-btn" title="趨勢線:點兩個端點">%s趨勢線</button>' % ms("show_chart")),
 ('<button id="drwRay" title="射線:點兩點,往右延伸">↗ 射線</button>',
  '<button id="drwRay" class="ico-btn" title="射線:點兩點,往右延伸">%s射線</button>' % ms("north_east")),
 ('<button id="drwBox" title="矩形框:點兩個對角">▭ 矩形</button>',
  '<button id="drwBox" class="ico-btn" title="矩形框:點兩個對角">%s矩形</button>' % ms("crop_square")),
 ('<button id="drwClear" class="flat" title="清除所有繪圖">清除繪圖</button>',
  '<button id="drwClear" class="ico-btn flat" title="清除所有繪圖">%s清除繪圖</button>' % ms("ink_eraser")),
 ('<button id="btnBuy" class="buy">BUY · Long</button>',
  '<button id="btnBuy" class="ico-btn buy">%sBUY · Long</button>' % ms("add_circle")),
 ('<button id="btnSell" class="sell">SELL · Short</button>',
  '<button id="btnSell" class="ico-btn sell">%sSELL · Short</button>' % ms("remove_circle")),
 ('<button id="btnFlatten" class="flat">FLATTEN</button>',
  '<button id="btnFlatten" class="ico-btn flat">%sFLATTEN</button>' % ms("close")),
 ('<button id="btnReverse" class="rev">REVERSE</button>',
  '<button id="btnReverse" class="ico-btn rev">%sREVERSE</button>' % ms("swap_horiz")),
 ('<button id="btnCancelEntry" class="flat">取消掛單 Cancel</button>',
  '<button id="btnCancelEntry" class="ico-btn flat">%s取消掛單</button>' % ms("cancel")),
 ('<button id="tabTrades" class="tab active">交易紀錄 Trades</button>',
  '<button id="tabTrades" class="tab active ico-btn">%s交易紀錄</button>' % ms("receipt_long")),
 ('<button id="tabDash" class="tab">Dashboard</button>',
  '<button id="tabDash" class="tab ico-btn">%sDashboard</button>' % ms("dashboard")),
 ('<button id="btnExportCsv" class="mini">匯出 CSV</button>',
  '<button id="btnExportCsv" class="mini ico-btn">%s匯出 CSV</button>' % ms("download")),
 ('<button id="btnReset" class="mini danger">清空</button>',
  '<button id="btnReset" class="mini danger ico-btn">%s清空</button>' % ms("delete_sweep")),
 ('<button id="btnAtmSave" class="save">儲存範本</button>',
  '<button id="btnAtmSave" class="ico-btn save">%s儲存範本</button>' % ms("save")),
 ('<button id="btnAtmDel" class="del">刪除</button>',
  '<button id="btnAtmDel" class="ico-btn del">%s刪除</button>' % ms("delete")),
]
miss = []
for old, new in R:
    if old in h: h = h.replace(old, new, 1)
    else: miss.append(old[:55])
open(p, "w", encoding="utf-8").write(h)
print("applied %d/%d" % (len(R) - len(miss), len(R)))
for m in miss: print("  MISS:", m)

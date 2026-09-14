"""Pull NQ / ES / MNQ / MES tick days straight out of NinjaTrader 8's own tick database — no manual export needed.

NT8 caches every tick it has downloaded/recorded in <NT8 user dir>/db/tick/<instrument>/<yyyyMMddHH>.Last.ncd
(one file per hour). The format was reverse-engineered here and verified byte-exact against a
Historical Data export of 1,215,825 consecutive ticks (2026-09-07..09-10), zero mismatches:

  header  int32 version=1 | double tickSize | double firstPrice | int64 firstTime (.NET ticks, MACHINE-LOCAL time)
  record  flags | pb | [dt] | [ext] | [bid/ask] | vol
    flags bits 0-1  dt width: 0 none, 1 = 1 byte of whole SECONDS, 2 = 2 bytes of 100 ns, 3 = 4 bytes of 100 ns (big-endian)
    flags bit  6    price delta = (pb & 0x1f) - 16 ticks
    flags bit  7    one byte: price delta = byte - 0x80
    bits 6+7 both   marker byte 0x7f then signed 24-bit big-endian delta (only seen in the 09-11 08:30 flash crash)
    flags bits 3-5  bid/ask offsets from last, in ticks: 0..5 = fixed pairs (0,1)(1,0)(0,2)(2,0)(0,3)(3,0),
                    6 = one byte, high nibble bid / low nibble ask, 7 = two bytes bid, ask
    pb bit 7        volume width: set = 2 bytes, clear = 1 byte;  pb bit 6: value is in hundreds (round lots)

Output is the app's NinjaTrader tape: data/tick/<SYM>_<ET trading day>.nt.json + index_<SYM>_nt.json, same schema
as convert_nt_tick.py (1 tick = 1 print, bid/ask as tick offsets). NT only holds what it has downloaded: keep a
1-tick chart of each symbol open in NinjaTrader (or open them daily) and this script picks up whatever is new.

Usage: py import_nt_db.py [--force] [--days N]   (default: only days not yet converted, complete sessions only)
"""
import sys, os, glob, json, struct, datetime, collections
from zoneinfo import ZoneInfo

NTDIR = r"C:\Users\chi2t\OneDrive\文件\NinjaTrader 8\db\tick"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'tick')
ET = ZoneInfo("America/New_York")
LOCAL = datetime.datetime.now().astimezone().tzinfo          # .ncd timestamps are in the machine's zone
EPOCH = datetime.datetime(1, 1, 1)
FORCE = '--force' in sys.argv
# pb bit 7 = 2-byte volume (else 1 byte); bit 6 = the stored value is in HUNDREDS of contracts (a 500-lot is 0x40 + 0x05)
MODES = {0: (0, 1), 1: (1, 0), 2: (0, 2), 3: (2, 0), 4: (0, 3), 5: (3, 0)}

def be(b):
    v = 0
    for x in b: v = (v << 8) | x
    return v

def decode(path):
    b = open(path, 'rb').read()
    tick = struct.unpack('<d', b[4:12])[0]; px = round(struct.unpack('<d', b[12:20])[0] / tick)
    t = struct.unpack('<q', b[20:28])[0]; i = 28; out = []
    while i < len(b):
        f = b[i]; pb = b[i + 1]; i += 2
        code = f & 3
        if code == 1: t += b[i] * 10_000_000; i += 1
        elif code == 2: t += be(b[i:i + 2]); i += 2
        elif code == 3: t += be(b[i:i + 4]); i += 4
        if (f & 0xc0) == 0xc0: px += be(b[i + 1:i + 4]) - (1 << 24 if b[i + 1] & 0x80 else 0); i += 4   # 0x7f marker + signed 24-bit delta (flash moves, e.g. -188 ticks)
        elif f & 0x80: px += b[i] - 0x80; i += 1
        elif f & 0x40: px += (pb & 0x1f) - 16
        mode = (f >> 3) & 7
        if mode == 7: bid, ask = b[i], b[i + 1]; i += 2
        elif mode == 6: bid, ask = b[i] >> 4, b[i] & 0xf; i += 1
        else: bid, ask = MODES[mode]
        n = 2 if pb & 0x80 else 1; vol = be(b[i:i + n]) * (100 if pb & 0x40 else 1); i += n   # bit 6: stored in hundreds (round lots)
        out.append((t, px, -bid, ask, vol))
    return tick, out

SYMS = ['NQ', 'ES', 'MNQ', 'MES']

def main():
    for sym in SYMS: import_symbol(sym)

def import_symbol(sym):
    ip = os.path.join(OUT, f'index_{sym}_nt.json')
    have = set(json.load(open(ip))) if os.path.exists(ip) else set()
    folders = sorted(glob.glob(os.path.join(NTDIR, f'{sym} [0-9][0-9]-[0-9][0-9]')))   # "NQ 09-26", not "NQ" cash or spreads
    if not folders: print(f"{sym}: no tick folder in NinjaTrader db yet (open a 1-tick {sym} chart in NT)"); return
    print(f"{sym}: {len(folders)} contract folder(s)")
    days = collections.defaultdict(lambda: collections.defaultdict(list))   # day -> contract -> rows
    tick = 0.25
    for folder in folders:
        contract = os.path.basename(folder)
        for f in sorted(glob.glob(os.path.join(folder, '*.Last.ncd'))):
            tick, rows = decode(f)
            for t, px, bo, ao, vol in rows:
                loc = (EPOCH + datetime.timedelta(microseconds=t // 10)).replace(tzinfo=LOCAL)
                et = loc.astimezone(ET)
                day = (et + datetime.timedelta(hours=6)).strftime('%Y-%m-%d')
                days[day][contract].append((int(round(loc.timestamp() * 1000)), px, bo, ao, vol, et))
    written = []
    for day in sorted(days):
        contract = max(days[day], key=lambda c: sum(r[4] for r in days[day][c]))   # front month = the volume
        rows = days[day][contract]
        first_et, last_et = rows[0][5], rows[-1][5]
        starts_ok = first_et.hour == 18 and first_et.minute <= 5           # tape begins at the 18:00 ET Globex open
        later_day = any(d > day for d in days)                             # NT already holds a later day -> this one won't grow
        on_day = last_et.strftime('%Y-%m-%d') == day                        # the last tick must be on the trading day's own date: a tape ending at 19:xx the evening BEFORE is the first hour of a new day, not a close
        complete = later_day or (on_day and (last_et.hour > 16 or (last_et.hour == 16 and last_et.minute >= 59)))   # 16:59 close, or a holiday early close followed by more data
        if day in have and not FORCE: continue
        if len(rows) < 5000: print(f"  skip {day}: {len(rows)} ticks"); continue
        if not (starts_ok and complete) and not FORCE: print(f"  skip {day}: incomplete in NT db (ticks {first_et:%m-%d %H:%M} .. {last_et:%m-%d %H:%M} ET) — will retry once NT has the rest"); continue
        t0 = rows[0][0]
        rec = {"day": day, "sym": sym, "src": "nt", "contract": contract, "tick": tick, "t0": t0,
               "dt": [r[0] - t0 for r in rows], "p": [r[1] * tick for r in rows], "s": [r[4] for r in rows],
               "bo": [r[2] for r in rows], "ao": [r[3] for r in rows], "ev": [1] * len(rows)}
        path = os.path.join(OUT, f"{sym}_{day}.nt.json"); json.dump(rec, open(path, 'w')); written.append(day)
        print(f"  {day} {contract} {len(rows):,} ticks  {os.path.getsize(path)/1e6:.1f} MB")
    index = sorted(have | set(written)); json.dump(index, open(ip, 'w'))
    print(f"-> {sym}: {len(written)} new day(s); index_{sym}_nt.json {len(index)} days ({index[0]} .. {index[-1]})" if index else f"-> {sym}: nothing")

if __name__ == '__main__':
    main()

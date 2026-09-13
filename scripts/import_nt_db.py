"""Pull NQ tick days straight out of NinjaTrader 8's own tick database — no manual export needed.

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
    pb bits 5-7     volume width: 0x20 = 1 byte, 0xa0 = 2 bytes

Output is the app's NinjaTrader tape: data/tick/NQ_<ET trading day>.nt.json + index_nt.json, same schema as
convert_nt_tick.py (1 tick = 1 print, bid/ask as tick offsets). NT only holds what it has downloaded: keep a
1-tick NQ chart open in NinjaTrader (or open one daily) and this script picks up whatever is new.

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
VOLN = {0x00: 1, 0x20: 1, 0x80: 2, 0xa0: 2}   # bit 7 of pb = 2-byte volume; bit 5 varies between NT writers
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
        n = VOLN[pb & 0xe0]; vol = be(b[i:i + n]); i += n
        out.append((t, px, -bid, ask, vol))
    return tick, out

def main():
    ip = os.path.join(OUT, 'index_nt.json')
    have = set(json.load(open(ip))) if os.path.exists(ip) else set()
    folders = sorted(glob.glob(os.path.join(NTDIR, 'NQ *')))
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
        last_et = rows[-1][5]
        complete = last_et.hour == 16 and last_et.minute >= 59 or last_et.hour >= 17
        if day in have and not FORCE: continue
        if len(rows) < 5000: print(f"  skip {day}: {len(rows)} ticks"); continue
        if not complete and not FORCE: print(f"  skip {day}: session incomplete (last tick {last_et:%H:%M} ET) — NT hasn't downloaded the rest yet"); continue
        t0 = rows[0][0]
        rec = {"day": day, "sym": "NQ", "src": "nt", "contract": contract, "tick": tick, "t0": t0,
               "dt": [r[0] - t0 for r in rows], "p": [r[1] * tick for r in rows], "s": [r[4] for r in rows],
               "bo": [r[2] for r in rows], "ao": [r[3] for r in rows], "ev": [1] * len(rows)}
        path = os.path.join(OUT, f"NQ_{day}.nt.json"); json.dump(rec, open(path, 'w')); written.append(day)
        print(f"  {day} {contract} {len(rows):,} ticks  {os.path.getsize(path)/1e6:.1f} MB")
    index = sorted(have | set(written)); json.dump(index, open(ip, 'w'))
    print(f"-> {len(written)} new day(s); index_nt.json {len(index)} days ({index[0]} .. {index[-1]})" if index else "-> nothing")

if __name__ == '__main__':
    main()

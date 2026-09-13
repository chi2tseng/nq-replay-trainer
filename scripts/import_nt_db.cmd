@echo off
rem Every 4 h (Task Scheduler "ReplayTrainer-ImportNTTicks"): decode new NQ/ES/MNQ/MES tick days out of
rem NinjaTrader 8's db, gzip them, and push the .gz tapes so the GitHub Pages build has the same data.
cd /d D:\Tools\replay-trainer
echo ==== %date% %time% >> logs\import_nt_db.log
set PYTHONUTF8=1
"C:\Users\chi2t\AppData\Local\Programs\Python\Python312\python.exe" scripts\import_nt_db.py >> logs\import_nt_db.log 2>&1
"C:\Users\chi2t\AppData\Local\Programs\Python\Python312\python.exe" scripts\pack_gz.py >> logs\import_nt_db.log 2>&1
git add data/tick/*.json.gz >> logs\import_nt_db.log 2>&1
git diff --cached --quiet || (git commit -q -m "tick tapes: daily NinjaTrader import" && git push -q origin main) >> logs\import_nt_db.log 2>&1

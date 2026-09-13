@echo off
rem Daily: decode any new NQ tick days from NinjaTrader 8's db into data\tick\NQ_<day>.nt.json (see import_nt_db.py)
cd /d D:\Tools\replay-trainer
echo ==== %date% %time% >> logs\import_nt_db.log
"C:\Users\chi2t\AppData\Local\Programs\Python\Python312\python.exe" scripts\import_nt_db.py >> logs\import_nt_db.log 2>&1
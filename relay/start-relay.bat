@echo off
title OI Gold Pro relay
cd /d "%~dp0"
:loop
node rt-relay.mjs
echo relay stopped - restarting in 10 s...
timeout /t 10 >nul
goto loop

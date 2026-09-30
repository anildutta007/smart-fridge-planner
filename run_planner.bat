@echo off
title SmartFridge AI - Household Meal & Leftovers Planner
cd /d "%~dp0"
echo ========================================================
echo   SmartFridge AI - Household Meal Planner
echo   Powered by Google Gemini 2.5 Flash
echo ========================================================
echo Starting server on http://localhost:8050 ...
echo Press Ctrl+C to stop.
echo.
python server.py
pause

@echo off
title PS4 FTP MANAGER

if not exist "node_modules" (
    echo Installing npm packages...
    call npm install
    echo Packages installed!
)

cls
echo Starting server at http://localhost:3000
echo Press Ctrl+C to stop server

start http://localhost:3000
node server.js || exit
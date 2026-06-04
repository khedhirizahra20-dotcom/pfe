@echo off
setlocal enabledelayedexpansion
title FlexiTrack - Serveur (PostgreSQL)
echo.
echo  ====================================
echo   FlexiTrack - Demarrage du serveur
echo  ====================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERREUR : Node.js n'est pas installe.
    echo  Telechargez-le sur https://nodejs.org
    pause
    exit /b 1
)

REM Demarrer PostgreSQL (Scoop) si pas encore actif
set PG_BIN=C:\Users\MSI\scoop\apps\postgresql\current\bin
set PG_DATA=C:\Users\MSI\scoop\apps\postgresql\current\data
set PG_LOG=%PG_DATA%\pg_start.log
echo  Verification de PostgreSQL...

REM Supprimer un postmaster.pid fantome si le processus n'existe plus
if exist "%PG_DATA%\postmaster.pid" (
    for /f "tokens=1" %%p in (%PG_DATA%\postmaster.pid) do (
        tasklist /fi "PID eq %%p" 2>nul | findstr /i "%%p" >nul 2>&1
        if errorlevel 1 (
            echo  Nettoyage du verrou PostgreSQL residuel...
            del /f "%PG_DATA%\postmaster.pid" >nul 2>&1
        )
    )
)

"%PG_BIN%\pg_ctl.exe" status -D "%PG_DATA%" >nul 2>&1
if %errorlevel% neq 0 (
    echo  Demarrage de PostgreSQL...
    "%PG_BIN%\pg_ctl.exe" start -D "%PG_DATA%" -l "%PG_LOG%" -w -t 60
    if !errorlevel! neq 0 (
        echo.
        echo  ERREUR : Impossible de demarrer PostgreSQL.
        echo  Consultez le journal : %PG_LOG%
        pause
        exit /b 1
    )
    echo  PostgreSQL demarre.
) else (
    echo  PostgreSQL deja actif.
)
echo.

if not exist node_modules (
    echo  Installation des dependances...
    npm install
    echo.
)

REM Verifier si la base de donnees a ete initialisee
if not exist ".db_initialized" (
    echo  Initialisation de la base de donnees PostgreSQL...
    echo.
    node init_db.js
    if %errorlevel% neq 0 (
        echo.
        echo  ERREUR : Impossible d'initialiser la base de donnees.
        echo  Vous pouvez definir le mot de passe via : set PG_PASSWORD=votre_mot_de_passe
        pause
        exit /b 1
    )
    echo. > .db_initialized
)

echo  Serveur en cours de demarrage...
echo  Base de donnees : PostgreSQL (flexitrack)
echo  Appuyez sur Ctrl+C pour arreter le serveur.
echo.
start "" "http://localhost:3000"
node server.js
pause

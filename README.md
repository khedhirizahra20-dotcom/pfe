# FlexiTrack

Système de détection du déséquilibre musculaire basé sur l'électromyographie de surface (EMG), conçu pour les professionnels de la rééducation neuromusculaire.

## Présentation

FlexiTrack est une solution portable et connectée permettant la visualisation en temps réel de l'activité musculaire des érecteurs du rachis. Elle combine un dispositif d'acquisition EMG (AD8232 + ESP32) et une application web accessible depuis n'importe quel navigateur via Wi-Fi.

## Fonctionnalités

- Visualisation EMG en temps réel via WebSocket
- Gestion des patients et historique des séances
- Détection du déséquilibre musculaire gauche/droit
- Tableau de bord interactif avec modèle 3D anatomique
- Gestion des rendez-vous

## Stack technique

| Composant | Technologie |
|---|---|
| Backend | Node.js + Express |
| Temps réel | WebSocket (ws) |
| Base de données | PostgreSQL |
| Authentification | JWT + bcryptjs |
| Matériel | ESP32-WROOM-32 + AD8232 |
| Communication série | SerialPort |

## Installation

```bash
# Cloner le dépôt
git clone https://github.com/khedhirizahra20-dotcom/pfe.git
cd pfe

# Installer les dépendances
npm install

# Initialiser la base de données
node init_db.js

# Lancer le serveur
npm start
```

## Matériel requis

- Carte ESP32-WROOM-32
- Capteur biomédical AD8232
- Électrodes de surface (x3 par muscle)
- Réseau Wi-Fi local

## Architecture

```
ESP32 (AD8232) ──WiFi──► Serveur Node.js ──WebSocket──► Dashboard Web
                              │
                          PostgreSQL
```

## Auteur

Projet de fin d'études — Zeyneb Khedhiri

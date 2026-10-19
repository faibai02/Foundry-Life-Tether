# Life Tether — Foundry VTT Modul (D&D 5e)

[![Release Creation](https://github.com/faibai02/Foundry-Life-Tether/actions/workflows/release.yml/badge.svg)](https://github.com/faibai02/Foundry-Life-Tether/actions/workflows/release.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v11%20%7C%20v12-orange)](https://foundryvtt.com)

Ein Foundry VTT Modul zur vollständigen Automatisierung des Zaubers **Life Tether** für das D&D 5e Spielsystem.

---

## ✨ Features

- ⚡ **Visuelle Strahleffekte (Sequencer & JB2A)**  
  Erzeugt einen dynamischen grünen Energie-Strahl zwischen dem Zaubernden und den angebundenen Tokens, der sich mit den Tokens über das Battlemap bewegt.
- 🎯 **Upcasting-Unterstützung**  
  - **Grad 2:** 1 Ziel  
  - **Grad 4:** 2 Ziele  
  - **Grad 6:** 3 Ziele  
  - **Grad 8:** 4 Ziele  
  *(Formel: `1 + Math.max(0, Math.floor((castLevel - 2) / 2))`)*
- 🛡️ **Rettungswurf-Validierung (Midi-QOL)**  
  Bindet nur Tokens an, deren Weisheits-Rettungswurf (`Wisdom Save`) fehlgeschlagen ist.
- 🩸 **50 % Schadensübertragung (Nekrotisch)**  
  Erleidet der Zaubernde Schaden, werden **50 % (abgerundet)** des erlittenen Schadens unmittelbar als nekrotischer Schaden auf die angebundenen Ziele übertragen.
- 👁️ **Sichtlinien-Überwachung (Line-of-Sight)**  
  Prüft bei jeder Token-Bewegung über `canvas.walls.checkCollision(ray, { type: "sight" })`, ob Wände die Sichtlinie blockieren, und gibt einen Hinweis im Chat aus.
- 🧹 **Sauberes Aufräumen**  
  Beim Ablauf oder manuellen Entfernen des ActiveEffects werden die Strahleffekte und verknüpften Effekte automatisch und sauber beendet.

---

## 📦 Abhängigkeiten

Folgende Foundry-Module sind erforderlich:
- [Midi-QOL](https://foundryvtt.com/packages/midi-qol)
- [Sequencer](https://foundryvtt.com/packages/sequencer)
- *Empfohlen für Animationen:* **JB2A - Jules and Ben's Animated Assets** ([Free](https://foundryvtt.com/packages/JB2A_DnD5e) oder [Patreon](https://foundryvtt.com/packages/jb2a_patreon))

---

## 🚀 Installation via Manifest-URL

1. Öffne Foundry VTT im Setup-Bildschirm.
2. Wechsle auf **Add-on Modules** und klicke auf **Install Module**.
3. Füge folgende Manifest-URL in das Feld **Manifest URL** ein:
   ```text
   https://raw.githubusercontent.com/faibai02/Foundry-Life-Tether/main/module.json
   ```
4. Klicke auf **Install**.
5. Aktiviere das Modul **Life Tether** in den Moduleinstellungen deiner Spielwelt.

---

## 📖 Spielanleitung

1. Erstelle in Foundry ein Zauber-Item namens **Life Tether** (Zaubergrad 2, Rettungswurf: Weisheit, Wirkungsdauer: 1 Minute / 10 Runden).
2. Wähle das gewünschte Ziel / die Ziele an und wirke den Zauber.
3. Nach erfolgreichem Wurf und Rettungswurf-Check wird die visuelle Verbindung aufgebaut und der Active Effect gesetzt.
4. Sobald der Zaubernde Schaden nimmt, wird dieser automatisch anteilig weitergeleitet.

---

## 🛠️ GitHub Automation (CI/CD)

Dieses Repository verwendet GitHub Actions (`.github/workflows/release.yml`), um bei jedem neuen Git-Tag (`v*`) automatisch:
1. `module.json` mit der entsprechenden Release-Version zu versehen.
2. Das Modul-ZIP-Paket (`life-tether-spell.zip`) zu schnüren.
3. Ein GitHub Release mit angehängtem ZIP und `module.json` zu veröffentlichen.

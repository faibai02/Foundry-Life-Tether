# Task: Foundry VTT Modul "Life Tether" Setup & Release Pipeline

Ziel dieses Projekts ist die Erstellung, Automatisierung und Veröffentlichung des Foundry VTT (D&D 5e) Moduls **Life Tether** inklusive Visuals (Sequencer/JB2A), Schadensübertragung (Midi-QOL) und CI/CD-Pipeline für Manifest-URL-Installationen.

---

## 1. Vorbereitung & Modul-Dateien

- [x] **Repository-Struktur anlegen**
  - Ordner anlegen:

    ```text
    life-tether-spell/
    ├── .github/workflows/release.yml
    ├── scripts/
    │   └── life-tether.js
    ├── module.json
    ├── README.md
    └── task.md
    ```

- [x] **`module.json` konfigurieren**
  - ID festlegen: `life-tether-spell`
  - Manifest- und Download-URLs definieren:
    - `manifest`: `https://raw.githubusercontent.com/faibai02/Foundry-Life-Tether/main/module.json`
    - `download`: `https://github.com/faibai02/Foundry-Life-Tether/releases/download/{{version}}/life-tether-spell.zip`
  - Abhängigkeiten (`relationships.requires`) definieren: `midi-qol`, `sequencer`

- [x] **`scripts/life-tether.js` implementieren**
  - `midi-qol.RollComplete`: Target-Validation, Save-Checks, Upcasting (Level 2/4/6/8) und Effekt-Zuweisung
  - `Sequencer`: Dynamischer Strahl zwischen Caster und Tethered Token (`attachTo` & `stretchTo`)
  - `midi-qol.DamageRollComplete`: Abfangen von eingehendem Schaden auf dem Caster und direkte `necrotic`-Übertragung (50 %, abgerundet)
  - `updateToken`: Line-of-Sight-Prüfung (`canvas.walls.checkCollision(ray, { type: "sight" })`) mit Chat-Hinweis
  - `deleteActiveEffect`: Sauberes Beenden von Sequencer-Effekten bei Ablauf oder Entfernen des Tethers

---

## 2. GitHub Automation (CI/CD)

- [x] **GitHub Action Workflow erstellen (`.github/workflows/release.yml`)**
  - Trigger auf SemVer-Tags setzen (`tags: ['v*']`)
  - Workflow-Schritte definieren:
    1. Repository auschecken (`actions/checkout@v4`)
    2. Version ersetzen (`sed -i "s/{{version}}/${{ github.ref_name }}/g" module.json`)
    3. Modul-Ordner packen: `zip -r life-tether-spell.zip life-tether-spell`
    4. Release erzeugen und ZIP als Binary anhängen (`softprops/action-gh-release@v2`)

- [x] **Git-Workflow & Erstveröffentlichung**
  - Git initialisieren und Remote verknüpfen:

    ```bash
    git init
    git remote add origin https://github.com/faibai02/Foundry-Life-Tether.git
    ```

  - Dateien committen und auf `main` pushen:

    ```bash
    git add .
    git commit -m "feat: initial setup for life tether spell automation"
    git branch -M main
    git push -u origin main
    ```

  - Release-Tag erstellen und pushen:

    ```bash
    git tag v1.0.0
    git push origin v1.0.0
    ```

  - In GitHub Actions prüfen, ob der Build durchläuft und das Release `v1.0.0` mit angehängter `life-tether-spell.zip` angelegt wurde.

---

## 3. Foundry VTT Test & Validierung

- [ ] **Installation via Manifest**
  - Im Foundry Setup unter **Add-on Modules → Install Module** die Raw-URL der `module.json` eintragen und installieren.
  - Prüfen, ob der Ordner `Data/modules/life-tether-spell` korrekt angelegt wurde.

- [ ] **Funktionstest in D&D 5e Spielwelt**
  - Modul in den Einstellungen aktivieren (zusammen mit Midi-QOL und Sequencer).
  - Zauber **Life Tether** wirken (Wisdom Save triggern).
  - Prüfen, ob der grüne Sequencer-Strahl zwischen den Tokens gerendert wird.
  - Dem Zaubernden Schaden zufügen → Verifizieren, ob das Ziel 50 % nekrotischen Schaden im Chat erhält.
  - Token hinter eine Sichtlinie blockierende Wand ziehen → Verifizieren, ob die Chat-Meldung erscheint.
  - Active Effect manuell entfernen → Verifizieren, ob der Strahl verschwindet.

---

> Möchtest du noch ein passendes `README.md` für das Repository, damit andere Spieler die Abhängigkeiten und Nutzung direkt verstehen?

> Wenn ja, kann ich dir eine strukturierte README mit Installationsanleitung, Modul-Abhängigkeiten und Konfigurationshinweisen erstellen.
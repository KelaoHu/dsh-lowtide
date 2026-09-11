<div align="center">

# dsh-lowtide

**Aufgaben einreihen, wenn's teuer ist. Laufen von selbst, wenn's billig ist.**

<sub>Halb- oder vollautomatisch, an den Stoßzeiten und Spitzenpreisen der Modelle vorbei. Ein Pflicht-Plugin für DeepSeek Harness.</sub>

**Deutsch** | [English](../README.md) | [简体中文](../README.zh-CN.md) | [繁體中文](../README.zh-HK.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [한국어](./README.ko.md)

<img src="../assets/overview.png" alt="lowtide overview" width="100%">

</div>

> **Hinweis zur Oberflächensprache:** in der aktuellen Version ist die Oberfläche (UI) des lowtide-Plugins nur auf **vereinfachtem Chinesisch** und **Englisch** verfügbar; die Sprachauswahl in der Anwendung bietet keine weiteren Sprachen an. Dieses README ist eine deutsche Übersetzung des englischen Originaldokuments, die lediglich zu Ihrer Lesebequemlichkeit erstellt wurde. Die Funktionsweise des Plugins hängt nicht von der Sprache dieses Dokuments ab.

---

![hero](../assets/screenshots/hero.png)

<p align="center"><i>Drei Aufgaben warten in der Warteschlange, die Preis-Anzeige leuchtet im Sitzungs-Header, automatische Ausführung sobald Ihr Zeitfenster beginnt</i></p>

## Einführung

lowtide ist ein Plugin für [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh). Das Problem, das es löst, ist schlicht und völlig natürlich:

Normalerweise, wenn Sie möchten, dass ein Agent etwas erledigt, sitzen Sie vor dem Computer, schicken dem Agenten eine Anweisung, warten auf die Antwort und prüfen sie dann von Hand. Doch dieser Arbeitsablauf vergisst offenbar, dass Sie reichlich Leerlauf haben — und eine Chance, die Spitzen-/Nebenzeiten-Preise zu umgehen, die einige Modelle verlangen.

Mit installiertem lowtide läuft der Tag so ab: Wann immer Ihnen tagsüber eine Aufgabe einfällt, werfen Sie sie in die Warteschlange, werfen einen Blick darauf, geben sie frei. Die Aufgaben sammeln sich bis zu der von Ihnen festgelegten Zeit (z. B. nach 19 Uhr — dann gilt bei DeepSeek der Nebenzeiten-Preis), und laufen dann von selbst. Am nächsten Morgen öffnen Sie den Bericht: behalten, was gut war, zurückschicken, was nicht.

Das ist alles. Aber nutzen Sie es eine Woche lang, und Ihr Arbeitsrhythmus verlangsamt sich spürbar — und vergessen Sie nicht: „Zeit ist Geld, Effizienz ist Leben"……

Einige zentrale Fähigkeiten:

- Vier Ausführungsstrategien: einzeln, iterativ, Stichprobe, Überprüfung — von „ein Durchgang genügt" bis „fünf Kandidaten laufen lassen, und ich wähle"
- 168 Unit-Tests + 10 End-to-End-Spezifikationen, CI grün auf ubuntu / windows × node 22 / 24
- Ein einziges Build-Artefakt dient Desktop und Web — einmal installiert, funktioniert es überall
- Die Ausführung in Nebenzeiten trifft DeepSeeks Talstunden: Derselbe Stapel kostet etwa die Hälfte des Spitzenpreises

## Ein normaler Tag mit einem Agenten könnte so aussehen …

**Zehn Minuten vor Feierabend.** Sie haben das Code-Review beendet und legen drei Tickets für morgen an: eine Refaktorierung (iterativ, 3 Runden), einen Wochenbericht (einzeln) und ein Design, bei dem Sie unsicher sind (Stichprobe, 4 Kandidaten). Geben Sie alle frei, schalten Sie ab, gehen Sie. Morgen an Ihrem Schreibtisch sagt der Morgenbericht: Die Refaktorierung ist fertig, der Bericht ist entworfen, und vier Design-Kandidaten stehen nebeneinander, jeder mit seinen Kosten.

**Freitagabend.** Stellen Sie eine Woche voller Aufgaben auf einmal in die Warteschlange: Abhängigkeitsbereinigung, fehlende Tests, Datenskripte. Am Wochenende gilt rund um die Uhr der Talpreis. Sie gehen aus; es arbeitet zu Hause. Montag prüfen Sie den Bericht — wiederholen, was fehlschlug, übernehmen, was gut ist.

**Eine Eingebung um 10 Uhr morgens.** Sie sind mitten in einem Gespräch mit dem Agenten über einen dringenden Bug, als Sie denken: „Ach, aktualisiere auch die Doku." Die Abfang-Karte erscheint: Jetzt ausführen kostet den Spitzenpreis, heute Nacht etwa die Hälfte — der Unterschied wird erklärt. Klicken Sie auf „Für Nebenzeiten einreihen"; Ihr Entwurf bleibt unangetastet, und Sie kehren zum Bug zurück.

**Ein immer laufender Server.** Sie haben eine Maschine, die dsh 24/7 betreibt. Wechseln Sie in den vollautomatischen Modus L3, und legen Sie von überall Aufgaben über die API ab (`POST /ds-lowtide/tasks`). Es führt sie planmäßig aus und schreibt den Bericht. Niemand schaut zu, aber die Sandbox, das Tagesbudget und die Dateisperren sind weiterhin da.

**Etwas, das zu einem Kunden geht.** Nutzen Sie die Überprüfungsstrategie: einmal ausführen, dann automatisch eine unabhängige Sitzung öffnen, die das Ergebnis anhand Ihres gewählten Fokus zerpflückt (z. B. „Suche Fehler in den Datenquellen"). Am Morgen erhalten Sie kein nacktes Ergebnis — Sie erhalten ein Ergebnis plus eine kritische Überprüfung.

**Im Ausland leben.** Sie sind in San Francisco; DeepSeeks Spitzenzeit ist Pekinger Zeit, was für Sie den Vorabend und die Nacht davor bedeutet. Die Einstellungen konvertieren die offiziellen Stunden in Ihre lokale Uhr, Übernahme mit einem Klick. Sie legen Fenster nach Ihrem eigenen Zeitplan fest, und die Bücher bleiben immer mit der offiziellen Tabelle ausgerichtet.

## So funktioniert lowtide

```
① Annahme              ② Prüfung              ③ Ausführung            ④ Abnahme
Wann immer Sie einen    Das Queue-Dock         Wenn das Tal-Fenster    Wenn Sie zurück
Moment haben: ein       gruppiert Aufgaben     sich öffnet: fünf       sind: öffnen Sie
Klick auf der           nach Arbeitsbereich;   Preflight-Tore →        den Bericht —
Abfang-Karte, oder →    prüfen Sie Zeile →     bestehen, dann          Ergebnisse + Diff
legen Sie ein Ticket    für Zeile:             Sandbox-Ausführungen    + tatsächliche
an (4 Strategien)       ✓freigeben ⏸aufschieben  ein Stapel pro Fenster  Ausgaben
                        ✕verwerfen / alles freigeben                     + gespartes Geld
```

Der Lebenszyklus einer Aufgabe: `pending-review → queued → preflight → running → done / failed / stale / timeout`, zusätzlich `deferred` (aufgeschoben) und `dropped` (weiches Löschen, wiederherstellbar).

Schritt zwei ist das, was lowtide von einem „vollautomatisierten Skript" unterscheidet: **Jede Aufgabe muss von Ihrer Hand freigegeben werden, bevor sie läuft** (in L2 geben Sie den ganzen Stapel auf einmal frei, 30 Minuten vor dem Fenster). Die Maschine kann sich nicht selbst in die Ausführungswarteschlange schieben. Die Ausführung ist automatisiert; Entscheidungen sind es nicht. Deshalb können Sie es sich leisten, abwesend zu sein.

## Ein Rundgang durch die lowtide-Oberfläche

**Das Modal für neue Aufgaben.** Vier Strategien nebeneinander, jede mit einem Hinweis in klarer Sprache; Runden, Priorität und Ausführungsmodus werden mit jeder Aufgabe mitgeführt — kein Umweg über die Einstellungen. Aufgaben landen als „pending review". Nichts umgeht Sie, um in die Warteschlange zu gelangen.

![new-task-modal](../assets/screenshots/new-task-modal.png)

**Erweiterte Optionen.** Modell, Denkaufwand, Priorität von 0 bis 9, neue Sitzung oder vorherige fortsetzen, und die Liste der gesperrten Dateien — alles in einem kleinen Bereich. Gesperrte Dateien, kurz: Alles auf der Liste wird vor der Ausführung per sha256 geprüft; stimmt es nicht mit dem überein, was Sie eingereicht haben, wird die Aufgabe veraltet (`stale`) und weigert sich zu laufen. Andernfalls könnte die Datei, auf die sich Ihre Aufgabe bezieht, während des Wartens von einer anderen Aufgabe überschrieben werden, und diese würde blind darüber hinweg trampeln.

![advanced-options](../assets/screenshots/advanced-options.png)

**Wählen Sie ein beliebiges Modell.** Die Stapelausführung nutzt standardmäßig das offizielle `deepseek-flash`, aber jede Aufgabe kann ihr eigenes Modell wählen — alles, was mit Ihrem Harness verbunden ist, erscheint im Dropdown, gruppiert nach Anbieter. Private Anbieter funktionieren ebenfalls. Nicht-offizielle Modelle haben keine öffentliche Preistabelle, daher sagt das Hauptbuch ehrlich „Preis unbekannt"; fügen Sie in den Einstellungen eine Preis-Übersteuerung hinzu, wenn Sie die Buchführung exakt wollen.

![model-picker](../assets/screenshots/model-picker.png)

**Der Fenster-Editor.** Mehrsegmentig, über Mitternacht, pro Wochentag — alles möglich. Darunter ein Live-Preisband über 24 Stunden: rot für Spitze, grün für Tal, und eine Markierung, die zeigt, wo Sie sich gerade befinden. Außerhalb von UTC+8 wandelt ein Klick auf „offizielle Spitzenzeiten übernehmen" die Pekinger Zeit in Ihre lokale Uhr um.

![window-editor](../assets/screenshots/window-editor.png)

**Die Einstellungsseite.** Fensterzeiten, Aufgaben pro Stapel, Dauerlimit pro Aufgabe, Parallelität, Tagesbudget, Berichtsverlauf, Autonomiestufe, Preis-Übersteuerungen — alles grafisch, keine Konfigurationsdateien. Die offiziellen Preisregeln (einschließlich des neuen Talpreises am ganzen Wochenende) werden auf derselben Seite in menschlicher Sprache erklärt.

![settings](../assets/screenshots/settings.png)

Drei weitere Oberflächen verstecken sich im Tagesablauf: die **Preis-Pille** (Sitzungs-Header — beschäftigt/inaktiv, Warteschlangengröße; Klick zum Bearbeiten der Fenster), die **Abfang-Karte zu Spitzenzeiten** (tippen in der Spitzenzeit, sie erscheint; der Preisunterschied wird erklärt; Ihr Entwurf überlebt) und der **Ausführungsbericht** (das Morgen-Briefing: Ersparnisse zuerst, Anomalien angeheftet, Kandidaten warten auf Ihre Wahl, Markdown-Kopie mit einem Klick).

## Über die Arbeitsbereiche von lowtide

Jede Aufgabe läuft in einem Arbeitsbereich. Dieses eine Dropdown entscheidet über drei Dinge.

**Welche Dateien es berühren darf.** Aufgaben laufen in einer Sandbox, deren Grenze das Arbeitsbereichsverzeichnis ist. Falsch gewählt: bestenfalls findet es die Dateien nicht; schlimmstenfalls bearbeitet es etwas, das es nicht sollte.

**Mit wem es sich einreiht.** Aufgaben im selben Arbeitsbereich laufen seriell (zwei Aufgaben streiten sich nie um ein Repository); verschiedene Arbeitsbereiche laufen parallel (Standard-Limit 3, einstellbar). Wollen Sie Durchsatz? Verteilen Sie unabhängige Arbeit auf mehrere Arbeitsbereiche. Wollen Sie Ordnung? Behalten Sie alles in einem.

**Wie Berichte sich gruppieren.** Sowohl das Dock als auch der Morgenbericht organisieren sich nach Arbeitsbereich — sobald Sie echtes Volumen haben, zahlt sich diese Gruppierung aus.

Das Dropdown Arbeitsbereich im Ticket-Modal hat drei Quellen: **Aktuellen Arbeitsbereich verwenden** (in dem Ihre Sitzung lebt — der häufige Fall), **einen vorhandenen Arbeitsbereich aus der Liste** (jeder mit seinem absoluten Pfad, damit Sie immer wissen, um welches Projekt es sich handelt), oder **Benutzerdefinierter Pfad…** (von Hand eintippen). Wenn Sie „Vorherige fortsetzen" als Sitzungsmodus gewählt haben, wählen Sie auch den Arbeitsbereich und das genaue Gespräch — die Aufgabe nimmt den Kontext dieses Gesprächs wieder auf.

Mein Rat: **ein Projekt, ein Arbeitsbereich — mischen Sie nicht.** Der Git-Snapshot und die Dateisperren im Preflight sind auf den Arbeitsbereich begrenzt; Projekte in einem Arbeitsbereich zu mischen ist ein guter Weg, sich selbst zu verwirren.

## Vier Strategien und wann man welche nutzt

| Strategie | Was sie tut | Wann man sie heranzieht | Kosten |
|---|---|---|---|
| **Einzeln** | Ein Durchgang, fertig | Einfache, klar definierte Aufgaben | 1× |
| **Iterativ** | 2–5 Runden in einer Sitzung, jede verbessert die vorherige durch Ihre „Iterationslinse"; endet früh, wenn zwei Runden ähnlich genug sind | Arbeit, die Politur braucht: Schreiben, Pläne, Code | ~N× |
| **Stichprobe** | 2–5 isolierte Sitzungen produzieren jeweils einen vollständigen Kandidaten, nebeneinander mit Kosten angezeigt — **Sie** wählen; die Maschine fällt kein ästhetisches Urteil | Titel, Ideen, Designs: Sie wollen Optionen, keine Antwort | ~N× |
| **Überprüfung** | Nach der Ausführung zerpflückt eine unabhängige Sitzung das Ergebnis anhand Ihres „Überprüfungsfokus" und schreibt ihre Befunde auf | Wichtige Ergebnisse, ein letzter Durchgang vor dem Versand | ~2× |

## Drei Autonomiestufen

- **L1 pro Aufgabe**: jede Aufgabe braucht Ihr individuelles ✓. Nutzen Sie es am Anfang oder wenn das Repository kostbar ist.
- **L2 pro Stapel** (Standard): Aufgaben warten in der Prüfung; eine Tor-Karte erscheint 30 Minuten vor dem Stapel und gibt alles auf einmal frei; keine Freigabe, keine Ausführung. Der tägliche Begleiter.
- **L3 vollautomatisch**: eingereichte Aufgaben reihen sich sofort ein und laufen in der Sandbox zu Nebenzeiten, null Bestätigungen (der Wechsel fragt zweimal). Gebaut für immer laufende Server.

Einzelne Aufgaben können die globale Stufe im Ticket-Modal übersteuern.

## Architektur: wie es funktioniert, während Sie weg sind

Einen Agenten Stapeljobs ausführen zu lassen, während Sie schlafen, ist viel verlangt. Vier Schichten darunter machen es sicher.

**Der Cordis-Mikrokern.** dsh läuft auf dem Plugin-Ökosystem des Cordis-Mikrokerns: jede Fähigkeit ist ein Plugin, und Plugins kommunizieren über Service-Injektion statt direkter Abhängigkeit. Die Host-Hälfte von lowtide ist eine Reihe wohlerzogener Cordis-Dienste — Routen, Scheduler, Zustandsmaschine — jeder erledigt seine Aufgabe, im Kern registriert, startet mit dem Harness, deinstalliert sich sauber. In klaren Worten: Es ist keine aufgeklebte Haut auf dsh; es ist ein Organ, das im Kern wächst.

**Zwei Gesichter, ein Artefakt.** Die Host-Hälfte (Node.js) besitzt Planung, Ausführung und Hauptbuch; die Browser-Hälfte (React) besitzt jedes Pixel. Ein Build produziert beide — und da die GUI von dsh Desktop selbst im Web gerendert wird, brauchen Desktop und Web keine getrennten Zweige. Gleiche Bytes, gleiches Verhalten.

**Ein plattformunabhängiger Kern.** `lowtide-core` enthält das Fenstermodell, Preistabellen, die Abrechnungsformel, die Warteschlangen-Übersicht, das Hauptbuch und die Stapel-Fenster-Mathematik — alles reine Funktionen, die keine dsh-APIs berühren, veröffentlicht als eigenes Paket mit eigenen Tests. Der praktische Nutzen: Der Kern wurde von 44 Pure-Function-Unit-Tests gehämmert, und wenn Sie lowtide jemals auf ein anderes Agenten-Framework portieren, lässt sich dieses Paket intakt herauslösen.

**Verteidigung in der Tiefe.** Fünf Preflight-Tore (ist der Arbeitsbereich noch da, hat sich der Git-HEAD bewegt, stimmen die sha256 der gesperrten Dateien, passt das Fenster, ist Budget übrig) — scheitert eines, wird die Aufgabe veraltet oder aufgeschoben; niemals ein blinder Lauf. Drei Sandbox-Voreinstellungen mit Genehmigung auf „never" — unbeaufsichtigt bedeutet, dass niemand da ist, um auf „erlauben" zu klicken, also wird das Erlaubte vor Beginn der Ausführung entschieden. Die Zustandsdatei wird atomar geschrieben und rollt bei Korruption auf ein Backup zurück. HTTP-Routen akzeptieren nur Same-Origin-Anfragen von dieser Maschine.

Die Zustandssynchronisierung nutzt SSE mit 4-Sekunden-Polling als Ausweichlösung — die Warteschlange bewegt sich, die Oberfläche bewegt sich mit.

## Installation

**Ein-Befehl-Installation (vorgefertigt):** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz` — oder unten aus dem Quellcode bauen.

Voraussetzungen: Node `^22.19 || >=24`, pnpm `11.7`. Alles ist auf der öffentlichen npm-Registry — keine private Registry nötig.

Installieren Sie zuerst dsh (wählen Sie eines): Desktop über die offiziellen Kanäle von DeepSeek, oder `npm install -g @deepseek-ai/dsh` für die CLI. Konfigurieren Sie dann ein funktionierendes Modell in den dsh-Einstellungen (z. B. einen offiziellen DeepSeek-API-Schlüssel) — lowtide berührt Ihre Zugangsdaten nie.

Dann klonen, bauen, installieren:

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# Bauen Sie zuerst die Kernschicht (die Tests des Plugins lösen ihre Ausgabe auf)
pnpm --filter lowtide-core bundle
# Dann das Plugin: Host-Hälfte + Browser-Hälfte in einem Durchgang
pnpm --filter dsh-lowtide bundle

# In ein Profil installieren — ein Artefakt dient Desktop und Web
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile desktop add ./packages/dsh-lowtide   # Desktop
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add ./packages/dsh-lowtide       # Web

# Dev-Instanz starten (Port 3080)
pnpm --filter dsh-lowtide dev
```

Öffnen Sie danach dsh: Sie sollten die Preis-Pille im Sitzungs-Header und das Queue-Dock neben dem Eingabebereich sehen. Wenn nicht, prüfen Sie das FAQ unten.

## Tägliche Nutzung

**Drei Möglichkeiten, eine Aufgabe einzureichen.** Die Abfang-Karte (in der Spitzenzeit tippen, ein Klick, Ihr Entwurf wird unverändert zum Ticket); das Ticket-Modal („Neu" neben dem Eingabebereich — Prompt, Strategie, Runden, Priorität); oder die API (`POST /ds-lowtide/tasks`, schließen Sie sie an Ihre eigene Automatisierung an).

**Leben im Queue-Dock.** Gruppiert nach Arbeitsbereich in ausstehend / erledigt / verworfen. Inline pro Aufgabe: ✓ freigeben, ⏸ aufschieben, ✕ verwerfen (weiches Löschen, wiederherstellbar). „Alles freigeben" gibt alles frei; „Erledigte bereinigen" hält es ordentlich (die Bücher bleiben unberührt); „Jetzt ausführen" überspringt das Warten und startet sofort einen Stapel — so debuggen Sie.

**Zeitsemantik.** Offizielle Spitzenzeiten werden in **Pekinger Zeit** bewertet (DeepSeek rechnet in Pekinger Zeit ab, damit bleiben die Bücher ausgerichtet; am Wochenende gilt den ganzen Tag Talpreis). Ihre benutzerdefinierten Fenster und das Ausführungsfenster werden in **Ihrer lokalen Zeit** bewertet, mit Über-Mitternacht-Bereichen und Regeln pro Wochentag. Fensterende stoppt neue Starts; laufende Aufgaben werden nie unterbrochen.

**Das Hauptbuch.** `ledger[YYYY-MM-DD] = { yuan, savedYuan }` — Ausgaben und Ersparnisse, täglich akkumuliert. Der angezeigte Preis ist der abgerechnete Preis: eine Formel, bis zur letzten Ziffer prüfbar.

## Konfigurationsreferenz

`GET /ds-lowtide/config` liest; `PUT` aktualisiert teilweise (nicht gelistete Felder werden abgelehnt):

| Feld | Typ | Standard | Hinweise |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | Autonomiestufe; Übersteuerung pro Aufgabe im Ticket-Modal |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | Ausführungsfenster für Nebenzeiten (lokale Zeitzone) |
| `batch.tz` | IANA-Zeitzone | System | Zeitzone des Ausführungsfensters (leer = lokal) |
| `batch.gateLeadMin` | Minuten | `30` | Vorlaufzeit des Stapel-Tors |
| `batch.maxTasksPerNight` | Zahl | `10` | Obergrenze Aufgaben pro Stapel |
| `batch.maxDurationMin` | Minuten | `240` | Dauerlimit pro Aufgabe (bei Zeitüberschreitung abbrechen + ein erneuter Versuch) |
| `batch.maxConcurrency` | Zahl | `3` | Maximale Parallelität 1–8 (seriell pro Arbeitsbereich, parallel zwischen ihnen) |
| `batch.paused` | boolesch | `false` | Automatische Stapelverarbeitung pausieren |
| `budgetDailyYuan` | ¥ | `0` | Tagesbudget (0 = unbegrenzt) |
| `windows[]` | Array | `[]` | Benutzerdefinierte Fenster; leer = offizielle Spitze (Pekinger Zeit) |
| `windows[].level` | `peak\|off\|custom` | — | Spitze / Tal / benutzerdefiniert (Talpreis × Multiplikator) |
| `windows[].start/end` | `"HH:MM"` | — | Lokale Uhr, über Mitternacht unterstützt |
| `windows[].days` | Array `1..7` | jeden Tag | ISO-Wochentage (1 = Mo … 7 = So) |
| `windows[].tz` | IANA-Zeitzone | System | Zeitzone pro Fenster |
| `windows[].multiplier` | Zahl | `1` | Talpreis-Multiplikator für benutzerdefinierte Fenster |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | offiziell | Übersteuerungen der Preistabelle |

## HTTP-API

Präfix `/ds-lowtide/`, hinter der Same-Origin- und Loopback-Vertrauensgrenze:

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/state` | Aggregierter Zustand (Preise/Countdown/Warteschlange/letzter Bericht) |
| GET | `/events` | SSE-Inkremental-Push (Client fällt auf 4s-Polling zurück) |
| GET/PUT | `/config` | Konfiguration lesen/schreiben |
| POST | `/tasks` | Ein Ticket einreichen |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | Prüfung und Verwaltung |
| POST | `/tasks/approve-all` | Alles freigeben |
| POST | `/estimate` | Schätzung: Spitze vs. Tal |
| POST | `/batch/run-now` | Stapel jetzt ausführen |
| POST | `/dismiss` | Keine Abfangung für den Rest des Tages |
| GET | `/health` | Herzschlag |

## Berechtigungs-Voreinstellungen

| preset | sandbox | Genehmigung |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

Die Annahme-UI bietet keine Wahl — alle Aufgaben laufen unter `lt-standard`; die anderen beiden bleiben für API-Aufrufer (`permissionPreset` bei `POST /tasks`). Nichts läuft ohne Preflight.

## Daten und Zustand

- Alles wird in `$DSH_HOME/lowtide.json` gespeichert (atomare Schreibvorgänge, automatisches Rollback bei Korruption); mit gesetztem `DSH_PROFILE` wird der Zustand pro Profil isoliert. **Ein Schreiber pro Datei zur gleichen Zeit** — führen Sie Desktop und Web nicht gleichzeitig ohne Profil-Isolierung aus.
- Ein Stapel pro Fenster, über Mitternacht sicher; eine leere Warteschlange erzeugt keinen leeren Bericht.
- Aufschiebe-Wiederherstellung: Bei Fensterbeginn werden per Preflight aufgeschobene Aufgaben automatisch neu eingereiht (nach ≥3 fehlgeschlagen); manuell aufgeschobene kehren zu pending-review zurück.

## Tests und CI

```powershell
pnpm --filter lowtide-core test    # 44 Pure-Function-Kerntests
pnpm --filter dsh-lowtide test     # 124 Plugin-Unit-Tests
pnpm --filter dsh-lowtide exec playwright test   # e2e (benötigt dsh web auf :3080)
```

Zehn e2e-Spezifikationen laufen seriell, vom Zwei-Gesichter-Lade-Smoke bis zur vollständigen Annahme→Prüfung→Ausführung→Bericht-Schleife gegen die echte API. Das Repository enthält einen GitHub-Actions-Workflow: Jeder Push / PR führt install, build, typecheck sowie die vollständige Unit-Suite auf vier Umgebungen aus.

## Sicherheit

- Routen akzeptieren nur Loopback + Same-Origin; **setzen Sie Port 3080 nicht dem öffentlichen Internet aus** — nutzen Sie einen SSH-Tunnel oder einen authentifizierten Reverse-Proxy.
- Die Windows-Sandbox ist mitigationsstufig; Linux/macOS setzen vollständig durch. Für unbeaufsichtigte Nutzung stapeln Sie die Datei-Whitelist und das Tagesbudget.
- Der Wechsel zu L3 vollautomatisch fragt zweimal.
- Die Zustandsdatei enthält vollständige Aufgaben-Prompts und Pfade; behandeln Sie Backups entsprechend.
- Melden Sie Schwachstellen privat über [SECURITY.md](../SECURITY.md).

## FAQ

**Das Fenster kam und nichts lief?**
Prüfen Sie der Reihe nach: Aufgaben freigegeben? → „Tal-Stapel pausieren" angehakt? → Tor freigegeben? → Budget erschöpft? → Preflight fehlgeschlagen (die Aufgabe wird `stale`, Grund in der Detailansicht)?

**Warum wählt die Stichprobe den Gewinner nicht automatisch?**
Absichtlich. Die Maschine fällt kein ästhetisches Urteil — Kandidaten und Kosten stehen nebeneinander, und Sie klicken auf „diesen wählen".

**Ich bin im Ausland und die Spitzenzeiten passen nicht zu meinem Zeitplan?**
Die Einstellungen zeigen, wie die offiziellen Stunden lokal aussehen; legen Sie benutzerdefinierte Fenster für Ihren eigenen Rhythmus an, oder klicken Sie auf „offizielle Spitzenzeiten übernehmen (in meine Zeitzone umgerechnet)".

**Schätzung und tatsächliche Ausgaben stimmen nicht überein?**
Schätzungen verwenden eine grobe Obergrenze für Eingabe-Tokens; tatsächliche Ausgaben verwenden den realen Verbrauch (Ausgabe und Cache-Treffer eingeschlossen). Beide Zahlen stehen im Bericht.

**Eine Aufgabe wurde veraltet (`stale`)?**
Preflight fehlgeschlagen: Arbeitsbereich verschwunden, Git-Snapshot bewegt, eine gesperrte Datei geändert, Budget zu knapp oder das Fenster passt nicht. Lesen Sie `lastError` in den Details, beheben Sie, `retry`.

## Bekannte Einschränkungen und Roadmap

- Release-Kandidat (v0.2.2), aus dem Quellcode installiert; e2e benötigt eine lebende dsh-web-Instanz.
- Standard-Stapelmodell ist `deepseek-flash`; nicht-offizielle Modelle haben keine öffentliche Preistabelle — das Hauptbuch markiert sie als „Preis unbekannt", in den Einstellungen auffüllbar.
- Limit pro Aufgabe 240 Minuten; Zeitüberschreitung bricht ab und versucht es einmal erneut.
- Roadmap-Kandidaten: mehrere Fenster und Stapel, Aufgaben-Abhängigkeitsgraphen, automatische Budgetverteilung, Berichts-Push (E-Mail/Webhook), Preisänderungs-Warnungen.

## Repository-Struktur

```
dsh-lowtide/
├── README.md                  English
├── README.zh-CN.md            Version auf vereinfachtem Chinesisch
├── README.zh-HK.md            Version auf traditionellem Chinesisch
├── assets/screenshots/        README-Screenshots
├── docs/                      Mehrsprachige READMEs (ar, de, es, fr, it, ko)
├── LICENSE                    MIT
├── CHANGELOG.md               Versionsverlauf
├── CONTRIBUTING.md            Beitragsleitfaden
├── CODE_OF_CONDUCT.md         Verhaltenskodex
├── SECURITY.md                Sicherheitsrichtlinie
├── .github/                   CI-Workflow + Issue/PR-Vorlagen
├── package.json               pnpm-Workspace-Root
└── packages/
    ├── core/                  Plattformunabhängiger Kern (lowtide-core)
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              Pure-Function-Unit-Tests
    └── dsh-lowtide/           Das Plugin (dsh-lowtide)
        ├── src/               Host-Hälfte: routes / runner / scheduler / intake / store / state-machine
        ├── client/            Browser-Hälfte: components / hooks / i18n / store
        ├── test/              Unit-Tests + e2e (Playwright)
        ├── cordis.patch.yml   Plugin-Zeile + lt-*-Berechtigungsvoreinstellungen
        └── README.md          README auf Paketebene
```

## Ein paar ehrliche Worte

Möge dieses Harness-Plugin vom Volke, durch das Volk und für das Volk sein. Mögen die Weisheit der Open-Source-Gemeinschaft und der Wille zur Zusammenarbeit niemals von der Erde verschwinden.

## Lizenz und Danksagungen

MIT-Lizenz (siehe [LICENSE](../LICENSE)).

- Gebaut auf [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · dem Cordis-Plugin-Ökosystem
- [DeepSeek-Preisanpassungsankündigung (2026-09-10)](https://api-docs.deepseek.com/quick_start/pricing) · [Berichterstattung zum Inkrafttreten (2026-09-10)](https://api-docs.deepseek.com/updates) · [news](https://api-docs.deepseek.com/news)

---

> **Abschließender Hinweis:** Die Oberfläche des lowtide-Plugins unterstützt in dieser Version nur **vereinfachtes Chinesisch** und **Englisch**. Dieses deutsche README ist eine Übersetzung zur Bequemlichkeit; bei Abweichungen hat das englische Original (`README.md`) Vorrang.

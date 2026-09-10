# Stunden

Ein privater Arbeitszeit-Tracker fürs iPhone. Keine App-Store-App, sondern eine
Web-App, die du dir auf den Home-Bildschirm legst. Danach sieht und verhält sie
sich wie eine normale App: eigenes Icon, kein Safari-Rahmen, funktioniert offline.

Alle Daten liegen ausschließlich auf deinem Gerät. Kein Server, kein Konto,
kein Tracking.

## Was sie kann

**Zeit erfassen**
- Start/Stopp-Timer, läuft weiter wenn du die App schließt oder das iPhone sperrst
- Beginn eines laufenden Timers nachträglich korrigieren: auf „Läuft seit …“
  tippen, per Schnellknopf oder Uhrzeit zurückziehen. Uhr, Tagessumme und
  Verdienst rechnen sofort neu
- Nach dem Stopp öffnet sich sofort die Korrektur-Maske
- Warnung, wenn der Timer ungewöhnlich lange läuft, weil du das Stoppen vergessen hast
- Einträge von Hand anlegen, auch Nachtschichten über Mitternacht
- „Wie letztes Mal“ übernimmt die Zeiten des letzten Eintrags

**Melden**
- Fertige WhatsApp-Nachricht auf Knopfdruck
- Vorlage frei bearbeitbar, Standard ist `{datum} | {beginn} - {ende} | {stunden} h`
- Gemeldete Einträge bekommen ein Häkchen
- Knopf „3 offene Meldungen“ filtert die Übersicht auf alles Ungemeldete und
  bietet an, sie als eine Nachricht zu senden oder einzeln durchzugehen

**Auswerten**
- Stunden und Verdienst für Tag, Woche, Monat oder gesamt
- Monatskalender: jeder Tag mit seinen Stunden, grüner Punkt heißt gemeldet,
  oranger heißt offen. Einen Tag antippen zeigt nur dessen Einträge, ein leerer
  Tag legt direkt einen neuen an
- Stundenlohn hinterlegen, dann rechnet die App das Geld gleich mit

**Daten**
- CSV-Import für alte Einträge, mit Vorschau vor dem Übernehmen
- CSV-Export und JSON-Backup

## Auf dem iPhone installieren

Die App muss von einer `https`-Adresse kommen, sonst funktioniert der Offline-Teil
nicht. Am einfachsten über GitHub Pages:

1. Repo auf öffentlich stellen (**Settings → Danger Zone → Change visibility**).
   Bei privaten Repos braucht GitHub Pages einen bezahlten Plan.
2. **Settings → Pages**, bei *Source* **Deploy from a branch**, Branch auswählen,
   Ordner `/ (root)`, **Save**
3. Ein bis zwei Minuten warten, dann steht die Adresse dort, in der Form
   `https://<dein-name>.github.io/Hourapp/`
4. Diese Adresse **in Safari** öffnen, nicht in Chrome
5. Teilen-Symbol unten → **Zum Home-Bildschirm** → **Hinzufügen**

## Rundung

Drei Einstellungen: das Raster, worauf gerundet wird, und in welche Richtung.

**Runden auf: Anfang und Ende** (Standard) zieht beide Zeiten aufs Raster, die
Stunden ergeben sich daraus. Die Nachricht rechnet dadurch immer sauber auf.

**Runden auf: nur die Dauer** lässt die Zeiten stehen und rundet die Stundenzahl.
So machen es viele Zeiterfassungs-Apps. Zeiten und Stundenzahl in der Nachricht
passen dann nicht immer exakt zusammen.

**Modus:**

- **Kaufmännisch**: auf den nächstliegenden Rasterpunkt
- **Aufrunden**: bei Zeiten wandert der Beginn nach unten und das Ende nach oben,
  also zu deinen Gunsten; bei Dauer-Rundung wird die Stundenzahl aufgerundet
- **Abrunden**: jeweils umgekehrt

Beispiel `17:28 – 19:51` bei 15-Minuten-Raster, kaufmännisch:

| Runden auf | Ergebnis |
| --- | --- |
| Anfang und Ende | `17:30 – 19:45`, 2,25 h |
| Nur die Dauer | `17:28 – 19:51`, 2,5 h |

Die Einstellungen zeigen an einem Beispiel, was die gewählte Kombination macht.
Im Eintrag steht unter der Nachricht zusätzlich die tatsächlich erfasste Zeit,
damit du siehst, was die Rundung verändert hat.

## Nachrichten-Vorlage

Verfügbare Platzhalter:

| Platzhalter | Ergebnis |
| --- | --- |
| `{datum}` | `09.09.` |
| `{datum_lang}` | `09.09.2026` |
| `{wochentag}` | `Mi` |
| `{beginn}` | `07:00` |
| `{ende}` | `16:00` |
| `{stunden}` | `8,5` |
| `{stunden_hm}` | `8:30` |
| `{geld}` | `127,50 €` |
| `{notiz}` | Text aus dem Notizfeld |

## WhatsApp

Der Knopf öffnet WhatsApp mit fertig eingetippter Nachricht. Den Chat oder die
Gruppe wählst du einmal selbst aus, dann auf Senden.

Direkt in eine bestimmte Gruppe springen geht nicht. WhatsApp bietet dafür keine
Schnittstelle, `wa.me`-Links können ausschließlich einzelne Telefonnummern
ansteuern. Als Absicherung landet die Nachricht beim Antippen zusätzlich in der
Zwischenablage, falls WhatsApp nicht aufgeht.

## CSV-Import

Unter **Mehr → Alte Einträge aus CSV importieren**. Der Import erkennt selbst:

- Trennzeichen: Semikolon, Tabulator, senkrechter Strich, Komma, sowie eine
  vorangestellte `sep=,`-Zeile, wie Excel sie schreibt
- Kopfzeile oder keine Kopfzeile
- Spaltennamen auf deutsch und englisch: Datum, Von, Bis, Beginn, Ende, Stunden,
  Dauer, Notiz, Clocked In, Clocked Out, Duration, Comment, Job, Hourly Rate
- Datumsformate `09.09.2026`, `9.9.26`, `2026-09-09`, `09.09.`
- Datum und Uhrzeit in derselben Zelle, etwa `07.05.26 16:30` oder `2026-05-07T16:30`
- Zeiten `07:00`, Dauern `8:30`, `8,5`, `8.5 h`
- Anführungszeichen um Felder, die das Trennzeichen enthalten

Enthält die Datei eine Spalte mit dem Stundenlohn und sind alle Zeilen sich
einig, bietet der Import an, ihn zu übernehmen.

Stehen nur Datum und Stundenzahl in der Datei, setzt der Import 08:00 als Beginn.
Vor dem Übernehmen siehst du eine Vorschau und wie viele Zeilen übersprungen
wurden. Beim Hinzufügen werden Einträge übersprungen, deren gerundete Zeiten
schon vorhanden sind, du kannst dieselbe Datei also gefahrlos zweimal einlesen
und auch den eigenen CSV-Export zurückspielen. Importierte Einträge gelten als
bereits gemeldet.

Kommen die Daten aus einer App, die die Dauer rundet, stell unter **Rundung**
das Ziel auf *nur die Dauer*, dann stimmen alte und neue Zahlen überein.

## Kurzbefehle, NFC, Siri

Die App reagiert auf `?a=start`, `?a=stop` und `?a=toggle`. Die passenden
Adressen kannst du dir in den Einstellungen kopieren und in der Kurzbefehle-App
mit *URL öffnen* verwenden, für Siri, einen NFC-Sticker oder eine Automation.

**Wichtige Einschränkung:** iOS öffnet solche Adressen in Safari, und eine
Web-App auf dem Home-Bildschirm hat einen eigenen Speicher, getrennt von Safari.
Ein per Kurzbefehl gestarteter Timer taucht dann unter Umständen nicht in der
installierten App auf, sondern nur in der Safari-Fassung. Probiere es aus, bevor
du dich darauf verlässt. Falls es bei dir so ist, bleibt der Kurzbefehl trotzdem
nützlich, um die App schnell zu öffnen, und du tippst danach auf Start.

## Daten und Backup

Alles liegt im lokalen Speicher der Web-App:

- Niemand außer dir kommt dran
- Löschst du das Icon vom Home-Bildschirm, sind die Daten weg
- Ein neues iPhone übernimmt sie nicht automatisch

Deshalb ab und zu unter **Mehr → Backup sichern** eine JSON-Datei ablegen: auf
**Teilen** tippen, dann **In Dateien sichern** und **iCloud Drive** wählen. Dann
liegt die Datei außerhalb des iPhones und lässt sich über **Backup einspielen**
von dort zurückholen.

Die App merkt sich, wann du zuletzt gesichert hast, und erinnert dich nach einer
einstellbaren Zahl von Tagen. Eine automatische Sicherung nach iCloud gibt es
nicht: an den Speicher einer Web-App kommt weder iCloud Sync noch die
Kurzbefehle-App heran, und ob ein vollständiges Geräte-Backup ihn mitnimmt, ist
nirgends zugesichert.

## Lokal entwickeln

Kein Build-Schritt, kein npm:

```sh
npx http-server . -p 8080
```

| Datei | Zweck |
| --- | --- |
| `index.html` | Aufbau der Oberfläche |
| `app.js` | Timer, Rundung, Nachricht, Auswertung, CSV, Speicher |
| `app.css` | Gestaltung, hell und dunkel |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest` | Name, Icons, Vollbild-Modus |

Nach Änderungen die Konstante `VERSION` in `sw.js` hochzählen, sonst liefert der
Cache auf dem iPhone weiter die alte Fassung aus.

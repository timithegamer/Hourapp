# Stunden

Ein privater Arbeitszeit-Tracker fürs iPhone. Keine App-Store-App, sondern eine
Web-App, die du dir auf den Home-Bildschirm legst. Danach sieht und verhält sie
sich wie eine normale App: eigenes Icon, kein Safari-Rahmen, funktioniert offline.

Alle Daten liegen ausschließlich auf deinem Gerät. Kein Server, kein Konto,
kein Tracking.

## Was sie kann

**Zeit erfassen**
- Start/Stopp-Timer, läuft weiter wenn du die App schließt oder das iPhone sperrst
- Nach dem Stopp öffnet sich sofort die Korrektur-Maske
- Warnung, wenn der Timer ungewöhnlich lange läuft, weil du das Stoppen vergessen hast
- Einträge von Hand anlegen, auch Nachtschichten über Mitternacht
- „Wie letztes Mal“ übernimmt die Zeiten des letzten Eintrags

**Melden**
- Fertige WhatsApp-Nachricht auf Knopfdruck
- Vorlage frei bearbeitbar, Standard ist `{datum} | {beginn} - {ende} | {stunden} h`
- Gemeldete Einträge bekommen ein Häkchen, offene werden gezählt

**Auswerten**
- Stunden und Verdienst für Tag, Woche, Monat oder gesamt
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

Die Rundung zieht Beginn und Ende aufs eingestellte Raster, die Stunden ergeben
sich daraus. So rechnet die Nachricht für den Empfänger sauber auf.

- **Kaufmännisch**: beide Zeiten auf den nächstliegenden Rasterpunkt
- **Aufrunden**: Beginn nach unten, Ende nach oben, also zu deinen Gunsten
- **Abrunden**: Beginn nach oben, Ende nach unten

Die Einstellungen zeigen an einem Beispiel, was der gewählte Modus konkret macht.
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

- Trennzeichen: Semikolon, Tabulator, senkrechter Strich, Komma
- Kopfzeile oder keine Kopfzeile
- Spaltennamen wie Datum, Von, Bis, Beginn, Ende, Stunden, Dauer, Notiz
- Datumsformate `09.09.2026`, `9.9.26`, `2026-09-09`, `09.09.`
- Zeiten `07:00`, Dauern `8:30`, `8,5`, `8.5 h`
- Anführungszeichen um Felder, die das Trennzeichen enthalten

Stehen nur Datum und Stundenzahl in der Datei, setzt der Import 08:00 als Beginn.
Vor dem Übernehmen siehst du eine Vorschau und wie viele Zeilen übersprungen
wurden. Beim Hinzufügen werden Einträge mit identischen Zeiten übersprungen, du
kannst dieselbe Datei also gefahrlos zweimal einlesen. Importierte Einträge
gelten als bereits gemeldet.

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

Deshalb ab und zu unter **Mehr → Backup sichern** eine JSON-Datei ablegen.

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

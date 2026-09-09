# Stunden

Ein privater Arbeitszeit-Tracker fürs iPhone. Keine App-Store-App, sondern eine
Web-App, die du dir auf den Home-Bildschirm legst. Danach sieht und verhält sie
sich wie eine normale App: eigenes Icon, kein Safari-Rahmen, funktioniert offline.

Alle Daten liegen ausschließlich auf deinem Gerät. Es gibt keinen Server, kein
Konto, kein Tracking.

## Was sie kann

- Start/Stopp-Timer, läuft weiter wenn du die App schließt oder das iPhone sperrst
- Nach dem Stopp öffnet sich sofort die Korrektur-Maske für die Zeiten
- Fertige WhatsApp-Nachricht auf Knopfdruck: `09.09. | 07:00 - 16:00 | 8,5 h`
- Rundung einstellbar: Raster (5/10/15/30 Min) und Modus (kaufmännisch, auf, ab)
- Einträge von Hand anlegen und bearbeiten, auch Nachtschichten über Mitternacht
- Tages- und Wochensumme, Saldo gegen die Soll-Stunden
- CSV-Export und JSON-Backup

## Auf dem iPhone installieren

Die App muss von einer `https`-Adresse kommen, sonst funktioniert der Offline-Teil
nicht. Am einfachsten über GitHub Pages:

1. Im Repo auf **Settings → Pages**
2. Bei *Source* **Deploy from a branch** wählen, Branch auf den Branch mit diesem
   Code stellen, Ordner `/ (root)`, dann **Save**
3. Ein bis zwei Minuten warten. GitHub zeigt dir dann die Adresse an, in der Form
   `https://<dein-name>.github.io/Hourapp/`
4. Diese Adresse **in Safari** öffnen (nicht Chrome, das kann auf iOS keine
   Web-Apps installieren)
5. Auf das Teilen-Symbol unten tippen, runterscrollen zu **Zum Home-Bildschirm**,
   dann **Hinzufügen**

Fertig. Ab jetzt startest du sie über das Icon.

## Rundung

Die Rundung zieht Beginn und Ende aufs eingestellte Raster, die Stunden ergeben
sich daraus. So rechnet die Nachricht für den Empfänger sauber auf.

- **Kaufmännisch**: beide Zeiten auf den nächstliegenden Rasterpunkt
- **Aufrunden**: Beginn nach unten, Ende nach oben, also zu deinen Gunsten
- **Abrunden**: Beginn nach oben, Ende nach unten

Die Einstellungen zeigen an einem Beispiel, was der gewählte Modus konkret macht.

## WhatsApp

Der Knopf öffnet WhatsApp mit fertig eingetippter Nachricht. Den Chat oder die
Gruppe wählst du einmal selbst aus, dann auf Senden.

Direkt in eine bestimmte Gruppe springen geht nicht. WhatsApp bietet dafür keine
Schnittstelle, die `wa.me`-Links können ausschließlich einzelne Telefonnummern
ansteuern. Als Absicherung landet die Nachricht beim Antippen zusätzlich in der
Zwischenablage, falls WhatsApp mal nicht aufgeht.

## Daten und Backup

Alles liegt im lokalen Speicher der Web-App. Das heißt:

- Niemand außer dir kommt dran
- Löschst du das Icon vom Home-Bildschirm, sind die Daten weg
- Ein neues iPhone übernimmt sie nicht automatisch

Deshalb ab und zu unter **Mehr → Backup sichern** eine JSON-Datei ablegen. Die
lässt sich über **Backup einspielen** wieder laden.

## Lokal entwickeln

Kein Build-Schritt, kein npm. Einfach ausliefern:

```sh
npx http-server . -p 8080
```

Dann `http://localhost:8080` aufrufen.

Dateien:

| Datei | Zweck |
| --- | --- |
| `index.html` | Aufbau der Oberfläche |
| `app.js` | Logik: Timer, Rundung, Nachricht, Speicher |
| `app.css` | Gestaltung, hell und dunkel |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest` | Name, Icons, Vollbild-Modus |

Nach Änderungen an den Dateien die Konstante `VERSION` in `sw.js` hochzählen,
sonst liefert der Cache auf dem iPhone weiter die alte Fassung aus.

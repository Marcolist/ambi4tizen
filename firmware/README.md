# ESP-WROOM-32-Prototyp

Die Firmware ist für den klassischen ESP32 mit ESP-IDF **5.5.6** gebaut.
`espressif/led_strip` ist auf **3.1.1** festgelegt; `dependencies.lock` hält den
aufgelösten Komponentenstand fest. Der lokale Build ist erfolgreich. Noch kein
Flash und kein Nachweis am LED-Strip.

## Aufbau

| Modul | Aufgabe |
| --- | --- |
| `ambilight_receiver` | WLAN, Reconnect, UDP, HMAC, Reihenfolge/Datenalter, Queue mit einem Frame |
| `color_engine` | U-Mapping, Interpolation über Ecken, zeitbasierte Glättung, Gamma, Helligkeit und geschätzte Strombegrenzung |
| `mode_manager` | OFF, AMBILIGHT, AMBIENT, AUTO und manuelle Priorität |
| `configuration` | Validierte Konfiguration, versionierter CRC-Blob, eigener NVS-Namensraum |
| `led_driver` | WS2812/GRB über Espressifs SPI-Treiber mit DMA |
| `diagnostics` | Autorisierte Statusabfrage und manuelle Betriebsbefehle |
| `main` | Ein Eigentümer für Modi/Konfiguration, 20-ms-Ausgabeschleife |

SPI2 ist vollständig für den LED-Strip reserviert. Der Treiber benötigt nur
die LED-Datenleitung; keine separate Taktleitung am Strip. DMA vermeidet die
für klassischen ESP32 beschriebene RMT-Interruptlast bei gleichzeitigem WLAN.
GPIO wird erst nach erfolgreicher Konfigurationsprüfung und explizitem
`output_enabled` initialisiert. Vorgabe: gesperrt, GPIO −1, null LEDs.

Treiberinitialisierung/erste Schwarz-Ausgabe müssen funktionieren, sonst wird
der Treiber freigegeben. Bei späterem Ausgabefehler wird Schwarz versucht und
der Treiber gestoppt; Netzwerk/Diagnose bleiben aktiv. Ein unterbrochenes
Datensignal kann bereits gespeicherte LED-Farben allerdings nicht zuverlässig
löschen. Der Software-AUS-Zustand ist keine elektrische Trennung.

## Lokal bauen

Voraussetzung: offizielles ESP-IDF 5.5.6 inklusive ESP32-Werkzeugen. Bei einer
Installation unter dem ignorierten `.local/` lautet der Build-Aufruf:

```sh
export IDF_TOOLS_PATH="$PWD/.local/espressif"
. .local/esp-idf-v5.5.6/export.sh
idf.py -C firmware build
```

Ein frischer Checkout verwendet eine normale Installation dieser SDK-Version.
`sdkconfig.defaults` wählt ESP32/4-MB-Flash. Tatsächliche Modulvariante,
Flashgröße und Platinenbelegung sind **vor einem späteren Flash** zu bestätigen.
Die generierten `sdkconfig`, Builddateien, SDKs und Binärdateien sind ignoriert.
Keine Flash- oder Serial-Monitor-Kommandos gehören zur automatisierten Prüfung.

## Private Konfiguration

```sh
python3 tools/configure.py --init
# .local/ambilight-config.json lokal bearbeiten
python3 tools/configure.py
# Danach erneut bauen; weiterhin nicht flashen.
```

`--init` erzeugt einen zufälligen UDP-Schlüssel, API-Token und eine Profil-ID,
überschreibt keine vorhandenen Zugangsdaten und lässt Sender/LEDs ausgeschaltet.
WLAN-Zugangsdaten gehören ausschließlich in diese lokale Datei, nicht in Git
oder den Chat. `configure.py` erzeugt `main/private_config.h` (ebenfalls ignoriert).
Ein CMake-Reconfigure ist nötig, wenn der Header nach dem ersten Build neu
hinzukommt: `idf.py -C firmware reconfigure build`.

Einzutragen sind WLAN-SSID/Passwort, IPv4 des TV, später IPv4 des ESP, tatsächliche
LED-Zahlen links/oben/rechts, geprüfter Daten-GPIO, Strombudget und Helligkeitscap.
Alle drei Seiten müssen bei einer nichtleeren Belegung vorhanden sein. Gesamtzahl
3–600; die Grenze ist eine Softwaregrenze, keine Freigabe für die Stromversorgung.
Es gibt keine fest eingebaute Gesamtzahl für den geplanten Rahmen.

Das Mapping zählt vom unteren linken Bildrand aufwärts, dann oben und rechts
hinunter. `start_offset` bezeichnet den physischen LED-Index dieses Anfangs.
`reverse` kehrt die physische Laufrichtung um. Farben werden in den jeweiligen
Seitenlängen interpoliert, Ecken überblendet, unten nicht verbunden. Bestimmung
beim ersten freigegebenen Test mit wenigen, schwach leuchtenden Farbpunkten.

`gamma_milli=2200` bedeutet `pow(channel/255, 2.2)`. Glättung ist eine zeitbasierte
Exponentialfunktion mit `smoothing_ms=150`. Nach OFF wird sie zurückgesetzt.
Helligkeit ist das Minimum aus manueller Helligkeit, lokalem Cap und optionalem
TV-Paketwert. Der TV kann den lokalen Cap nicht erhöhen.

`current_limit_ma` schätzt Last aus RGB-Ausgabe, konfigurierbaren 60 mA pro
weißer LED und 1 mA Ruhebedarf je LED, auch bei OFF. Reale Varianten können abweichen.
Bei zu kleinem Budget bleibt der Ruhebedarf physikalisch bestehen. Diese
Schätzung ersetzt weder geeignetes Netzteil noch Sicherung/Leitungsprüfung.
Die Vorgabe 500 mA ist kein zugesichertes Netzteil- oder Verdrahtungsrating.

## Betriebsarten und Speicherung

| Gewählt | Verhalten |
| --- | --- |
| OFF | Sofort Schwarz; WLAN/HTTP bleiben erreichbar, UDP kann OFF nicht aufheben |
| AMBILIGHT | Aktueller TV-Frame; nach `timeout_ms` Schwarz |
| AMBIENT | Gespeicherte statische RGB-Farbe, unabhängig vom TV |
| AUTO | Gültiger Stream → Ambilight; Timeout → gespeichertes Ambient oder OFF |

Manuelle Modi OFF und AMBIENT haben Vorrang vor dem Stream. Für erneutes
automatisches Umschalten wird AUTO ausdrücklich gesetzt. AMBIENT speichert
den eingeschalteten Ambient-Zustand, OFF speichert ihn als aus. Ein RGB-Befehl
ändert die gespeicherte Ambient-Farbe; ohne Moduswechsel bleibt OFF vorrangig.

Manuelle Änderungen werden vor ihrer Anwendung in NVS gespeichert. Frames
werden nicht gespeichert, um Flash-Schreiblast zu vermeiden. Bei NVS-Fehler
bleibt die bisherige Einstellung aktiv; `/status.last_error` meldet den Fehler.
Ein Start mit ungültigem NVS-Inhalt sperrt die LED-Ausgabe. Kein automatisches
Löschen von NVS oder fremden Namensräumen. Eine geänderte private `profile_id`
ersetzt beim nächsten Start die bisherigen Einstellungen durch die neuen
Compile-Vorgaben. Bei Netzwerk-/Pin-/Layoutänderungen diese ID neu wählen.
Zugangsdaten sind im Prototyp unverschlüsselt in privatem Image/NVS enthalten;
Images und private Header dürfen nicht veröffentlicht werden.

## Diagnose und Bedienung

ESP-HTTP-Port 8080: `GET /status`, `POST /command`. Beide brauchen
`Authorization: Bearer <privates Token>`; keine Passwörter/Schlüssel im Status.
Nur in einem vertrauenswürdigen lokalen WLAN verwenden: HTTP ist unverschlüsselt.
Kein Portforwarding. WLAN-Station erwartet mindestens WPA2, kein offenes WLAN.

Beispiele nach Freigabe und Inbetriebnahme:

```sh
python3 tools/controller.py status
python3 tools/controller.py AMBIENT --rgb 255 120 30 --brightness 24
python3 tools/controller.py AUTO
python3 tools/controller.py OFF
```

`/command` akzeptiert ausschließlich `mode`, `brightness` und/oder `ambient`.
202 bestätigt die Aufnahme in die begrenzte Befehlsqueue. Status danach prüfen;
keine hochfrequenten Schreibbefehle senden. Netzwerk, GPIO und Freigabe der
LED-Ausgabe lassen sich darüber nicht ändern. Dieselbe Befehlsstruktur ist der
vorgesehene Einstieg für den späteren Zigbee-Adapter.

Status enthält Empfangszähler, ungültige/alte Pakete, WLAN-Zustand, freie/minimale
Heapgröße, Modus, LED-Treiberzustand und geschätzte Last. LED-Treiberzustand
bestätigt keinen tatsächlich angeschlossenen oder sichtbaren Strip.

## Nachweise und noch offene Tests

`bash test/run_all.sh` prüft portable Produktionsmodule unter ASan/UBSan,
die NVS-Anbindung gegen einen Fehler injizierenden Speicherstub und die
TV-Senderkette über echtes UDP-Loopback. Details: [Testanleitung](../test/README.md).
WLAN-Funk, echtes NVS über Neustart, GPIO-Timing und LEDs sind noch ungeprüft.
Hardware- und TV-Freigaben: [Testplan](../docs/esp32-hardware-test.txt).

Für ESP32-C6 sind die portablen Teile wiederverwendbar. Pins, SPI-Treiber,
SDK-Version und Funkkoexistenz müssen separat geprüft werden. Es gibt noch
keinen C6-Build und keine implementierte Zigbee-/Hue-Anbindung.

Quellen für die Treiber-/SDK-Wahl:
[ESP-IDF 5.5.6](https://github.com/espressif/esp-idf/releases/tag/v5.5.6),
[Espressif LED Strip 3.1.1](https://components.espressif.com/components/espressif/led_strip/versions/3.1.1/readme).

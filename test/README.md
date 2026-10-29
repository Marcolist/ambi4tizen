# Lokale Tests ohne TV und GPIO

```sh
bash test/run_all.sh
```

Voraussetzungen: GCC mit ASan/UBSan, OpenSSL-Entwicklungsbibliothek, Python 3,
Pillow und Node. Falls `.local/node-v4.4.3-linux-x64/bin/node` vorhanden ist,
läuft derselbe TV-Test zusätzlich unter Node 4.4.3. Dieser Host-Runtime wurde
beim lokalen Test von nodejs.org bezogen und gegen dessen SHA256-Liste geprüft.
Er bildet die Node-API-Version des TV nach, nicht dessen ARM-CPU, Sandbox oder
Prozesslebenszyklus. Ohne diesen Runtime meldet die Testsuite den ausgelassenen
Kompatibilitätstest ausdrücklich.

## Prüfungen

* Produktions-C-Parser: HMAC, jede Byteposition verändert, abgeschnittene Pakete,
  Layoutfehler, 20.000 deterministisch erzeugte ungültige Pakete.
* Stream-Zustand: Sequenz- und Zeitstempelüberlauf, Duplikate, altes Capture,
  zusätzliche Empfangsverzögerung, Session-Wechsel und Wiederholung.
* Produktions-Farbverarbeitung: U-Reihenfolge, Start/Richtung als bijektive
  Zuordnung für 3, 17, 81, 87, 123, 599 und 600 LEDs, Eckeninterpolation,
  Gamma-Endpunkte/Monotonie, zeitabhängige Glättung, sofortiges OFF, Limits.
* Modusmanager: manuelle Priorität und beide AUTO-Rückfallzustände, Timeout.
* Reconnect-Zustandsautomat: Backoff, Höchstintervall, Erfolg und erneuter Abbruch.
* Persistenz: Konfigurations-Codec/CRC sowie tatsächliche NVS-Adapterfunktionen
  mit Speicherstub, Fehlern bei Initialisierung/Schreiben/Commit und Profilwechsel.
* Konfigurationstool: ungültige Werte, gesperrte Vorgaben, keine Überschreibung
  bestehender privater Zugangsdaten und sichere C-String-Kodierung.
* Deployment-Wrapper mit vollständig gemocktem I/O: deaktivierter Sender,
  falsche Quell-IP und abweichende TV-Identität verhindern Start/Installation.
* TV: echter JPEG-Decoder auf einem generierten Testbild; 6/12/18/24 Zonen,
  200 Capture-Auswertungen je Runtime, kein paralleler Capture, Aufräumen nach
  Broker-/Decoder-/Dimensions-/Pfadfehler, Senderstop nach drei alten Frames.
* Integration: tatsächlicher Node-Sender mit Decoder → echtes UDP auf Loopback →
  tatsächlicher C-Parser/Modusmanager/Farbverarbeitung. Ein unabhängiger
  Python-Encoder prüft die Sprachgrenze. Prüft außerdem falsche Signatur,
  Überlänge, altes Capture, Session-Sperre, Duplikat und Timeout nach OFF.

Der TV-Broker und seine Dateierzeugung werden im Test injiziert; es wird kein
TV kontaktiert. Temporäre Testbilder und Schlüssel liegen nur in `test/output/`.
Der Simulator bindet ausschließlich `127.0.0.1`. Keine seriellen Ports,
keine GPIOs und keine Router-/Hue-Änderungen. Aktuelles Node meldet wegen der
für Node 4 notwendigen alten Buffer-Konstruktoren eine Deprecation-Meldung.

Diese Nachweise ersetzen keine Tests von Funk-Reconnect am ESP, NVS nach
physischem Neustart, LED-Timing unter WLAN-Last oder Capture-Lebensdauer am TV.
200 Fixture-Aufrufe beweisen auch keine generelle Speicherleckfreiheit auf Tizen.

## Simulator manuell verwenden

```sh
bash test/build_host.sh
mkdir -p test/output
python3 -c "from pathlib import Path; Path('test/output/test-psk.hex').write_text(bytes(range(32)).hex())"
test/build/receiver_sim test/output/test-psk.hex 19446 15 5 10 5
```

In einem zweiten Terminal:

```sh
python3 tools/pattern_sender.py --key-file test/output/test-psk.hex --seconds 5
```

Der Simulator gibt vollständige LED-RGB-Listen als JSON aus. Port, Laufzeit und
drei LED-Seitenlängen sind Argumente. Nach Ende des Musters folgt innerhalb von
drei Sekunden OFF. Testschlüssel nie für ein echtes Gerät übernehmen.
Für LAN-Übertragung verlangt der Mustersender ausdrücklich `--allow-lan`;
diese Option ersetzt nicht die vereinbarte Hardwareprüfung/Freigabe.

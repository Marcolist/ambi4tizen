# Ambi4Tizen

**Native TV colors. Local light.**

Experimenteller Ambilight-Prototyp für Samsung-TVs mit **Tizen 4.0** und einen
**ESP-WROOM-32** mit WS2812B-LEDs. Die „4“ steht für „for“ und Tizen 4.

```text
Interne TV-App → Capture auf dem TV → RGB-Randzonen → WLAN/UDP → ESP32 → LEDs
```

Die Bildauswertung läuft auf dem Fernseher. Übertragen werden ausschließlich
gemittelte Farben, keine Videoframes oder JPEGs. Im Betrieb ist kein dauerhafter
PC-Dienst vorgesehen. Kein HDMI-Grabber, externer Streaming-Client oder Cloud-Dienst.

## Projektstand

| Teil | Stand |
| --- | --- |
| Bestehender Capture-Prototyp | Begrenzte Einzeltests auf UE65NU7179, Tizen 4.0 / ARMv7, Firmware 1360 erfolgreich |
| Interne Apps | Wechselnde Farben bei begrenzten Netflix-/Prime-Video-/Disney+-Tests; keine allgemeine Codec-/HDR-Garantie |
| Neuer TV-Sender | Implementiert, lokal unter Node 4.4.3 und über UDP-Loopback geprüft; Live-Dauerbetrieb offen |
| ESP32-Firmware | ESP-IDF 5.5.6 / led_strip 3.1.1, für klassischen ESP32 gebaut |
| Sichtbarer Ende-zu-Ende-Test | Noch offen; kein Nachweis einer fertigen TV-zu-LED-Lösung |
| Autostart / ESP32-C6 / Zigbee / Hue | Spätere Schritte, nicht implementiert oder bestätigt |

Standardmäßig bleiben TV-Sender und LED-Ausgabe deaktiviert. Diese Software
verwendet einen vorhandenen, nicht öffentlich dokumentierten Samsung-Capture-
Dienst; Verhalten auf anderen Modellen/Firmwareständen ist ungeprüft. Keine
Root-Rechte, Firmwareänderungen, Systemdateiänderungen oder DRM-Umgehung.

## Lokal testen – ohne TV oder LEDs

Voraussetzungen: GCC, OpenSSL-Entwicklungsbibliothek, Python 3, Pillow und Node.
Die Tests verwenden Loopback, synthetische Bilder und Speicherstubs.

```bash
git clone https://github.com/Marcolist/ambi4tizen.git
cd ambi4tizen
python3 -m venv .local/test-venv
.local/test-venv/bin/pip install -r test/requirements.txt
PATH="$PWD/.local/test-venv/bin:$PATH" bash test/run_all.sh
```

Die Tests decken Protokoll/HMAC, fehlerhafte und alte Pakete, LED-Zuordnung,
Eckeninterpolation, Gamma, Glättung, Modi, Timeout, Reconnect-Logik, Persistenz
und die tatsächliche Node→UDP→C-Empfänger-Kette ab. Ein zusätzlicher Node-4.4.3-
Lauf erfolgt, wenn dieser Runtime wie in [test/README.md](test/README.md) vorhanden
ist. Ein übersprungener Kompatibilitätslauf wird ausdrücklich gemeldet.

## 1. Werkzeuge für den TV vorbereiten

Die vorhandenen Buildskripte erwarten diese lokalen Werkzeuge:

| Werkzeug | Geprüfter Stand / Pfad |
| --- | --- |
| Samsung SDB | 4.2.36, `discovery/tools/sdb-sdk/tools/sdb` |
| .NET SDK zum Signieren | 6.0.428, `.local/dotnet/dotnet` |
| SDK-Signiertask | `Tizen.NET.Sdk` 1.1.9, `tools/WidgetSigner.proj` |

SDKs und Zertifikate sind nicht Teil des Repositorys; die Skripte installieren
sie nicht automatisch. Tizen-Signierwerkzeuge und zulässige Zertifikate müssen
lokal eingerichtet sein. Der Signiertask kompiliert keine .NET-App für den TV.
Ein akzeptiertes Entwicklungspaket auf einem Gerät ist keine Garantie für andere
Geräte oder eine App-Store-Zulassung.

TV und Rechner müssen im selben erreichbaren LAN sein. Entwicklermodus und
Rechner-IP müssen am TV konfiguriert sein. Bei einer erstmaligen Einrichtung:
Apps/App-Einstellungen öffnen, `12345` eingeben, Entwicklermodus aktivieren,
Rechner-IP eintragen und den vorgesehenen Neustart ausführen. Menüpositionen
können abweichen. Siehe
[Samsung – TV Device](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
Diese Anleitung verlangt kein Firmwareupdate.

## 2. Ziel-TV festlegen

Nur für ein Gerät ausführen, das du kontrollierst. Befehle gelten ab hier im
Repository-Stamm. Bei bestehender Konfiguration keine Dateien löschen oder
Zugangsdaten neu erzeugen.

```bash
read -r -p "IPv4-Adresse des vorgesehenen TV: " TV_IP
read -r -p "IPv4-Adresse dieses Rechners im LAN: " DEVELOPER_IP
python3 poc/configure_probe.py --tv "$TV_IP" --host "$DEVELOPER_IP"
```

Das Werkzeug liest die TV-Identität und speichert sie in `.local/target.json`.
Es überschreibt keine Konfiguration und ändert keine TV-Einstellung. Namen,
Modell und MAC lokal prüfen, bevor eine App installiert wird. Sie bleiben privat.

```bash
TV_IP="$(python3 -c 'import json; print(json.load(open(".local/target.json"))["host"])')"
SDB_BIN="discovery/tools/sdb-sdk/tools/sdb"
"$SDB_BIN" connect "${TV_IP}:26101"
"$SDB_BIN" -s "${TV_IP}:26101" get-state
```

Erwartet wird `device`. Bei falscher Identität oder Verbindungsfehler anhalten;
keine fremden Geräte ausprobieren und keine Schutzprüfung entfernen.

## 3. Privaten Sender konfigurieren

Nur beim ersten Einrichten:

```bash
python3 tools/configure.py --init
```

Die erzeugte `.local/ambilight-config.json` enthält zufälligen UDP-Schlüssel,
API-Token und Profil-ID. Sie bleibt außerhalb von Git. **Keine echten Adressen,
MACs, WLAN-Zugangsdaten, Schlüssel oder generierten Pakete veröffentlichen.**

Für eine reine Installation ohne Capture zunächst `firmware.source_ip` auf
die TV-Adresse aus `.local/target.json` setzen. `sender.enabled=false` und
`firmware.output_enabled=false` beibehalten. So ist das Paket installierbar,
führt aber keinen Capture aus und öffnet keinen Sender-Diagnoseport.

Vor einem aktiven Test zusätzlich lokal eintragen:

| Wert | Bedeutung |
| --- | --- |
| `firmware.ssid`, `firmware.password` | WLAN für den ESP |
| `sender.esp_ip` | Tatsächliche ESP-IPv4, kein Platzhalter/Broadcast |
| `sender.developer_ip` | Rechner-IP für Status/Stop |
| `firmware.udp_port`, `sender.port` | Gleicher Port, Vorgabe 19446 |
| `sender.zones` | 6, 12, 18 oder 24; Vorgabe 12 |
| `sender.resolution` | Zunächst `480x270` |
| `sender.interval_ms` | Zunächst `1000` |
| `sender.duration_ms` | Zunächst `30000` |

`sender.enabled=true` erst vor einem bewusst gestarteten Test setzen.
**TV-Konfigurationsänderungen benötigen immer einen neuen Build und eine erneute
Installation.** Der TV liest die JSON-Datei auf dem Rechner nicht laufend.
ESP-Konfiguration und sichere Verdrahtung sind separate Schritte:
[Firmware-Anleitung](firmware/README.md), [Hardware-Prüfliste](docs/esp32-hardware-test.txt).

## 4. TV-App bauen und installieren

```bash
python3 tools/build_sender.py
python3 poc/deploy_web_probe.py install --sender --context "Installation ohne Capture-Start"
```

Der Builder signiert `poc/build/ambilight-sender.wgt`. Der Installer prüft
Geräteidentität und Entwicklermodus und installiert das eigene Senderpaket.
`install` startet keinen Capture-Lauf. Die optionale Diagnose-App ist separat.

Kennungen und Kontrolle:

| Kennung | Aufgabe |
| --- | --- |
| `ambiSend40` | Paket |
| `ambiSend40.Start` | Start-App „Ambilight Sender“ |
| `ambiSend40.Service` | Hintergrunddienst |

```bash
"$SDB_BIN" -s "${TV_IP}:26101" shell 0 applist
```

`install completed` im Protokoll und beide Anwendungskennungen im Inventar
prüfen. Private Installationsprotokolle liegen unter `poc/runtime/`.
Die internen Paketkennungen bleiben für Update-Kompatibilität unverändert.

## 5. Kurzer Test: Start, Status und Stopp

Erst mit vorbereitetem Empfänger und geprüftem Aufbau. Klein beginnen:
30 Sekunden, 12 Zonen, 480×270 und Zielintervall 1 Sekunde.

```bash
python3 poc/deploy_web_probe.py launch --sender --context "Kurzer 30-Sekunden-Test"
python3 poc/deploy_web_probe.py status --sender
python3 poc/deploy_web_probe.py stop --sender
```

`launch` startet den Hintergrunddienst, `status` liest dessen Diagnose und
`stop` wartet auf Abschluss/Aufräumen eines laufenden Captures. Eine lokal
deaktivierte Konfiguration wird vom Startwerkzeug abgewiesen.

Alternativ „Ambilight Sender“ im Apps-Menü öffnen. Die UI startet den Dienst
und blendet sich aus. Ein UI-Start beweist noch keine Bildaufnahme oder LED-Reaktion.

Nach dem Testfenster bleiben fünf Sekunden zum Statuslesen, danach endet der
Dienst. `Connection refused` ist bei beendetem oder deaktiviertem Dienst normal;
Installationskontrolle erfolgt per `applist`. Kein Boot-Autostart ist eingerichtet.
Bei Rucklern oder Hängern sofort stoppen; Tests erst nach Auswertung verlängern.

## 6. Rückbau

```bash
python3 poc/deploy_web_probe.py stop --sender
"$SDB_BIN" -s "${TV_IP}:26101" uninstall ambiSend40
"$SDB_BIN" -s "${TV_IP}:26101" shell 0 applist
```

Danach dürfen beide Sender-Kennungen nicht mehr im Inventar stehen. Dieser
Rückbau ist noch nicht praktisch verifiziert. Falls der normale Uninstaller
ablehnt, über die TV-App-Verwaltung löschen; keine Force-/Root-Methode verwenden.
Siehe [Samsungs Fehlerhilfe](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [TV-Sender](tv/README.md) | Capture, Profilierung und Grenzen |
| [ESP32-Firmware](firmware/README.md) | Module, Mapping, Modi und Build |
| [Tests und Simulator](test/README.md) | Reproduzierbare Tests ohne TV |
| [Protokoll](protocol/README.md) | UDP-Format, Authentifizierung, Datenalter |
| [Projektstand](docs/esp32-prototype-status.txt) | Technische Nachweise und offene Punkte |
| [Hardwaretest](docs/esp32-hardware-test.txt) | Versorgung und Verdrahtungsprüfung |
| [C6/Zigbee später](docs/esp32-c6-phase2.txt) | Vorbereitete Architektur und SDK-Abgleich |
| [Capture-Diagnose](poc/README.md) | Begrenzter Basistest |

## Datenschutz und Lizenz

Dieses Repository enthält Quellcode, allgemeine Dokumentation und synthetische
Tests. Geräteidentitäten, Adressen, Zugänge, Zertifikate, SDKs, Buildprodukte,
private Untersuchungen und Wiedergabeprotokolle sind ausgeschlossen. Beispiele
verwenden Loopback oder reservierte Dokumentationsadressen. HMAC authentifiziert
UDP-Farbdaten, verschlüsselt sie aber nicht; Diagnose-HTTP ist unverschlüsselt.

Eigener Code: [MIT](LICENSE). Fremdcode behält seine eigenen Lizenzen und
Attributionen: [Third-party notices](THIRD_PARTY_NOTICES.md).
Ambi4Tizen ist unabhängig von Samsung und Signify/Philips Hue.

# Samsung-Sender für Tizen 4 / Node.js 4.4.3

Grundlage bleibt der nachgewiesene Capture-Aufruf im vorhandenen Web-Service.
Die neue App `ambiSend40` ist ein separat gebauter, begrenzter UDP-Sender.
Das Paket ist standardmäßig deaktiviert. Ein begrenzter Live-Test des neuen
Senders einschließlich LED-Ausgabe steht noch aus. Die schrittweise Einrichtung
steht in der [Haupt-README](../README.md). Das Diagnosepaket bleibt separat.
Der gemeinsame Capture-Kern liegt
in `poc/web-probe/capture-core.js`; der lokale Import in `tv/` wird beim
Paketbau durch dessen tatsächliche Datei ersetzt. Der alte Diagnoseweg behält
seine 6 Vollbildraster-Zonen und maximal 12 Abrufe pro Start.

Der Capture-Aufruf bleibt normaler Modus 0 / Anwendungstyp 0 / Komposition 1
mit Qualität 55. Kein Modusprobieren, Root, Systemdateiänderung oder Bildexport.
Ein RAM-JPEG wird innerhalb desselben Abrufs gelesen, dekodiert, ausgewertet
und unter dem eigenen begrenzten Dateinamen gelöscht. Fremde Rückgabepfade
werden weder geöffnet noch gelöscht. Fehler beim Löschen stoppen den Sender.
Ein unerwarteter Prozessabbruch oder ein nach Timeout verspätet schreibender
Broker kann RAM-Reste hinterlassen; ein störungsfreier Aufräumablauf unter
allen TV-Lebenszyklusereignissen ist noch nicht bewiesen.

## Konfiguration und lokaler Build

Private Datei/Header wie in [Firmware-Anleitung](../firmware/README.md) anlegen.
`sender.enabled` bleibt zunächst false. Weitere Felder:

| Feld | Vorgabe / Bedeutung |
| --- | --- |
| esp_ip | Explizite Unicast-IPv4 des späteren ESP, kein Discovery/Broadcast |
| developer_ip | Nur diese IPv4 darf die begrenzte TV-Diagnose abfragen |
| port | 19446; muss zum ESP passen |
| zones | 6, 12, 18 oder 24; Vorgabe 12 |
| edge_depth | 0.02–0.25, Vorgabe 0.1 |
| resolution | 480x270, alternativ 320x180 oder 160x90 |
| interval_ms | 1000, untere Softwaregrenze 500 |
| duration_ms | 30000; längere Live-Läufe nur mit gesonderter Freigabe |

```sh
python3 tools/build_sender.py
```

Verwendet den lokal einzurichtenden Samsung/Tizen-SDK-Signiertask und
eine lokale .NET-SDK-Installation nur **auf dem Entwicklungsrechner**.
Das TV-Paket selbst enthält ausschließlich HTML/ES5/Node-Code und den bereits
vorhandenen lizenzierten JPEG-Decoder. Ergebnis:
`poc/build/ambilight-sender.wgt`. Ohne private Konfiguration ist das Paket
signiert, aber sein Dienst führt beim Start nichts aus. Private Schlüssel
werden nur in das ignorierte lokale Buildpaket geschrieben. Keine Installation
und kein LAN-Zugriff durch den Builder.

Ein späterer Start der UI-App startet den Dienst und blendet die UI aus.
Das ist kein Autostartnachweis. Der tatsächliche Weiterlauf neben Netflix,
Prime und Disney+ muss nach Installation erneut praktisch geprüft werden.

Für den späteren ausdrücklich freigegebenen Test kann das vorhandene, auf die
Geräteidentität begrenzte SDB-Werkzeug den neuen Sender getrennt bedienen:

```sh
python3 poc/deploy_web_probe.py install --sender
python3 poc/deploy_web_probe.py launch --sender --context "freigegebener 30-Sekunden-Test"
python3 poc/deploy_web_probe.py status --sender
python3 poc/deploy_web_probe.py stop --sender
```

Der Wrapper prüft den zuvor gespeicherten Gerätenamen,
Modellnamen und die MAC sowie die übereinstimmende TV-Quell-IP. Deaktivierte
Senderkonfigurationen werden nicht gestartet. Ohne `--sender` bleibt das
Verhalten des bisherigen Diagnosepakets erhalten.

## Last und Profilierung

Nur ein Capture gleichzeitig. Der nächste Start erfolgt frühestens nach dem
Intervall bzw. nach Ende der vorherigen Verarbeitung. Keine Warteschlange von
Bildaufnahmen und keine zusätzlichen Captures für zusätzliche Farbzonen.
Die UDP-Ausgabe erfolgt nach erfolgreichem Löschen und enthält höchstens
120 Byte. Ein Capture über 1500 ms wird nicht gesendet. Drei aufeinanderfolgende
Verarbeitungs-/Sendefehler stoppen den Lauf. Standard: etwa ein Abruf pro
Sekunde für 30 Sekunden. Das ist eine Vorgabe, keine gemessene TV-Bildrate.

HTTP 18793, nur private Entwickler-IP und Bearer-Token:
`GET /status` liefert aggregierte Zeiten für Broker, Dateilesen, JPEG-Decodierung,
Zonenberechnung, optionales Hashen und Aufräumen; außerdem RSS/Heap Anfang,
Maximum und letzter Wert. `POST /stop` beendet nach Abschluss/Aufräumen eines
laufenden Abrufs. Nach dem Testfenster bleiben fünf Sekunden zum Statuslesen,
dann endet der Prozess. Keine Fernbefehle für beliebige Dateien oder Programme.
Der Normalbetrieb der Sender-/ESP-Kette benötigt keinen PC-Dienst.

Nach Freigabe zuerst 480x270 / 12 Zonen / 1 Hz / 30 Sekunden prüfen. Erst
danach kleinere Auflösungen und andere Zonenzahlen jeweils einzeln vergleichen.
Ziel: Broker-/Decode-Anteil, maximale Framealter, TV-Wiedergabe, Empfangsverluste,
RSS/Heap und Temperatur/Last ohne Störungen. Speicherlecks und App-Wechsel
lassen sich durch die lokalen Fixture-Tests nicht auf dem echten TV ausschließen.
Längere Läufe und höhere Frequenz sind weitere Freigabeschritte.

Autostart wird wie beauftragt erst nach einem sichtbaren Ende-zu-Ende-Erfolg
untersucht. Derzeit muss die App bewusst gestartet werden; ein zuverlässiger
Hintergrundstart beim Einschalten ist noch offen. Keine Vermutung über
Service-Manifestoptionen ersetzt diesen Nachweis.

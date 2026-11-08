#!/usr/bin/env python3
"""Stage the classic ESP32 NeoPixel receiver privately. Never flashes hardware."""
import argparse
from pathlib import Path
import shutil

from configure import PRIVATE, ROOT, load_config, render_header


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=PRIVATE)
    args = parser.parse_args()
    config = load_config(args.config)
    if config.get('target', 'esp32') != 'esp32':
        raise SystemExit('This tested Arduino build supports classic ESP32 only, not ESP32-S3.')
    destination = ROOT / '.local/arduino-receiver'
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.chmod(0o700)
    source = destination / 'src'
    if source.exists():
        shutil.rmtree(source)
    source.mkdir(mode=0o700)
    for component in sorted((ROOT / 'firmware/components').iterdir()):
        if not component.is_dir():
            continue
        out = source / component.name
        out.mkdir()
        for file in sorted(component.iterdir()):
            if file.suffix not in ('.c', '.h') or file.name == 'led_driver.c':
                continue
            shutil.copy2(file, out / file.name)
    template = ROOT / 'firmware/arduino'
    shutil.copy2(template / 'platformio.ini', destination / 'platformio.ini')
    shutil.copy2(template / 'entry.cpp', source / 'entry.cpp')
    shutil.copy2(template / 'led_driver.cpp', source / 'led_driver/led_driver.cpp')
    main_source = (ROOT / 'firmware/main/main.c').read_text()
    signature = 'void app_main(void)'
    if main_source.count(signature) != 1:
        raise SystemExit('Unexpected receiver entry point; staging stopped.')
    (source / 'main_ambi.c').write_text(main_source.replace(signature, 'void ambilight_main(void)', 1))
    header = source / 'private_config.h'
    header.write_text(render_header(config, startup_off=True))
    header.chmod(0o600)
    print('Private classic ESP32 project prepared at .local/arduino-receiver.')
    print('Build with: pio run -d .local/arduino-receiver')
    print('No hardware accessed. Existing valid NVS settings retain priority over startup OFF.')


if __name__ == '__main__':
    main()

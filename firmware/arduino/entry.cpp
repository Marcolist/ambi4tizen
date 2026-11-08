#include <Arduino.h>

extern "C" void ambilight_main(void);

void setup() { ambilight_main(); }
void loop() { delay(20); }

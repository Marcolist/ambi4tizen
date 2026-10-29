#pragma once
#include <stdbool.h>

// Conservative candidates only. Confirm the actual board schematic and wiring.
static inline bool ambi_gpio_allowed(int pin, bool esp32s3) {
    if (esp32s3) {
        // Exclude strapping, flash/PSRAM (including octal), native USB and UART0.
        return pin==1 || pin==2 || (pin>=4 && pin<=18) || pin==21 ||
            (pin>=38 && pin<=42) || pin==47 || pin==48;
    }
    return pin==4 || (pin>=13 && pin<=14) || (pin>=18 && pin<=19) ||
        (pin>=21 && pin<=23) || (pin>=25 && pin<=27) || pin==32 || pin==33;
}

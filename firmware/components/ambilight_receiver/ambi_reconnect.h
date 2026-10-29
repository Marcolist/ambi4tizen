#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef struct { unsigned attempts; uint64_t due; bool connected; } ambi_reconnect_t;
void ambi_reconnect_lost(ambi_reconnect_t *, uint64_t now);
bool ambi_reconnect_due(ambi_reconnect_t *, uint64_t now);
void ambi_reconnect_up(ambi_reconnect_t *);

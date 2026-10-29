#include "ambi_mode.h"
void ambi_mode_init(ambi_mode_state_t *s, const ambi_config_t *c) {
    s->requested=c->mode; s->ambient_on=c->ambient_on; s->ambient=c->ambient;
}
void ambi_mode_set(ambi_mode_state_t *s, ambi_mode_t mode) {
    if (mode >= AMBI_OFF && mode <= AMBI_AUTO) s->requested=mode;
}
ambi_mode_t ambi_mode_effective(const ambi_mode_state_t *s, bool present,
    uint64_t last, uint64_t now, uint32_t timeout) {
    bool live=present && now >= last && now-last <= timeout;
    if (s->requested==AMBI_AUTO) return live ? AMBI_AMBILIGHT : (s->ambient_on ? AMBI_AMBIENT : AMBI_OFF);
    if (s->requested==AMBI_AMBILIGHT && !live) return AMBI_OFF;
    return s->requested;
}

#include "ambi_reconnect.h"
void ambi_reconnect_lost(ambi_reconnect_t *s,uint64_t now) {
    s->connected=false; unsigned delay=500u << (s->attempts>6 ? 6 : s->attempts);
    s->due=now+(delay>30000 ? 30000 : delay); if(s->attempts<7) s->attempts++;
}
bool ambi_reconnect_due(ambi_reconnect_t *s,uint64_t now) {
    if(s->connected || now<s->due) return false;
    /* Schedule before attempting, also covering a connect call that fails synchronously. */
    ambi_reconnect_lost(s,now); return true;
}
void ambi_reconnect_up(ambi_reconnect_t *s) { s->connected=true; s->attempts=0; s->due=0; }

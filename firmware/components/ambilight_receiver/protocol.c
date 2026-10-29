#include "ambi_protocol.h"
#include <string.h>

static uint16_t u16(const uint8_t *p) { return (uint16_t)((uint16_t)p[0] << 8 | p[1]); }
static uint32_t u32(const uint8_t *p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
ambi_packet_result_t ambi_packet_decode(const uint8_t *p, size_t n,
    ambi_auth_fn verify, void *context, ambi_frame_t *out)
{
    if (!p || !out || !verify || n < AMBI_HEADER_SIZE + AMBI_TAG_SIZE || n > AMBI_MAX_PACKET)
        return AMBI_PACKET_FORMAT;
    unsigned count = u16(p + 6);
    if (memcmp(p, "AMB1", 4) || p[4] != 1 || (p[5] & ~AMBI_FLAG_BRIGHTNESS) ||
        count < 3 || count > AMBI_MAX_ZONES || !p[27] || !p[28] || !p[29] ||
        (unsigned)p[27] + p[28] + p[29] != count || p[30] || p[31] ||
        n != AMBI_HEADER_SIZE + count * 3 + AMBI_TAG_SIZE)
        return AMBI_PACKET_FORMAT;
    uint64_t session = (uint64_t)u32(p + 8) << 32 | u32(p + 12);
    if (!session) return AMBI_PACKET_FORMAT;
    if (!verify(p, n - AMBI_TAG_SIZE, p + n - AMBI_TAG_SIZE, context)) return AMBI_PACKET_AUTH;
    ambi_frame_t f = {0};
    f.session = session; f.sequence = u32(p + 16); f.capture_ms = u32(p + 20);
    f.age_ms = u16(p + 24); f.flags = p[5]; f.brightness = p[26];
    f.left = p[27]; f.top = p[28]; f.right = p[29]; f.count = (uint8_t)count;
    for (unsigned i = 0; i < count; i++) {
        f.zones[i] = (ambi_rgb_t){p[32 + i*3], p[33 + i*3], p[34 + i*3]};
    }
    *out = f;
    return AMBI_PACKET_OK;
}

ambi_accept_t ambi_stream_accept(ambi_stream_state_t *s, const ambi_frame_t *f,
    uint64_t now, uint32_t timeout, uint16_t max_age, uint16_t max_lag)
{
    if (f->age_ms > max_age) return AMBI_STALE;
    bool changed = !s->active || f->session != s->session;
    if (changed) {
        for (unsigned i = 0; i < 8; i++) if (s->retired[i] == f->session) return AMBI_RETIRED;
        if (s->active && now - s->last_rx_ms <= timeout) return AMBI_SESSION_BUSY;
    } else {
        uint32_t delta = f->sequence - s->sequence;
        if (!delta || delta >= 0x80000000u) return AMBI_REORDER;
        uint32_t sender_elapsed = f->capture_ms - s->anchor_capture_ms;
        if (sender_elapsed >= 0x80000000u) return AMBI_STALE;
        int64_t lag = (int64_t)(now - s->anchor_rx_ms) - sender_elapsed;
        if (lag > max_lag) return AMBI_STALE;
        // Anchor to the least-delayed accepted arrival, never hide growing lag.
        if (lag < 0) { s->anchor_rx_ms = now; s->anchor_capture_ms = f->capture_ms; }
    }
    if (changed) {
        if (s->active) s->retired[s->retired_next++ % 8] = s->session;
        s->anchor_rx_ms = now; s->anchor_capture_ms = f->capture_ms;
    }
    s->active = true; s->session = f->session; s->sequence = f->sequence; s->last_rx_ms = now;
    return AMBI_ACCEPT;
}

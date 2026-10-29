#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define AMBI_MAX_ZONES 24
#define AMBI_HEADER_SIZE 32
#define AMBI_TAG_SIZE 16
#define AMBI_MAX_PACKET (AMBI_HEADER_SIZE + 3 * AMBI_MAX_ZONES + AMBI_TAG_SIZE)
#define AMBI_FLAG_BRIGHTNESS 1

typedef struct { uint8_t r, g, b; } ambi_rgb_t;
typedef struct {
    uint64_t session;
    uint32_t sequence, capture_ms;
    uint16_t age_ms;
    uint8_t brightness, flags, left, top, right, count;
    ambi_rgb_t zones[AMBI_MAX_ZONES];
} ambi_frame_t;
typedef bool (*ambi_auth_fn)(const uint8_t *, size_t, const uint8_t *, void *);
typedef enum { AMBI_PACKET_OK, AMBI_PACKET_FORMAT, AMBI_PACKET_AUTH } ambi_packet_result_t;
ambi_packet_result_t ambi_packet_decode(const uint8_t *data, size_t length,
    ambi_auth_fn verify, void *context, ambi_frame_t *frame);
bool ambi_hmac_verify(const uint8_t *data, size_t length, const uint8_t *tag, void *key);

typedef struct {
    bool active;
    uint64_t session, retired[8], last_rx_ms, anchor_rx_ms;
    unsigned retired_next;
    uint32_t sequence, anchor_capture_ms;
} ambi_stream_state_t;
typedef enum { AMBI_ACCEPT, AMBI_STALE, AMBI_REORDER, AMBI_SESSION_BUSY, AMBI_RETIRED } ambi_accept_t;
ambi_accept_t ambi_stream_accept(ambi_stream_state_t *state, const ambi_frame_t *frame,
    uint64_t now_ms, uint32_t timeout_ms, uint16_t max_age_ms, uint16_t max_lag_ms);

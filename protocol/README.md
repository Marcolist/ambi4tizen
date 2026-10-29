# AMB1 color protocol, version 1

UDP unicast, default port 19446. One datagram is one complete U-shaped frame.
Only averaged RGB colors leave the TV. No JPEG, image pixels, title or account data.
All multi-byte integers are unsigned and big endian. Maximum datagram: 120 bytes.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `AMB1` |
| 4 | 1 | Version `1` |
| 5 | 1 | Flags: bit 0 = brightness present; other bits zero |
| 6 | 2 | Zone count N, 3–24 |
| 8 | 8 | Random, nonzero sender session ID; new for each service launch |
| 16 | 4 | Sequence, increasing modulo 2³² |
| 20 | 4 | Capture **start** on sender monotonic clock, milliseconds modulo 2³² |
| 24 | 2 | Age from capture start through encoding, milliseconds |
| 26 | 1 | Optional brightness 0–255; ignored without flag 0 |
| 27 | 1 | Left zone count, positive |
| 28 | 1 | Top zone count, positive |
| 29 | 1 | Right zone count, positive; three counts sum to N |
| 30 | 2 | Reserved, both zero |
| 32 | 3 × N | R,G,B triples in the order below |
| 32 + 3 × N | 16 | First 16 bytes of HMAC-SHA256 over header + RGB payload |

Zone order, **looking at the screen from the front**: bottom of left side →
top of left side → across top from left to right → down right side. No bottom
edge, and no interpolation from the last zone back to the first.
Sender layouts: 6 = 2/2/2, 12 = 3/6/3, 18 = 5/8/5, 24 = 6/12/6.
Receiver accepts other positive splits up to 24 total. Every zone comes from
the same JPEG. Edge depth is a fraction of width/height, default 10%.
Left and top corner sampling rectangles overlap deliberately.

## Validation and freshness

Receiver checks exact length, version, flags, section sum, reserved bytes and
nonzero session before authenticating with the shared 32-byte key. It also pins
the sender IPv4 address. An authenticated packet cannot change modes, mapping,
network configuration, output enable or stored settings. Brightness can only
reduce the local brightness/cap. Authentication is not encryption.

Sequence delta must be 1..2³¹−1, so normal uint32 wrap works. Reported capture
age must be at most 1500 ms by default. Within a session, relative sender-clock
progress is compared with receiver arrival progress. Arrival lag over the
fastest observed anchor may not exceed 600 ms by default. Bad packets never
refresh stream presence or modify its sequence/anchor.

A new session may take over only after the current stream timeout (default
3000 ms). Eight retired sessions are remembered in RAM. These are bounded
freshness checks, not persistent anti-replay protection: without synchronized
clocks the first authenticated packet's one-way network delay is unknown.
Replays after receiver reboot or retirement-cache eviction cannot always be
identified. Keys are private, but a party holding the key can forge frames.

The current relative clock gate is intended for bounded prototype runs. Its
anchor interval must remain below 2³¹ ms (~24.9 days), and clock drift has not
been characterized across long runs. Long-running production operation needs
an explicit clock/re-anchoring policy plus live testing. No such duration is
claimed by this prototype.

## Delivery and scheduling

There is no retransmission or frame acknowledgment. Only the newest accepted
frame is retained in the ESP queue. TV captures never overlap. The default run
is 30 seconds at a target interval of 1000 ms; minimum supported interval is
500 ms. A slow capture lowers the actual rate instead of creating a queue.
Three consecutive processing/send errors stop the sender. A cleanup failure
stops it immediately. UDP send success means the local OS accepted a datagram;
receiver counters are needed to confirm delivery.

Reference implementations: [Node sender](../tv/protocol.js),
[firmware decoder](../firmware/components/ambilight_receiver/protocol.c),
[independent Python encoder](../tools/pattern_sender.py).

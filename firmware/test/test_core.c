#include "ambi_protocol.h"
#include "ambi_config.h"
#include "ambi_color.h"
#include "ambi_mode.h"
#include "ambi_reconnect.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <openssl/hmac.h>
static uint8_t key[32];
static void sign_packet(uint8_t *p,size_t n) { uint8_t digest[32]; unsigned length; HMAC(EVP_sha256(),key,32,p,n-16,digest,&length);memcpy(p+n-16,digest,16); }
static size_t packet(uint8_t *p) {
    size_t n=57;memset(p,0,n);memcpy(p,"AMB1",4);p[4]=1;p[7]=3;p[15]=1;p[27]=p[28]=p[29]=1;
    p[32]=255;p[36]=255;p[40]=255;sign_packet(p,n);return n;
}
static void protocol_tests(void) {
    uint8_t p[121];size_t n=packet(p);ambi_frame_t f;
    assert(ambi_packet_decode(p,n,ambi_hmac_verify,key,&f)==AMBI_PACKET_OK);
    assert(f.count==3 && f.zones[0].r==255 && f.zones[1].g==255 && f.zones[2].b==255);
    for(size_t i=0;i<n;i++)assert(ambi_packet_decode(p,i,ambi_hmac_verify,key,&f)!=AMBI_PACKET_OK);
    for(size_t i=0;i<n;i++) {p[i]^=1;assert(ambi_packet_decode(p,n,ambi_hmac_verify,key,&f)!=AMBI_PACKET_OK);p[i]^=1;}
    unsigned offsets[]={4,5,6,7,27,28,29,30,31};
    for(unsigned i=0;i<sizeof(offsets)/sizeof(offsets[0]);i++) {
        packet(p);p[offsets[i]]=255;sign_packet(p,n);assert(ambi_packet_decode(p,n,ambi_hmac_verify,key,&f)==AMBI_PACKET_FORMAT);
    }
    packet(p);p[15]=0;sign_packet(p,n);assert(ambi_packet_decode(p,n,ambi_hmac_verify,key,&f)==AMBI_PACKET_FORMAT);
    const uint8_t layouts[4][3]={{2,2,2},{3,6,3},{5,8,5},{6,12,6}};
    for(unsigned k=0;k<4;k++) {
        packet(p);unsigned count=layouts[k][0]+layouts[k][1]+layouts[k][2];size_t size=48+3*count;
        p[7]=count;memcpy(p+27,layouts[k],3);
        for(unsigned i=0;i<3*count;i++)p[32+i]=(uint8_t)(i*7);
        sign_packet(p,size);assert(ambi_packet_decode(p,size,ambi_hmac_verify,key,&f)==AMBI_PACKET_OK && f.count==count);
        assert(f.zones[count-1].b==(uint8_t)((3*count-1)*7));
    }
    for(unsigned trial=0;trial<20000;trial++) {
        size_t len=rand()%sizeof(p); for(size_t i=0;i<len;i++)p[i]=rand();
        assert(ambi_packet_decode(p,len,ambi_hmac_verify,key,&f)!=AMBI_PACKET_OK);
    }
    puts("PASS protocol: HMAC, truncation, each byte mutation, layout, 20000 malformed packets");
}
static void stream_tests(void) {
    ambi_stream_state_t s={0}; ambi_frame_t f={.session=1,.sequence=0xfffffffe,.capture_ms=0xfffffff0,.age_ms=50};
#define ACCEPT(now) ambi_stream_accept(&s,&f,now,3000,1500,600)
    assert(ACCEPT(1000)==AMBI_ACCEPT); assert(ACCEPT(1001)==AMBI_REORDER);
    f.sequence=0xffffffff;f.capture_ms=0x10;assert(ACCEPT(1032)==AMBI_ACCEPT);
    f.sequence=0;f.capture_ms=0x30;assert(ACCEPT(1064)==AMBI_ACCEPT);
    f.sequence=0xffffffff;assert(ACCEPT(1065)==AMBI_REORDER);
    f.sequence=1;f.age_ms=1501;assert(ACCEPT(1066)==AMBI_STALE); f.age_ms=50;
    f.capture_ms=0x40;assert(ACCEPT(2000)==AMBI_STALE); /* Arrival lag, not reported processing age. */
    f.capture_ms=0x400;assert(ACCEPT(2040)==AMBI_ACCEPT);
    f.session=2;assert(ACCEPT(2041)==AMBI_SESSION_BUSY);
    assert(ACCEPT(5041)==AMBI_ACCEPT);
    f.session=1;assert(ACCEPT(9000)==AMBI_RETIRED);
    f.session=2;f.sequence=2;f.capture_ms=0x300;assert(ACCEPT(9000)==AMBI_STALE);
#undef ACCEPT
    puts("PASS freshness: sequence/clock wrap, age, delayed arrival, session takeover and retired replay");
}
static void modes(void) {
    ambi_config_t c;ambi_config_defaults(&c);c.ambient_on=true;c.ambient=(ambi_rgb_t){1,2,3};
    ambi_mode_state_t s;ambi_mode_init(&s,&c);
    assert(ambi_mode_effective(&s,false,0,0,3000)==AMBI_AMBIENT);
    assert(ambi_mode_effective(&s,true,10,3010,3000)==AMBI_AMBILIGHT);
    assert(ambi_mode_effective(&s,true,10,3011,3000)==AMBI_AMBIENT);
    ambi_mode_set(&s,AMBI_OFF);assert(ambi_mode_effective(&s,true,5000,5001,3000)==AMBI_OFF);
    ambi_mode_set(&s,AMBI_AMBIENT);assert(ambi_mode_effective(&s,true,5000,5001,3000)==AMBI_AMBIENT);
    ambi_mode_set(&s,AMBI_AMBILIGHT);assert(ambi_mode_effective(&s,true,5000,8001,3000)==AMBI_OFF);
    s.ambient_on=false;ambi_mode_set(&s,AMBI_AUTO);assert(ambi_mode_effective(&s,false,0,9000,3000)==AMBI_OFF);
    puts("PASS modes: manual priority, AUTO fallback, AMBILIGHT timeout, OFF ignores stream");
}
static void config_tests(void) {
    ambi_config_t c,out;ambi_config_defaults(&c);uint8_t encoded[AMBI_CONFIG_BYTES],copy[AMBI_CONFIG_BYTES];
    assert(ambi_config_validate(&c));assert(!c.output_enabled && c.gpio==-1 && !ambi_led_count(&c));
    strcpy(c.ssid,"test-network");strcpy(c.password,"local-fixture-only");c.profile_id=0x12345678;c.leds_left=7;c.leds_top=13;c.leds_right=8;c.reverse=true;c.start_offset=17;
    assert(ambi_config_encode(&c,encoded));assert(ambi_config_decode(encoded,sizeof(encoded),&out));
    assert(out.profile_id==c.profile_id && out.reverse && out.start_offset==17 && !strcmp(out.password,c.password));
    assert(ambi_config_encode(&out,copy) && !memcmp(copy,encoded,sizeof(copy)));
    for(unsigned i=0;i<sizeof(encoded);i++) {encoded[i]^=1;assert(!ambi_config_decode(encoded,sizeof(encoded),&out));encoded[i]^=1;}
    assert(!ambi_config_decode(encoded,sizeof(encoded)-1,&out));
    c.leds_left=AMBI_MAX_LEDS;assert(!ambi_config_validate(&c));
    ambi_config_defaults(&c);c.output_enabled=true;assert(!ambi_config_validate(&c));
    c.mode=(ambi_mode_t)-1;assert(!ambi_config_validate(&c));
    puts("PASS persistence: defaults, canonical roundtrip, CRC at every byte, bounds, invalid mode");
}
static ambi_color_engine_t engine;
static ambi_rgb_t out[AMBI_MAX_LEDS];
static void color_tests(void) {
    ambi_config_t c;ambi_config_defaults(&c);c.leds_left=c.leds_top=c.leds_right=3;
    c.gamma_milli=1000;c.smoothing_ms=0;c.brightness=c.brightness_cap=255;c.current_limit_ma=30000;
    ambi_frame_t f={.left=1,.top=1,.right=1,.count=3,.zones={{255,0,0},{0,255,0},{0,0,255}}};
    ambi_color_init(&engine,&c);ambi_color_render(&engine,&c,&f,AMBI_AMBILIGHT,c.ambient,0,out);
    assert(out[0].r==255 && out[4].g==255 && out[8].b==255);
    assert(out[2].r==170 && out[2].g==85); /* Corner blends; no bottom wrap. */
    assert(out[6].g==85 && out[6].b==170);
    c.reverse=true;c.start_offset=4;
    ambi_color_render(&engine,&c,&f,AMBI_AMBILIGHT,c.ambient,20,out);
    assert(out[4].r==255 && out[0].g==255 && out[5].b==255);
    c.gamma_milli=2200;ambi_color_init(&engine,&c);
    assert(engine.gamma[0]==0 && engine.gamma[255]==255 && engine.gamma[128]>=55 && engine.gamma[128]<=57);
    for(unsigned i=1;i<256;i++)assert(engine.gamma[i]>=engine.gamma[i-1]);
    c.gamma_milli=1000;c.smoothing_ms=100;ambi_color_init(&engine,&c);
    ambi_color_render(&engine,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){0,0,0},0,out);
    ambi_color_render(&engine,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){255,255,255},100,out);
    assert(out[0].r>=160 && out[0].r<=162);
    ambi_color_render(&engine,&c,NULL,AMBI_OFF,c.ambient,101,out);assert(out[0].r==0 && !engine.initialized && engine.estimated_ma==9);
    c.smoothing_ms=0;c.current_limit_ma=100;ambi_color_init(&engine,&c);
    ambi_color_render(&engine,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){255,255,255},200,out);
    assert(engine.estimated_ma<=100 && out[0].r<=43);
    c.current_limit_ma=30000;c.brightness=80;c.brightness_cap=40;
    ambi_color_render(&engine,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){255,255,255},300,out);assert(out[0].r==40);
    f.flags=AMBI_FLAG_BRIGHTNESS;f.brightness=20;
    ambi_color_render(&engine,&c,&f,AMBI_AMBILIGHT,c.ambient,400,out);assert(out[ambi_physical_index(&c,0)].r==20);
    const unsigned counts[]={3,17,81,87,123,599,600};
    for(unsigned k=0;k<sizeof(counts)/sizeof(counts[0]);k++) {
        unsigned n=counts[k];c.leds_left=n/3;c.leds_top=n/3;c.leds_right=n-2*(n/3);c.start_offset=n-1;
        bool used[AMBI_MAX_LEDS]={0};for(unsigned i=0;i<n;i++){unsigned p=ambi_physical_index(&c,i);assert(p<n && !used[p]);used[p]=true;}
        assert(ambi_config_validate(&c));ambi_color_init(&engine,&c);ambi_color_render(&engine,&c,&f,AMBI_AMBILIGHT,c.ambient,500,out);
    }
    puts("PASS colors: U mapping, direction/start, corner interpolation, gamma, EMA, brightness/current cap, 3..600 LEDs");
}
static void reconnect(void) {
    ambi_reconnect_t s={0};assert(ambi_reconnect_due(&s,0));assert(s.due==500);
    assert(!ambi_reconnect_due(&s,499));assert(ambi_reconnect_due(&s,500));assert(s.due==1500);
    for(unsigned i=0;i<30;i++){uint64_t now=s.due;assert(ambi_reconnect_due(&s,now));assert(s.due-now<=30000);}
    ambi_reconnect_up(&s);assert(!ambi_reconnect_due(&s,999999));assert(s.attempts==0);
    ambi_reconnect_lost(&s,1000000);assert(s.due==1000500);assert(ambi_reconnect_due(&s,1000500));
    puts("PASS reconnect: exponential backoff, cap, connected pause, reset after disconnect");
}
int main(void) {
    for(unsigned i=0;i<32;i++)key[i]=i;
    protocol_tests();stream_tests();modes();config_tests();color_tests();reconnect();puts("ALL CORE TESTS PASSED");return 0;
}

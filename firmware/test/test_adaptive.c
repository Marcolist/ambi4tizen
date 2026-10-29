#include "ambi_color.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

static ambi_color_engine_t a,b;
static ambi_rgb_t out[AMBI_MAX_LEDS],other[AMBI_MAX_LEDS];
static ambi_config_t config(void) {
    ambi_config_t c;ambi_config_defaults(&c);
    c.leds_left=24;c.leds_top=43;c.leds_right=24;c.reverse=true;c.start_offset=90;
    c.gamma_milli=1000;c.smoothing_ms=150;c.brightness=c.brightness_cap=255;c.current_limit_ma=6000;
    return c;
}
static ambi_frame_t frame(ambi_rgb_t color) {
    ambi_frame_t f={.session=1,.sequence=1,.left=3,.top=6,.right=3,.count=12};
    for(unsigned i=0;i<f.count;i++)f.zones[i]=color;
    return f;
}
static void paint(ambi_frame_t *f,ambi_rgb_t color) {
    f->sequence++;
    for(unsigned i=0;i<f->count;i++)f->zones[i]=color;
}
static void draw(const ambi_config_t *c,const ambi_frame_t *f,uint64_t now) {
    ambi_color_render(&a,c,f,AMBI_AMBILIGHT,c->ambient,now,out);
}
static void gradual_changes(void) {
    ambi_config_t c=config();ambi_frame_t f=frame((ambi_rgb_t){100,100,100});
    ambi_color_init(&a,&c);draw(&c,&f,0);paint(&f,(ambi_rgb_t){112,112,112});draw(&c,&f,20);
    assert(!a.fast_transition && !a.scene_changes && a.active_smoothing_ms==80);
    assert(out[0].r>100 && out[0].r<112);
    unsigned previous=out[0].r;
    for(unsigned t=40;t<=400;t+=20) {
        draw(&c,&f,t);assert(out[0].r>=previous && out[0].r<=112);previous=out[0].r;
    }
    assert(out[0].r==112 && !a.scene_changes);
    for(unsigned i=0;i<20;i++) {
        paint(&f,(ambi_rgb_t){i%2 ? 111 : 113,112,112});draw(&c,&f,420+i*20);
        assert(!a.fast_transition && !a.scene_changes);
    }
}
static void scene_changes(void) {
    ambi_config_t c=config();ambi_frame_t f=frame((ambi_rgb_t){255,0,0});
    ambi_color_init(&a,&c);draw(&c,&f,0);paint(&f,(ambi_rgb_t){0,0,255});draw(&c,&f,20);
    assert(a.fast_transition && a.scene_changes==1 && a.active_smoothing_ms==25);
    assert(out[0].r>0 && out[0].b>0 && out[0].b<255); // Fast fade, not a hard cut.
    draw(&c,&f,80);assert(a.fast_transition && a.scene_changes==1);
    assert(out[0].r<=11 && out[0].b>=244); // At least 95% of the new RGB target.
    draw(&c,&f,250);assert(out[0].r==0 && out[0].b==255 && a.scene_changes==1);
    paint(&f,(ambi_rgb_t){0,0,250});draw(&c,&f,270);
    assert(!a.fast_transition && a.active_smoothing_ms==80 && a.scene_changes==1);
    // Equal overall palette averages must not hide a spatially rearranged cut.
    f=frame((ambi_rgb_t){255,0,0});
    for(unsigned i=0;i<6;i++)f.zones[i]=(ambi_rgb_t){0,0,255};
    ambi_color_init(&a,&c);draw(&c,&f,0);f.sequence++;
    for(unsigned i=0;i<12;i++)f.zones[i]=i<6 ? (ambi_rgb_t){255,0,0} : (ambi_rgb_t){0,0,255};
    draw(&c,&f,20);assert(a.fast_transition && a.scene_changes==1);
}
static void reject_local_motion(void) {
    ambi_config_t c=config();ambi_frame_t f=frame((ambi_rgb_t){100,100,100});
    ambi_color_init(&a,&c);draw(&c,&f,0);f.sequence++;f.zones[0]=(ambi_rgb_t){255,255,255};
    draw(&c,&f,20);assert(!a.fast_transition && !a.scene_changes);
    // Broad low-amplitude changes remain on the normal smoothing path.
    f=frame((ambi_rgb_t){100,100,100});ambi_color_init(&a,&c);draw(&c,&f,0);
    paint(&f,(ambi_rgb_t){125,125,125});draw(&c,&f,20);assert(!a.fast_transition);
    // A large change over most of the sampled border selects the fast path.
    f=frame((ambi_rgb_t){100,100,100});ambi_color_init(&a,&c);draw(&c,&f,0);f.sequence++;
    for(unsigned i=0;i<8;i++)f.zones[i]=(ambi_rgb_t){180,180,180};
    draw(&c,&f,20);assert(a.fast_transition && a.scene_changes==1);
}
static void frame_identity_and_modes(void) {
    ambi_config_t c=config();ambi_frame_t f=frame((ambi_rgb_t){255,0,0});
    ambi_color_init(&a,&c);draw(&c,&f,0);
    paint(&f,(ambi_rgb_t){0,0,255});f.session=2;draw(&c,&f,20);
    assert(!a.fast_transition && !a.scene_changes); // Do not compare different senders.
    f=frame((ambi_rgb_t){255,0,0});ambi_color_init(&a,&c);draw(&c,&f,0);
    f.count=6;f.left=f.top=f.right=2;paint(&f,(ambi_rgb_t){0,0,255});draw(&c,&f,20);
    assert(!a.fast_transition && !a.scene_changes); // Layout change resets the reference.
    f=frame((ambi_rgb_t){255,0,0});f.sequence=0xffffffffu;ambi_color_init(&a,&c);draw(&c,&f,0);
    paint(&f,(ambi_rgb_t){0,0,255});draw(&c,&f,20);assert(a.fast_transition && a.scene_changes==1);
    ambi_color_render(&a,&c,NULL,AMBI_OFF,c.ambient,40,out);
    assert(!a.initialized && !a.previous_frame_valid && !a.fast_transition && !a.active_smoothing_ms);
    for(unsigned i=0;i<91;i++)assert(!out[i].r && !out[i].g && !out[i].b);
    draw(&c,&f,60);assert(out[0].b==255 && !a.fast_transition && a.scene_changes==1);
    ambi_color_init(&a,&c);
    ambi_color_render(&a,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){0,0,0},0,out);
    ambi_color_render(&a,&c,NULL,AMBI_AMBIENT,(ambi_rgb_t){255,255,255},100,out);
    assert(a.active_smoothing_ms==150 && !a.fast_transition && out[0].r>=123 && out[0].r<=125);
}
static void cadence_and_safety(void) {
    ambi_config_t c=config();ambi_frame_t f=frame((ambi_rgb_t){100,100,100});
    ambi_color_init(&a,&c);ambi_color_init(&b,&c);draw(&c,&f,0);
    ambi_color_render(&b,&c,&f,AMBI_AMBILIGHT,c.ambient,0,other);
    paint(&f,(ambi_rgb_t){112,112,112});
    for(unsigned t=20;t<=100;t+=20)draw(&c,&f,t);
    ambi_color_render(&b,&c,&f,AMBI_AMBILIGHT,c.ambient,100,other);
    assert(fabsf(a.smoothed[0][0]-b.smoothed[0][0])<.001f && out[0].r==other[0].r);
    // A configured shorter time remains an upper bound; zero disables smoothing.
    c.smoothing_ms=10;f=frame((ambi_rgb_t){0,0,0});ambi_color_init(&a,&c);draw(&c,&f,0);
    paint(&f,(ambi_rgb_t){255,255,255});draw(&c,&f,20);assert(a.active_smoothing_ms==10);
    c.smoothing_ms=0;draw(&c,&f,40);assert(out[0].r==255 && !a.active_smoothing_ms && !a.fast_transition);
    c=config();c.gamma_milli=2200;c.brightness_cap=32;c.current_limit_ma=150;
    f=frame((ambi_rgb_t){255,0,0});ambi_color_init(&a,&c);draw(&c,&f,0);
    paint(&f,(ambi_rgb_t){0,0,255});
    for(unsigned t=20;t<=250;t+=20) {
        draw(&c,&f,t);assert(a.estimated_ma<=150);
        for(unsigned i=0;i<91;i++)assert(out[i].r<=32 && out[i].g<=32 && out[i].b<=32);
    }
}
int main(void) {
    gradual_changes();scene_changes();reject_local_motion();frame_identity_and_modes();cadence_and_safety();
    puts("PASS adaptive smoothing: gradual updates, fast palette cuts, local motion/noise, frame identity, cadence, OFF/ambient and output limits");
    return 0;
}

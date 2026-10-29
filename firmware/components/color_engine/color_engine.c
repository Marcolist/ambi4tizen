#include "ambi_color.h"
#include <math.h>
#include <string.h>
static uint8_t byte(float v) { return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v+0.5f); }
void ambi_color_init(ambi_color_engine_t *s, const ambi_config_t *c) {
    memset(s,0,sizeof(*s));
    for (unsigned i=0;i<256;i++) s->gamma[i]=byte(255*powf(i/255.0f,c->gamma_milli/1000.0f));
}
unsigned ambi_physical_index(const ambi_config_t *c, unsigned i) {
    unsigned n=ambi_led_count(c);
    return n ? (c->start_offset + (c->reverse ? n-i%n : i))%n : 0;
}
/* Zone centers in LED-distance coordinates. Interpolation crosses both corners,
 * but never wraps across the unlit bottom edge. */
static ambi_rgb_t sample(const ambi_config_t *c,const ambi_frame_t *f,float p) {
    unsigned nz[3]={f->left,f->top,f->right}, nl[3]={c->leds_left,c->leds_top,c->leds_right};
    float centers[AMBI_MAX_ZONES]; unsigned k=0, offset=0;
    for(unsigned side=0;side<3;side++) {
        for(unsigned j=0;j<nz[side];j++) centers[k++]=offset+(j+0.5f)*nl[side]/nz[side];
        offset+=nl[side];
    }
    if(p<=centers[0]) return f->zones[0];
    for(unsigned j=1;j<f->count;j++) if(p<centers[j]) {
        float t=(p-centers[j-1])/(centers[j]-centers[j-1]);
        ambi_rgb_t a=f->zones[j-1],b=f->zones[j];
        return (ambi_rgb_t){byte(a.r+(b.r-a.r)*t),byte(a.g+(b.g-a.g)*t),byte(a.b+(b.b-a.b)*t)};
    }
    return f->zones[f->count-1];
}
void ambi_color_render(ambi_color_engine_t *s,const ambi_config_t *c,const ambi_frame_t *f,
    ambi_mode_t mode,ambi_rgb_t ambient,uint64_t now,ambi_rgb_t *out) {
    unsigned n=ambi_led_count(c);
    if(mode==AMBI_OFF || (mode==AMBI_AMBILIGHT && !f)) {
        memset(out,0,n*sizeof(*out)); memset(s->smoothed,0,sizeof(s->smoothed));
        s->initialized=false; s->last_ms=now; s->estimated_ma=n; return;
    }
    float alpha=(!s->initialized || !c->smoothing_ms) ? 1.0f :
        1-expf(-(float)(now-s->last_ms)/c->smoothing_ms);
    unsigned brightness=c->brightness < c->brightness_cap ? c->brightness : c->brightness_cap;
    if(mode==AMBI_AMBILIGHT && (f->flags&AMBI_FLAG_BRIGHTNESS) && f->brightness<brightness) brightness=f->brightness;
    uint32_t sum=0;
    for(unsigned i=0;i<n;i++) {
        ambi_rgb_t target=mode==AMBI_AMBILIGHT ? sample(c,f,i+0.5f) : ambient;
        uint8_t rgb[3]={target.r,target.g,target.b}, value[3];
        for(unsigned ch=0;ch<3;ch++) {
            s->smoothed[i][ch]+=alpha*(rgb[ch]-s->smoothed[i][ch]);
            value[ch]=(s->gamma[byte(s->smoothed[i][ch])]*brightness+127)/255;
            sum+=value[ch];
        }
        out[ambi_physical_index(c,i)]=(ambi_rgb_t){value[0],value[1],value[2]};
    }
    /* Estimate includes 1 mA idle per LED. It is not an electrical protection. */
    unsigned dynamic=(sum*c->white_pixel_ma+764)/765;
    unsigned budget=c->current_limit_ma>n ? c->current_limit_ma-n : 0;
    if(dynamic>budget) for(unsigned i=0;i<n;i++) {
        out[i].r=(uint32_t)out[i].r*budget/dynamic;
        out[i].g=(uint32_t)out[i].g*budget/dynamic;
        out[i].b=(uint32_t)out[i].b*budget/dynamic;
    }
    s->estimated_ma=n+(dynamic>budget ? budget : dynamic);
    s->initialized=true; s->last_ms=now;
}

#include "ambi_color.h"
#include <math.h>
#include <string.h>
static uint8_t byte(float v) { return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v+0.5f); }
/* Palette-change heuristic, not semantic video-cut detection. Keep the selected
 * speed for the whole incoming frame, rather than reclassifying every 20 ms. */
static uint16_t smoothing(ambi_color_engine_t *s,const ambi_config_t *c,
    const ambi_frame_t *f,ambi_mode_t mode) {
    unsigned ms=c->smoothing_ms;
    if(mode!=AMBI_AMBILIGHT || !f || !ms) {
        s->previous_frame_valid=false; s->fast_transition=false;
        return ms;
    }
    const ambi_frame_t *p=&s->previous_frame;
    bool comparable=s->previous_frame_valid && p->session==f->session &&
        p->count==f->count && p->left==f->left && p->top==f->top && p->right==f->right;
    if(!comparable || p->sequence!=f->sequence) {
        bool cut=false;
        if(comparable) {
            unsigned total=0,changed=0;
            for(unsigned i=0;i<f->count;i++) {
                int delta[3]={(int)f->zones[i].r-p->zones[i].r,
                    (int)f->zones[i].g-p->zones[i].g,(int)f->zones[i].b-p->zones[i].b};
                unsigned maximum=0;
                for(unsigned ch=0;ch<3;ch++) {
                    unsigned distance=delta[ch]<0 ? -delta[ch] : delta[ch];
                    total+=distance; if(distance>maximum)maximum=distance;
                }
                if(maximum>=64)changed++;
            }
            cut=total>=48u*3*f->count && changed*100>=60u*f->count;
        }
        s->fast_transition=cut;
        if(cut)s->scene_changes++;
        s->previous_frame=*f; s->previous_frame_valid=true;
    }
    unsigned cap=s->fast_transition ? 25 : 80;
    return ms<cap ? ms : cap;
}
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
        s->initialized=false; s->last_ms=now; s->estimated_ma=n;
        s->previous_frame_valid=false; s->fast_transition=false; s->active_smoothing_ms=0; return;
    }
    s->active_smoothing_ms=smoothing(s,c,f,mode);
    float alpha=(!s->initialized || !s->active_smoothing_ms) ? 1.0f :
        1-expf(-(float)(now-s->last_ms)/s->active_smoothing_ms);
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

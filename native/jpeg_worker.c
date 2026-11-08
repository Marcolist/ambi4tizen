/* Bounded persistent JPEG decoder. stdin/stdout only; no files or device access. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <setjmp.h>
#include <time.h>
#include <jpeglib.h>

#define MAX_JPEG (2u * 1024u * 1024u)
#define MAX_WIDTH 960u
#define MAX_HEIGHT 540u
struct decoder_error { struct jpeg_error_mgr base; jmp_buf jump; };
static void failed(j_common_ptr c) { longjmp(((struct decoder_error *)c->err)->jump, 1); }
static void quiet(j_common_ptr c) { (void)c; }
static uint32_t u32(const unsigned char *p) { return (uint32_t)p[0]<<24 | (uint32_t)p[1]<<16 | (uint32_t)p[2]<<8 | p[3]; }
static void put32(unsigned char *p,uint32_t v) { p[0]=v>>24;p[1]=v>>16;p[2]=v>>8;p[3]=v; }
static int read_all(void *p,size_t n) {
    size_t pos=0;
    while(pos<n) { size_t got=fread((unsigned char *)p+pos,1,n-pos,stdin);if(!got)return 0;pos+=got; }
    return 1;
}
static uint64_t micros(void) { struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (uint64_t)t.tv_sec*1000000+t.tv_nsec/1000; }
static int reply(uint32_t status,unsigned w,unsigned h,unsigned sw,unsigned sh,unsigned us,const unsigned char *rgb) {
    unsigned char header[32]={ 'A','J','P','1' };uint32_t n=status?0:w*h*3;
    put32(header+4,status);put32(header+8,w);put32(header+12,h);put32(header+16,sw);put32(header+20,sh);put32(header+24,us);put32(header+28,n);
    if(fwrite(header,1,sizeof header,stdout)!=sizeof header || (n && fwrite(rgb,1,n,stdout)!=n))return 0;
    return fflush(stdout)==0;
}
/* Heap state survives libjpeg's longjmp; no indeterminate automatic pointers. */
struct decode_state { struct jpeg_decompress_struct c;struct decoder_error error;unsigned char *rgb;int created; };
static int decode(const unsigned char *jpeg,unsigned length,unsigned scale) {
    struct decode_state *s=calloc(1,sizeof *s);if(!s)return reply(1,0,0,0,0,0,NULL);
    uint64_t start=micros();s->c.err=jpeg_std_error(&s->error.base);s->error.base.error_exit=failed;s->error.base.output_message=quiet;
    if(setjmp(s->error.jump)) {
        if(s->created)jpeg_destroy_decompress(&s->c);free(s->rgb);free(s);
        return reply(2,0,0,0,0,0,NULL);
    }
    jpeg_create_decompress(&s->c);s->created=1;s->c.mem->max_memory_to_use=24*1024*1024;
    jpeg_mem_src(&s->c,jpeg,length);jpeg_read_header(&s->c,TRUE);
    unsigned sw=s->c.image_width,sh=s->c.image_height;
    if(sw<24 || sh<24 || sw>MAX_WIDTH || sh>MAX_HEIGHT) {
        jpeg_destroy_decompress(&s->c);free(s);return reply(3,0,0,sw,sh,0,NULL);
    }
    while(scale>1 && ((sw+scale-1)/scale<24 || (sh+scale-1)/scale<24))scale/=2;
    s->c.scale_num=1;s->c.scale_denom=scale;s->c.out_color_space=JCS_RGB;
    s->c.dct_method=JDCT_IFAST;s->c.do_fancy_upsampling=FALSE;
    jpeg_start_decompress(&s->c);
    unsigned w=s->c.output_width,h=s->c.output_height;
    if(s->c.output_components!=3 || w>MAX_WIDTH || h>MAX_HEIGHT) {
        jpeg_destroy_decompress(&s->c);free(s);return reply(3,0,0,sw,sh,0,NULL);
    }
    s->rgb=malloc((size_t)w*h*3);if(!s->rgb) {jpeg_destroy_decompress(&s->c);free(s);return reply(1,0,0,sw,sh,0,NULL);}
    while(s->c.output_scanline<h) {JSAMPROW row=s->rgb+(size_t)s->c.output_scanline*w*3;jpeg_read_scanlines(&s->c,&row,1);}
    jpeg_finish_decompress(&s->c);jpeg_destroy_decompress(&s->c);
    int ok=reply(0,w,h,sw,sh,(unsigned)(micros()-start),s->rgb);free(s->rgb);free(s);return ok;
}
int main(int argc,char **argv) {
    if(argc==2 && !strcmp(argv[1],"--self-test")) {puts("{\"worker\":\"ambi-jpeg-1\",\"protocol\":\"AJP1\",\"max_jpeg_bytes\":2097152}");return 0;}
    if(argc!=1)return 2;
    for(;;) {
        unsigned char header[8];if(!read_all(header,sizeof header))return ferror(stdin)?1:0;
        unsigned n=u32(header),scale=u32(header+4);
        if(n<4 || n>MAX_JPEG || (scale!=1 && scale!=2 && scale!=4 && scale!=8))return 2;
        unsigned char *jpeg=malloc(n);if(!jpeg)return 1;
        if(!read_all(jpeg,n)) {free(jpeg);return 1;}
        int ok=decode(jpeg,n,scale);free(jpeg);if(!ok)return 1;
    }
}

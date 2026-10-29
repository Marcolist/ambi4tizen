#define _POSIX_C_SOURCE 200809L
/* The actual firmware parser, stream gate, mode manager and renderer on a host. */
#include "ambi_protocol.h"
#include "ambi_config.h"
#include "ambi_color.h"
#include "ambi_mode.h"
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static uint64_t now_ms(void) {struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static unsigned number(const char *s,unsigned max) {char *end;errno=0;unsigned long n=strtoul(s,&end,10);if(errno || !*s || *end || n>max){fprintf(stderr,"Invalid number\n");exit(2);}return n;}
static ambi_color_engine_t colors;
static ambi_rgb_t pixels[AMBI_MAX_LEDS];
int main(int argc,char **argv) {
    if(argc<2) {fprintf(stderr,"Usage: receiver_sim KEY_HEX_FILE [port=19446] [seconds=10] [left=3 top=6 right=3]\nLoopback only. No GPIO.\n");return 2;}
    ambi_config_t c;ambi_config_defaults(&c);c.leds_left=3;c.leds_top=6;c.leds_right=3;c.brightness=c.brightness_cap=255;c.gamma_milli=1000;c.smoothing_ms=0;c.current_limit_ma=30000;
    FILE *file=fopen(argv[1],"r");char key[66]={0};if(!file || !fgets(key,sizeof(key),file)){fprintf(stderr,"Key file required\n");return 2;}fclose(file);
    if(strcspn(key,"\r\n")!=64){fprintf(stderr,"Key must be 64 hex digits\n");return 2;}
    for(unsigned i=0;i<32;i++){char part[3]={key[i*2],key[i*2+1],0},*end;unsigned long n=strtoul(part,&end,16);if(*end || n>255)return 2;c.key[i]=n;}
    if(!ambi_key_configured(c.key))return 2;
    if(argc>2) { c.udp_port=number(argv[2],65535); }
    unsigned seconds=argc>3?number(argv[3],3600):10;
    if(argc>4)c.leds_left=number(argv[4],AMBI_MAX_LEDS);
    if(argc>5)c.leds_top=number(argv[5],AMBI_MAX_LEDS);
    if(argc>6)c.leds_right=number(argv[6],AMBI_MAX_LEDS);
    if(!ambi_config_validate(&c) || !seconds)return 2;
    int fd=socket(AF_INET,SOCK_DGRAM,0);struct sockaddr_in local={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK),.sin_port=htons(c.udp_port)};
    if(fd<0 || bind(fd,(struct sockaddr *)&local,sizeof(local))<0){perror("bind");return 2;}
    printf("{\"ready\":true,\"port\":%u,\"leds\":%u}\n",c.udp_port,ambi_led_count(&c));fflush(stdout);
    ambi_stream_state_t stream={0};ambi_mode_state_t mode;ambi_mode_init(&mode,&c);ambi_color_init(&colors,&c);
    ambi_frame_t latest={0};bool have=false;unsigned accepted=0,rejected=0;uint64_t start=now_ms(),last=0;
    ambi_mode_t previous=AMBI_AUTO;
    while(now_ms()-start<(uint64_t)seconds*1000) {
        fd_set reads;FD_ZERO(&reads);FD_SET(fd,&reads);struct timeval timeout={.tv_usec=20000};
        int available=select(fd+1,&reads,NULL,NULL,&timeout);bool changed=false;
        if(available<0){perror("select");close(fd);return 2;}
        if(available>0) {
            uint8_t packet[AMBI_MAX_PACKET+1];ssize_t n=recv(fd,packet,sizeof(packet),0);ambi_frame_t frame;
            if(n>=0 && ambi_packet_decode(packet,n,ambi_hmac_verify,c.key,&frame)==AMBI_PACKET_OK &&
                ambi_stream_accept(&stream,&frame,now_ms(),c.timeout_ms,c.max_age_ms,c.max_lag_ms)==AMBI_ACCEPT) {
                latest=frame;have=true;last=now_ms();accepted++;changed=true;
            } else rejected++;
        }
        uint64_t now=now_ms();ambi_mode_t effective=ambi_mode_effective(&mode,have,last,now,c.timeout_ms);
        ambi_color_render(&colors,&c,have?&latest:NULL,effective,mode.ambient,now,pixels);
        if(changed || effective!=previous) {
            printf("{\"elapsed_ms\":%llu,\"mode\":%d,\"accepted\":%u,\"rejected\":%u,\"pixels\":[",(unsigned long long)(now-start),effective,accepted,rejected);
            for(unsigned i=0;i<ambi_led_count(&c);i++)printf("%s[%u,%u,%u]",i?",":"",pixels[i].r,pixels[i].g,pixels[i].b);
            puts("]}");fflush(stdout);previous=effective;
        }
    }
    printf("{\"done\":true,\"accepted\":%u,\"rejected\":%u}\n",accepted,rejected);close(fd);return 0;
}

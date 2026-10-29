#include "receiver.h"
#include "esp_timer.h"
#include "lwip/sockets.h"
#include "freertos/task.h"
#include <string.h>
#include <unistd.h>
static ambi_config_t config;
static QueueHandle_t output;
static ambi_rx_stats_t stats;
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
static void increment(uint32_t *field) { portENTER_CRITICAL(&lock); (*field)++; portEXIT_CRITICAL(&lock); }
void ambi_receiver_stats(ambi_rx_stats_t *out) { portENTER_CRITICAL(&lock); *out=stats; portEXIT_CRITICAL(&lock); }
static void receive_task(void *unused) {
    (void)unused; ambi_stream_state_t stream={0};
    struct in_addr allowed; inet_pton(AF_INET,config.source_ip,&allowed);
    for(;;) {
        int fd=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP);
        struct sockaddr_in local={.sin_family=AF_INET,.sin_port=htons(config.udp_port),.sin_addr.s_addr=htonl(INADDR_ANY)};
        if(fd<0 || bind(fd,(struct sockaddr *)&local,sizeof(local))<0) {
            if(fd>=0) { close(fd); }
            increment(&stats.socket_errors); vTaskDelay(pdMS_TO_TICKS(1000)); continue;
        }
        /* A short queue plus age/sequence gate prevents a growing frame backlog. */
        int bytes=1024; setsockopt(fd,SOL_SOCKET,SO_RCVBUF,&bytes,sizeof(bytes));
        for(;;) {
            uint8_t packet[AMBI_MAX_PACKET+1]; struct sockaddr_in from; socklen_t len=sizeof(from);
            int n=recvfrom(fd,packet,sizeof(packet),0,(struct sockaddr *)&from,&len);
            if(n<0) { increment(&stats.socket_errors); break; }
            if(from.sin_addr.s_addr!=allowed.s_addr) { increment(&stats.unauthorized); continue; }
            ambi_received_t received;
            ambi_packet_result_t result=ambi_packet_decode(packet,n,ambi_hmac_verify,config.key,&received.frame);
            if(result!=AMBI_PACKET_OK) { increment(result==AMBI_PACKET_AUTH ? &stats.unauthorized : &stats.invalid); continue; }
            received.received_ms=esp_timer_get_time()/1000;
            if(ambi_stream_accept(&stream,&received.frame,received.received_ms,config.timeout_ms,config.max_age_ms,config.max_lag_ms)!=AMBI_ACCEPT) {
                increment(&stats.stale); continue;
            }
            xQueueOverwrite(output,&received); increment(&stats.accepted);
        }
        close(fd); vTaskDelay(pdMS_TO_TICKS(500));
    }
}
esp_err_t ambi_receiver_start(const ambi_config_t *c,QueueHandle_t queue) {
    struct in_addr address;
    if(!ambi_key_configured(c->key) || inet_pton(AF_INET,c->source_ip,&address)!=1 || !queue) return ESP_ERR_INVALID_ARG;
    config=*c; output=queue;
    return xTaskCreate(receive_task,"ambi_udp",6144,NULL,4,NULL)==pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}

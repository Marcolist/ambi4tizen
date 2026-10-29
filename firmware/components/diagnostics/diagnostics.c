#include "diagnostics.h"
#include "esp_http_server.h"
#include "cJSON.h"
#include <string.h>
#include <math.h>
static char token[65];
static QueueHandle_t commands;
static ambi_status_t current;
static portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
static const char *names[]={"OFF","AMBILIGHT","AMBIENT","AUTO"};
void ambi_diagnostics_publish(const ambi_status_t *s) { portENTER_CRITICAL(&lock); current=*s; portEXIT_CRITICAL(&lock); }
static bool authorized(httpd_req_t *req) {
    char header[80]; size_t n=httpd_req_get_hdr_value_len(req,"Authorization");
    if(strlen(token)<32 || n!=strlen(token)+7 || n>=sizeof(header) ||
        httpd_req_get_hdr_value_str(req,"Authorization",header,sizeof(header))!=ESP_OK || memcmp(header,"Bearer ",7)) return false;
    unsigned difference=0;
    for(unsigned i=0;i<strlen(token);i++) difference|=header[i+7]^token[i];
    return difference==0;
}
static esp_err_t reject(httpd_req_t *req,const char *status,const char *text) {
    httpd_resp_set_status(req,status); return httpd_resp_sendstr(req,text);
}
static esp_err_t status_get(httpd_req_t *req) {
    if(!authorized(req))return reject(req,"401 Unauthorized","authorization required");
    ambi_status_t s; portENTER_CRITICAL(&lock); s=current; portEXIT_CRITICAL(&lock);
    char json[700];
    snprintf(json,sizeof(json),"{\"requested\":\"%s\",\"effective\":\"%s\",\"wifi\":%s,\"led_ready\":%s,\"leds\":%u,\"estimated_ma\":%u,\"free_heap\":%u,\"min_heap\":%u,\"uptime_ms\":%llu,\"stream\":%s,\"last_error\":%d,\"rx\":{\"accepted\":%lu,\"invalid\":%lu,\"unauthorized\":%lu,\"stale\":%lu,\"socket_errors\":%lu}}",
        names[s.requested],names[s.effective],s.wifi?"true":"false",s.led_ready?"true":"false",s.leds,s.estimated_ma,
        s.free_heap,s.min_heap,(unsigned long long)s.uptime_ms,s.stream?"true":"false",s.last_error,
        (unsigned long)s.rx.accepted,(unsigned long)s.rx.invalid,(unsigned long)s.rx.unauthorized,(unsigned long)s.rx.stale,(unsigned long)s.rx.socket_errors);
    httpd_resp_set_type(req,"application/json"); return httpd_resp_sendstr(req,json);
}
static bool integer(cJSON *v,int max) { return cJSON_IsNumber(v) && isfinite(v->valuedouble) && v->valuedouble>=0 && v->valuedouble<=max && floor(v->valuedouble)==v->valuedouble; }
static esp_err_t command_post(httpd_req_t *req) {
    if(!authorized(req))return reject(req,"401 Unauthorized","authorization required");
    if(req->content_len<2 || req->content_len>512)return reject(req,"400 Bad Request","body size");
    char body[513]; int received=0;
    while(received<req->content_len) { int n=httpd_req_recv(req,body+received,req->content_len-received); if(n<=0)return ESP_FAIL; received+=n; }
    body[received]=0;
    const char *end=NULL; cJSON *root=cJSON_ParseWithOpts(body,&end,true);
    if(!cJSON_IsObject(root)) { cJSON_Delete(root); return reject(req,"400 Bad Request","JSON object required"); }
    ambi_command_t command={0}; bool valid=true; unsigned seen=0;
    for(cJSON *item=root->child;item;item=item->next) {
        if(!strcmp(item->string,"mode")) {
            if((seen&1) || !cJSON_IsString(item)) { valid=false; break; } seen|=1;
            bool found=false; for(unsigned i=0;i<4;i++) if(!strcmp(item->valuestring,names[i])) {command.mode=i;found=true;}
            if(!found) {valid=false;break;} command.set_mode=true;
        } else if(!strcmp(item->string,"brightness")) {
            if((seen&2) || !integer(item,255)) { valid=false;break; } seen|=2;
            command.set_brightness=true; command.brightness=item->valueint;
        } else if(!strcmp(item->string,"ambient")) {
            if((seen&4) || !cJSON_IsArray(item) || cJSON_GetArraySize(item)!=3) {valid=false;break;} seen|=4;
            int rgb[3]; for(unsigned i=0;i<3;i++) { cJSON *v=cJSON_GetArrayItem(item,i); if(!integer(v,255)){valid=false;break;} rgb[i]=v->valueint; }
            if(!valid) { break; }
            command.set_ambient=true; command.ambient=(ambi_rgb_t){rgb[0],rgb[1],rgb[2]};
        } else {valid=false;break;}
    }
    cJSON_Delete(root);
    if(!valid || !seen)return reject(req,"400 Bad Request","invalid command");
    if(xQueueSend(commands,&command,0)!=pdTRUE)return reject(req,"503 Service Unavailable","command queue full");
    return reject(req,"202 Accepted","queued; check status for persistence errors");
}
esp_err_t ambi_diagnostics_start(const ambi_config_t *c,QueueHandle_t queue) {
    if(strlen(c->api_token)<32)return ESP_ERR_INVALID_ARG;
    memcpy(token,c->api_token,sizeof(token)); commands=queue;
    httpd_config_t cfg=HTTPD_DEFAULT_CONFIG(); cfg.server_port=8080; cfg.stack_size=6144; cfg.recv_wait_timeout=2;
    httpd_handle_t server; esp_err_t err=httpd_start(&server,&cfg); if(err!=ESP_OK)return err;
    httpd_uri_t status={.uri="/status",.method=HTTP_GET,.handler=status_get};
    httpd_uri_t command={.uri="/command",.method=HTTP_POST,.handler=command_post};
    err=httpd_register_uri_handler(server,&status); if(err==ESP_OK)err=httpd_register_uri_handler(server,&command);
    if(err!=ESP_OK) { httpd_stop(server); }
    return err;
}

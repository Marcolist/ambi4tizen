#include "ambi_protocol.h"
#ifdef ESP_PLATFORM
#include "mbedtls/md.h"
#else
#include <openssl/hmac.h>
#endif
bool ambi_hmac_verify(const uint8_t *data, size_t size, const uint8_t *tag, void *key)
{
    uint8_t digest[32];
#ifdef ESP_PLATFORM
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (!info || mbedtls_md_hmac(info, key, 32, data, size, digest)) return false;
#else
    unsigned length = sizeof(digest);
    if (!HMAC(EVP_sha256(), key, 32, data, size, digest, &length) || length != 32) return false;
#endif
    uint8_t difference = 0;
    for (unsigned i = 0; i < AMBI_TAG_SIZE; i++) difference |= digest[i] ^ tag[i];
    return difference == 0;
}

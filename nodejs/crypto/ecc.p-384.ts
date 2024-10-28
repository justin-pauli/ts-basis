import { X509Certificate } from 'crypto'
import { ECCBase } from './ecc.base'

// openssl ecparam -name secp384r1 -genkey -noout -out private.key
const samplePrivateKeyContent = `\
-----BEGIN EC PRIVATE KEY-----
MIGkAgEBBDC6LPS+0u1bA8BFMKJSRZHpFtBsj1xRDu/xDVaR0e6aUrxXsLUsS6rs
0c4hGKYHRxegBwYFK4EEACKhZANiAASdvABejV4IF1UQ4N151B/hhDPgegqdoqUy
QmlpmPGSkbXossnt0mVcFhKkqn0fJEVdlfpSFQ9pR2x/T059QpyXR/CC/a7pfigZ
ixwGPM0hh2g0ne7HiHbu9yflmvNVho4=
-----END EC PRIVATE KEY-----`

// openssl ec -in private.key -pubout -out public.pem
const samplePublicKeyContent = `\
-----BEGIN PUBLIC KEY-----
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEnbwAXo1eCBdVEODdedQf4YQz4HoKnaKl
MkJpaZjxkpG16LLJ7dJlXBYSpKp9HyRFXZX6UhUPaUdsf09OfUKcl0fwgv2u6X4o
GYscBjzNIYdoNJ3ux4h27vcn5ZrzVYaO
-----END PUBLIC KEY-----`

// openssl req -new -key private.key -x509 -nodes -days 365 -out public_cert.pem \
//             -subj "/C=US/ST=CA/L=Palo Alto/O=Company/CN=www.example.com"
const samplePublicCertContent = `
-----BEGIN CERTIFICATE-----
MIICRTCCAcygAwIBAgIUKyIP24jP2zkDpp//F0BQm+8I4XswCgYIKoZIzj0EAwIw
WjELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRIwEAYDVQQHDAlQYWxvIEFsdG8x
EDAOBgNVBAoMB0NvbXBhbnkxGDAWBgNVBAMMD3d3dy5leGFtcGxlLmNvbTAeFw0y
NDA3MjIyMDQ4MzdaFw0yNTA3MjIyMDQ4MzdaMFoxCzAJBgNVBAYTAlVTMQswCQYD
VQQIDAJDQTESMBAGA1UEBwwJUGFsbyBBbHRvMRAwDgYDVQQKDAdDb21wYW55MRgw
FgYDVQQDDA93d3cuZXhhbXBsZS5jb20wdjAQBgcqhkjOPQIBBgUrgQQAIgNiAASd
vABejV4IF1UQ4N151B/hhDPgegqdoqUyQmlpmPGSkbXossnt0mVcFhKkqn0fJEVd
lfpSFQ9pR2x/T059QpyXR/CC/a7pfigZixwGPM0hh2g0ne7HiHbu9yflmvNVho6j
UzBRMB0GA1UdDgQWBBT0dlH/imNadWuvt54pbkfKkOEqITAfBgNVHSMEGDAWgBT0
dlH/imNadWuvt54pbkfKkOEqITAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMC
A2cAMGQCMDkhpl69U/NSOW51Dw8pFIFuY8oSPDzH5GgopDkf/tjDH9kNs4ttodji
IzxhVGQ9xgIwLQTn1XGJjvFCJB80yAI6k99ThnRbEda6ouui2+OymRlVAln8FqAm
oiKzn4UD1BOk
-----END CERTIFICATE-----`

const sampleData = {
    privateKey: samplePrivateKeyContent,
    publicKey: samplePublicKeyContent,
    publicCert: samplePublicCertContent,
    publicCertX509: new X509Certificate(samplePublicCertContent),
}

export class P384 extends ECCBase {
    static sample = sampleData

    constructor() {
        super()
        this.type = 'ECDSA'
        this.curveName = 'P-384'
        this.hash = 'SHA-512'
    }
}

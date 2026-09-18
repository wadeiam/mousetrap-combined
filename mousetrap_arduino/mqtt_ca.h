#pragma once
// MouseTrap private CA — root of trust for the MQTT broker (mtmon.wadehargrove.com:8883).
// The broker presents a server cert signed by this CA; the device pins it via
// WiFiClientSecure::setCACert(MQTT_CA_CERT) before connecting.
//
// Regenerated: 2026-07-04 (now includes keyUsage=keyCertSign,cRLSign — RFC 5280 compliant).
// CA valid until 2036-07-01. Source: MouseTrap/Server/mosquitto/certs/ca.crt
// NOTE: TLS cert validation requires the device clock to be set (NTP) — sync time
// before mqttSetup()/mqttConnect(), or the handshake fails with a date error.

static const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFWDCCA0CgAwIBAgIUDheSJGfS7mJkLjHGsZVcd89QQb8wDQYJKoZIhvcNAQEL
BQAwMjESMBAGA1UECgwJTW91c2VUcmFwMRwwGgYDVQQDDBNNb3VzZVRyYXAgRGV2
aWNlIENBMB4XDTI2MDcwNDIxMDgyMloXDTM2MDcwMTIxMDgyMlowMjESMBAGA1UE
CgwJTW91c2VUcmFwMRwwGgYDVQQDDBNNb3VzZVRyYXAgRGV2aWNlIENBMIICIjAN
BgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAp8fcOdyOizAkzln55AZyBO6HUmoJ
ZC0HCU9mAI8W99cJ3e+K2oo3HaUSq3+S8nIrQ0GuhYuUGiEkJKm5W3H4xf5/ZDXq
HdWPdsPzaK72ER4PpZ94/mX6lJa+MPvZHbfbxvY+4YHwNs8RdGv+V9uetfnjLz/T
JyM1FiAuC9sQ2feI5EOsT1FJfqrmbXpayBVib6ltQT4mmQxKJkanlaOzZQ/QnSqR
hRvmHbWJUksa0IaLvxRrskVAOzYvoMBi/51//CIu7eD1ra8OWus+fN1LIKM1uQBS
sMQr40FOvKYHZs0Y1XrdNY3owr2ZoNBKhc3Rc8AX+7C0VPscHEdQiS70ma1bdW8K
kyf0zDa+N6H/40KFfMrnCgjmUprrDE0ZyCYcjP2hKpJtWF7cpDyJoAOsNL5wEwIL
eNiULRSUjMUWpFFMo/tI4C2Odx5bFrjq9R3+tmXX5iZWG8mHqB6JJ3KlaRpu9FH3
hdKT/y9+Y1jaCpweMx+xxzZVJsACoTWgZHznqnh+onZ2Ge/kEPIc50TGoLeIy9xU
iaK29BtmqyIRTjFH2vjOlp/TwhghNA8cpTeTLFdhrJJwTZT/cM7BtFdmS1BBGWSV
J/Q6fg8MFkpiDHoCzt5ecXPhG8YbxbZO+DADUTRXKQKnu1i9VS+T0QpKiOYE0A90
P57ol0swN5PiDO0CAwEAAaNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8B
Af8EBAMCAQYwHQYDVR0OBBYEFN84te+LI3X6lt2j5QEAemTxnBvoMB8GA1UdIwQY
MBaAFN84te+LI3X6lt2j5QEAemTxnBvoMA0GCSqGSIb3DQEBCwUAA4ICAQBnyyOz
FM137QoFvP02OyVjksznCtuZ0Y+ec9VwaC2pRC4V1drSD9ovj+2GJOJIlGWBn2BH
RPNX4O/HhwBmb5ahHxRNjlGUD7qa5yFxw/XVzN6gOhOjlp9rz2Np4kj/F5W8H+M0
viqkaOYRpiw/meTtYpKS4Mn06VUPLWnYyfov3oq3bLf0vCA99vBpJuNSxVjUnYl4
OhHcSE3CQRB6rMxzYuO6PqiSJWOA+vBAb2YR7IIhI1nYzlFFKqxMPjtP6boQi5Nl
r+OZwvHBKL1ZhVDFWWrdb6yR93Z9xpHXuhp+aibYZqppsBjA0e4DuxDBU3VmzMlX
3J6Cs3B/u73uSszUo03dHHX4v34R37aboEdDkRfsE1pVN0FFHn6jT/FSgkwMFNEc
SfLaQDm3NolU+EH9rRLb16qDGjIUbHfP8SjbfmWj5am14tY0JQCmYfKjtWFBkoFU
eGstrmMAyqIWdpyspI3MXf3VZ2yvseU7r4N3ivg/XnCh8pk43BZ0Ykmw5aTzpl6P
3Rn2xO5PQB2ewaO4pd/M2e2b3/npOGn+v+EFwP94PE04UuF4p3bhrVxJBURQe5TM
TaM87leYa3USMPPU+S30KRlGvpg2vB1MJHNCmSY3cK9m5whjuwUoh8bL2e3bpXTd
3BxkH4Y8ivBU5Vw4TudWngJGbSRBOFe44dRKSA==
-----END CERTIFICATE-----
)EOF";

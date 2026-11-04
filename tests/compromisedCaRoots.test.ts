import { describe, expect, mock, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import {
  COMPROMISED_ROOT_FINGERPRINTS,
  removeCompromisedEmudhraRoots,
  type DefaultCaListFunctions,
} from "../lib/compromisedCaRoots";

// The two roots the module removes, as Debian's ca-certificates 20230311
// ships them (emSign_ECC_Root_CA_-_G3.crt and Comodo_AAA_Services_root.crt).
const EMSIGN_ECC_ROOT_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG
EwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNo
bm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0g
RzMwHhcNMTgwMjE4MTgzMDAwWhcNNDMwMjE4MTgzMDAwWjBrMQswCQYDVQQGEwJJ
TjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNobm9s
b2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0gRzMw
djAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3iAhKAnjlfSU2fySU0
WXTsuwYc58Byr+iuL+FBVIcUqEqy6HyC5ltqtdyzdc6LBtCGI79G1Y4PPwT01xyS
fvalY8L1X44uT6EYGQIrMgqCZH0Wk9GjQjBAMB0GA1UdDgQWBBR8XQKEE9TMipuB
zhccLikenEhjQjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggq
hkjOPQQDAwNpADBmAjEAvvNhzwIQHWSVB7gYboiFBS+DCBeQyh+KTOgNG3qxrdWB
CUfvO6wIBHxcmbHtRwfSAjEAnbpV/KlK6O3t5nYBQnvI+GDZjVGLVTv7jHvrZQnD
+JbNR6iC8hZVdyR+EhCVBCyj
-----END CERTIFICATE-----
`;

const AAA_CERTIFICATE_SERVICES_PEM = `-----BEGIN CERTIFICATE-----
MIIEMjCCAxqgAwIBAgIBATANBgkqhkiG9w0BAQUFADB7MQswCQYDVQQGEwJHQjEb
MBkGA1UECAwSR3JlYXRlciBNYW5jaGVzdGVyMRAwDgYDVQQHDAdTYWxmb3JkMRow
GAYDVQQKDBFDb21vZG8gQ0EgTGltaXRlZDEhMB8GA1UEAwwYQUFBIENlcnRpZmlj
YXRlIFNlcnZpY2VzMB4XDTA0MDEwMTAwMDAwMFoXDTI4MTIzMTIzNTk1OVowezEL
MAkGA1UEBhMCR0IxGzAZBgNVBAgMEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UE
BwwHU2FsZm9yZDEaMBgGA1UECgwRQ29tb2RvIENBIExpbWl0ZWQxITAfBgNVBAMM
GEFBQSBDZXJ0aWZpY2F0ZSBTZXJ2aWNlczCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBAL5AnfRu4ep2hxxNRUSOvkbIgwadwSr+GB+O5AL686tdUIoWMQua
BtDFcCLNSS1UY8y2bmhGC1Pqy0wkwLxyTurxFa70VJoSCsN6sjNg4tqJVfMiWPPe
3M/vg4aijJRPn2jymJBGhCfHdr/jzDUsi14HZGWCwEiwqJH5YZ92IFCokcdmtet4
YgNW8IoaE+oxox6gmf049vYnMlhvB/VruPsUK6+3qszWY19zjNoFmag4qMsXeDZR
rOme9Hg6jc8P2ULimAyrL58OAd7vn5lJ8S3frHRNG5i1R8XlKdH5kBjHYpy+g8cm
ez6KJcfA3Z3mNWgQIJ2P2N7Sw4ScDV7oL8kCAwEAAaOBwDCBvTAdBgNVHQ4EFgQU
oBEKIz6W8Qfs4q8p74Klf9AwpLQwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQF
MAMBAf8wewYDVR0fBHQwcjA4oDagNIYyaHR0cDovL2NybC5jb21vZG9jYS5jb20v
QUFBQ2VydGlmaWNhdGVTZXJ2aWNlcy5jcmwwNqA0oDKGMGh0dHA6Ly9jcmwuY29t
b2RvLm5ldC9BQUFDZXJ0aWZpY2F0ZVNlcnZpY2VzLmNybDANBgkqhkiG9w0BAQUF
AAOCAQEACFb8AvCb6P+k+tZ7xkSAzk/ExfYAWMymtrwUSWgEdujm7l3sAg9g1o1Q
GE8mTgHj5rCl7r+8dFRBv/38ErjHT1r0iWAFf2C3BUrz9vHCv8S5dIa2LX1rzNLz
Rt0vxuBqw8M0Ayx9lt1awg6nCpnBBYurDC/zXDrPbDdVCYfeU0BsWO/8tqtlbgT2
G9w84FoVxp7Z8VlIMCFlA2zs6SFz7JsDoeA3raAVGI/6ugLOpyypEBMs1OUIJqsi
l2D4kF501KKaU73yqWjgom7C12yxow+ev+to51byrvLjKzg6CYG1a4XXvi3tPxq3
smPi9WIsgtRqAEFQ8TmDn5XpNpaYbg==
-----END CERTIFICATE-----
`;

// An unrelated root the module must keep, as certifi 2026.10.23 ships it.
const ISRG_ROOT_X2_PEM = `-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
`;

type GetCaCertificates = NonNullable<
  DefaultCaListFunctions["getCACertificates"]
>;
type SetDefaultCaCertificates = NonNullable<
  DefaultCaListFunctions["setDefaultCACertificates"]
>;
type LogFunction = (...messages: unknown[]) => void;

// A stand-in for node:tls whose default CA list starts as `defaultCertificates`.
function createTlsStub(defaultCertificates: string[]) {
  return {
    getCACertificates: mock<GetCaCertificates>(() => [...defaultCertificates]),
    setDefaultCACertificates: mock<SetDefaultCaCertificates>(() => {}),
  };
}

function createLoggerStub() {
  return {
    info: mock<LogFunction>(() => {}),
    warn: mock<LogFunction>(() => {}),
    error: mock<LogFunction>(() => {}),
  };
}

describe("removeCompromisedEmudhraRoots", () => {
  test("the fingerprints are those of the two roots' PEMs", () => {
    expect(
      COMPROMISED_ROOT_FINGERPRINTS.get(
        new X509Certificate(EMSIGN_ECC_ROOT_G3_PEM).fingerprint256,
      ),
    ).toBe("emSign ECC Root CA - G3");
    expect(
      COMPROMISED_ROOT_FINGERPRINTS.get(
        new X509Certificate(AAA_CERTIFICATE_SERVICES_PEM).fingerprint256,
      ),
    ).toBe("AAA Certificate Services");
    expect(COMPROMISED_ROOT_FINGERPRINTS.size).toBe(2);
  });

  test("removes emSign ECC Root CA - G3 and keeps an unrelated root", () => {
    const tlsStub = createTlsStub([ISRG_ROOT_X2_PEM, EMSIGN_ECC_ROOT_G3_PEM]);
    const loggerStub = createLoggerStub();
    removeCompromisedEmudhraRoots({ tls: tlsStub, logger: loggerStub });

    expect(tlsStub.getCACertificates).toHaveBeenCalledWith("default");
    expect(tlsStub.setDefaultCACertificates).toHaveBeenCalledTimes(1);
    expect(tlsStub.setDefaultCACertificates.mock.calls[0][0]).toEqual([
      ISRG_ROOT_X2_PEM,
    ]);
    expect(loggerStub.info).toHaveBeenCalledTimes(1);
    const infoMessage = loggerStub.info.mock.calls[0][0];
    expect(infoMessage).toContain(
      "Removed 1 certificate(s) of the compromised roots (emSign ECC Root CA - G3)",
    );
    expect(infoMessage).toContain("(2 -> 1 certificates)");
    expect(infoMessage).toContain(`Node.js ${process.version}`);
    expect(loggerStub.warn).not.toHaveBeenCalled();
    expect(loggerStub.error).not.toHaveBeenCalled();
  });

  test("removes AAA Certificate Services, and every copy of a root listed more than once", () => {
    const tlsStub = createTlsStub([
      EMSIGN_ECC_ROOT_G3_PEM,
      AAA_CERTIFICATE_SERVICES_PEM,
      ISRG_ROOT_X2_PEM,
      EMSIGN_ECC_ROOT_G3_PEM,
    ]);
    const loggerStub = createLoggerStub();
    removeCompromisedEmudhraRoots({ tls: tlsStub, logger: loggerStub });

    expect(tlsStub.setDefaultCACertificates.mock.calls[0][0]).toEqual([
      ISRG_ROOT_X2_PEM,
    ]);
    expect(loggerStub.info.mock.calls[0][0]).toContain(
      "Removed 3 certificate(s) of the compromised roots (emSign ECC Root CA - G3, AAA Certificate Services)",
    );
  });

  test("a list without the roots is set unchanged and the message reports 0 removed", () => {
    const tlsStub = createTlsStub([ISRG_ROOT_X2_PEM]);
    const loggerStub = createLoggerStub();
    removeCompromisedEmudhraRoots({ tls: tlsStub, logger: loggerStub });

    expect(tlsStub.setDefaultCACertificates.mock.calls[0][0]).toEqual([
      ISRG_ROOT_X2_PEM,
    ]);
    const infoMessage = loggerStub.info.mock.calls[0][0];
    expect(infoMessage).toContain(
      "Removed 0 certificate(s) of the compromised roots from",
    );
    expect(infoMessage).toContain("(1 -> 1 certificates)");
  });

  const partialTlsStubs: [string, DefaultCaListFunctions][] = [
    [
      "tls.getCACertificates",
      {
        setDefaultCACertificates: mock<SetDefaultCaCertificates>(() => {}),
      },
    ],
    [
      "tls.setDefaultCACertificates",
      { getCACertificates: mock(() => [EMSIGN_ECC_ROOT_G3_PEM]) },
    ],
  ];
  test.each(partialTlsStubs)(
    "without %s it warns and changes nothing",
    (_missingFunctionName, partialTlsStub) => {
      const loggerStub = createLoggerStub();
      removeCompromisedEmudhraRoots({
        tls: partialTlsStub,
        logger: loggerStub,
      });

      for (const presentFunction of Object.values(partialTlsStub)) {
        expect(presentFunction).not.toHaveBeenCalled();
      }
      expect(loggerStub.warn).toHaveBeenCalledTimes(1);
      expect(loggerStub.warn.mock.calls[0][0]).toContain(
        `Node.js ${process.version} has no tls.getCACertificates`,
      );
      expect(loggerStub.info).not.toHaveBeenCalled();
      expect(loggerStub.error).not.toHaveBeenCalled();
    },
  );

  test("an error from tls.getCACertificates is logged with the error, not thrown", () => {
    const readError = new Error("cannot read the CA list");
    const tlsStub = createTlsStub([]);
    tlsStub.getCACertificates = mock<GetCaCertificates>(() => {
      throw readError;
    });
    const loggerStub = createLoggerStub();

    expect(() =>
      removeCompromisedEmudhraRoots({ tls: tlsStub, logger: loggerStub }),
    ).not.toThrow();
    expect(tlsStub.setDefaultCACertificates).not.toHaveBeenCalled();
    expect(loggerStub.error).toHaveBeenCalledTimes(1);
    const [errorMessage, loggedError] = loggerStub.error.mock.calls[0];
    expect(errorMessage).toContain(
      `Failed to remove the compromised roots from Node's default CA list on Node.js ${process.version}`,
    );
    expect(errorMessage).toContain("Routes keep serving.");
    expect(loggedError).toBe(readError);
    expect(loggerStub.info).not.toHaveBeenCalled();
  });

  test("an unparseable certificate or an error from tls.setDefaultCACertificates is logged, not thrown", () => {
    const unparseableTlsStub = createTlsStub([
      "-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n",
    ]);
    const unparseableLoggerStub = createLoggerStub();
    expect(() =>
      removeCompromisedEmudhraRoots({
        tls: unparseableTlsStub,
        logger: unparseableLoggerStub,
      }),
    ).not.toThrow();
    expect(unparseableTlsStub.setDefaultCACertificates).not.toHaveBeenCalled();
    expect(unparseableLoggerStub.error).toHaveBeenCalledTimes(1);
    expect(unparseableLoggerStub.error.mock.calls[0][1]).toBeInstanceOf(Error);

    const writeError = new TypeError("bad certificate list");
    const rejectingTlsStub = createTlsStub([EMSIGN_ECC_ROOT_G3_PEM]);
    rejectingTlsStub.setDefaultCACertificates = mock<SetDefaultCaCertificates>(
      () => {
        throw writeError;
      },
    );
    const rejectingLoggerStub = createLoggerStub();
    expect(() =>
      removeCompromisedEmudhraRoots({
        tls: rejectingTlsStub,
        logger: rejectingLoggerStub,
      }),
    ).not.toThrow();
    expect(rejectingLoggerStub.error.mock.calls[0][1]).toBe(writeError);
    expect(rejectingLoggerStub.info).not.toHaveBeenCalled();
  });
});

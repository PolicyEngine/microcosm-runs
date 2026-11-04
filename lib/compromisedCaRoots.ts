// Server only: called from instrumentation.ts when a server instance starts,
// before the route handlers call the collector's authorization endpoint and
// Vercel Blob over HTTPS.
//
// Temporary (issue #13). On 2026-10-20 it was disclosed that the private keys
// of eight eMudhra (emSign) intermediate CA certificates can be recovered
// (https://emudhra.we-have-a-problem.com). Six of them are TLS intermediates
// that chain to "emSign ECC Root CA - G3", and all eight are also cross-signed
// by Sectigo's "AAA Certificate Services". Vercel Functions ran Node.js
// 24.21.0 and 22.23.2 when last measured (2026-10-21), and another
// PolicyEngine project's preview function still ran 24.21.0 on 2026-10-26.
// The CA list compiled into both includes "emSign ECC Root CA - G3"; the one
// in Node.js 24.22.1 and 22.23.4 does not. This module removes both roots
// from Node's default CA list, which TLS connections opened after this call
// use (fetch and the undici copy that @vercel/blob uses included) unless they
// pass their own `ca` option.
//
// Delete this module, its test and instrumentation.ts once Vercel Functions
// run Node.js 24.22.1 / 22.23.4 or later. The info message below logs
// process.version each time a server instance starts, so the preview and
// production function logs show which version is running.
import { X509Certificate } from "node:crypto";
import nodeTls from "node:tls";

const LOG_PREFIX = "[compromisedCaRoots]";

// Root certificates to remove, keyed by SHA-256 fingerprint in the format of
// X509Certificate#fingerprint256. Each fingerprint matches the CCADB "All
// Certificate Records" report and the PEM in Debian's ca-certificates
// 20230311.
export const COMPROMISED_ROOT_FINGERPRINTS: ReadonlyMap<string, string> =
  new Map([
    // emSign ECC Root CA - G3 (eMudhra). Also matches the PEM in the CA list
    // compiled into Node.js 24.21.0 and 22.23.2.
    [
      "86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B",
      "emSign ECC Root CA - G3",
    ],
    // AAA Certificate Services (Sectigo, formerly Comodo). Removed as a
    // defensive measure: the CA list compiled into Node.js 24.21.0 and 22.23.2
    // does not contain it, because Mozilla trusts it for email only and
    // Node.js compiles in only the roots Mozilla trusts for websites. It
    // reaches Node's default CA list only through NODE_EXTRA_CA_CERTS, or
    // through --use-system-ca (or NODE_USE_SYSTEM_CA=1) on an operating system
    // whose CA store still contains it. This repository sets none of these.
    [
      "D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4",
      "AAA Certificate Services",
    ],
  ]);

// The two node:tls functions this module calls. Both are optional so that a
// runtime without them is reported instead of failing.
export type DefaultCaListFunctions = Partial<
  Pick<typeof nodeTls, "getCACertificates" | "setDefaultCACertificates">
>;
export type CaRootsLogger = Pick<Console, "info" | "warn" | "error">;

// `tls` and `logger` are parameters so the unit test can pass stubs.
//
// An error is logged, not rethrown. Next.js 16 rethrows an error from
// instrumentation's register() and keeps that failed result, so a throw here
// would make every function-served route fail. The filter changes only which
// roots the functions' outbound HTTPS requests trust, so keeping the routes
// available is preferred; the error message says the roots may still be
// trusted.
export function removeCompromisedEmudhraRoots({
  tls = nodeTls,
  logger = console,
}: { tls?: DefaultCaListFunctions; logger?: CaRootsLogger } = {}): void {
  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    logger.warn(
      `${LOG_PREFIX} Node.js ${process.version} has no tls.getCACertificates or ` +
        "tls.setDefaultCACertificates; the compromised roots were not removed from Node's " +
        "default CA list.",
    );
    return;
  }
  try {
    const defaultCertificates = tls.getCACertificates("default");
    // A root can appear more than once (an operating-system store added by
    // --use-system-ca may list it several times), so count certificates and
    // name each removed root once.
    const removedRootNames = new Set<string>();
    const keptCertificates = defaultCertificates.filter((pem) => {
      const rootName = COMPROMISED_ROOT_FINGERPRINTS.get(
        new X509Certificate(pem).fingerprint256,
      );
      if (rootName === undefined) {
        return true;
      }
      removedRootNames.add(rootName);
      return false;
    });
    tls.setDefaultCACertificates(keptCertificates);
    const removedCount = defaultCertificates.length - keptCertificates.length;
    const removedNamesText =
      removedCount > 0 ? ` (${[...removedRootNames].join(", ")})` : "";
    logger.info(
      `${LOG_PREFIX} Removed ${removedCount} certificate(s) of the compromised roots` +
        `${removedNamesText} from Node's default CA list (${defaultCertificates.length} -> ` +
        `${keptCertificates.length} certificates) on Node.js ${process.version}. Delete this ` +
        "module once Vercel Functions run Node.js 24.22.1 / 22.23.4 or later.",
    );
  } catch (error) {
    logger.error(
      `${LOG_PREFIX} Failed to remove the compromised roots from Node's default CA list on ` +
        `Node.js ${process.version}; the list may still trust them. Routes keep serving.`,
      error,
    );
  }
}

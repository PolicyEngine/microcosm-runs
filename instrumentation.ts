// Runs once per server instance, before it handles a request (Next.js
// instrumentation). The route handlers run in Node.js Vercel Functions and
// call the collector's authorization endpoint and Vercel Blob over HTTPS, so
// the compromised eMudhra CA roots are removed from Node's default CA list
// first (issue #13).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { removeCompromisedEmudhraRoots } =
      await import("./lib/compromisedCaRoots");
    removeCompromisedEmudhraRoots();
  }
}

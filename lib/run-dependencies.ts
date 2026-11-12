import { collectorReadConfig, createCollectorReader } from "./collector";
import { createIdentityTokenSource } from "./google-identity";
import { createLocalPublications, localPublicationsDirectory } from "./local";
import type { RunDependencies } from "./runs";
import { createService } from "./service";
import { blobStorage } from "./storage";

/** One token source per configuration, so an ID token is reused across requests. */
const identities = new Map<string, () => Promise<string>>();

/** What the run routes read from, as this deployment's settings choose. */
export function runDependencies(
  environment: Record<string, string | undefined> = process.env,
): RunDependencies {
  const local = localPublicationsDirectory(environment);
  const publications = createService(blobStorage, "");
  if (local)
    return {
      local: createLocalPublications(local),
      collector: null,
      publications,
    };
  const config = collectorReadConfig(environment);
  if (!config) return { local: null, collector: null, publications };
  const key = JSON.stringify(config);
  let idToken = identities.get(key);
  if (!idToken) {
    idToken = createIdentityTokenSource({
      provider: config.provider,
      serviceAccount: config.serviceAccount,
      audience: config.readUrl,
    });
    identities.set(key, idToken);
  }
  return {
    local: null,
    collector: createCollectorReader(config, { idToken }),
    publications,
  };
}

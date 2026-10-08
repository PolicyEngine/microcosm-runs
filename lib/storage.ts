import { get, put, issueSignedToken, presignUrl } from "@vercel/blob";
import { ApiError } from "@policyengine/microcosm-provider-orrery/contract";

export interface Storage {
  read(
    path: string,
    maximum: number,
  ): Promise<{ bytes: Uint8Array; url: string } | null>;
  sign(path: string, maximum: number): Promise<string>;
  create(path: string, bytes: Uint8Array): Promise<boolean>;
}
export const blobStorage: Storage = {
  async read(path, maximum) {
    const result = await get(path, { access: "public", useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200)
      throw new ApiError(503, "storage_unavailable");
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) throw new ApiError(400, "object_too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, url: result.blob.url };
  },
  async sign(path, maximum) {
    const token = await issueSignedToken({
      pathname: path,
      operations: ["put"],
      validUntil: Date.now() + 15 * 60 * 1000,
      maximumSizeInBytes: maximum,
      allowedContentTypes: ["application/json"],
    });
    return (
      await presignUrl(token, {
        operation: "put",
        pathname: path,
        access: "public",
        maximumSizeInBytes: maximum,
        allowedContentTypes: ["application/json"],
        allowOverwrite: false,
        addRandomSuffix: false,
      })
    ).presignedUrl;
  },
  async create(path, bytes) {
    try {
      await put(path, Buffer.from(bytes), {
        access: "public",
        contentType: "application/json",
        allowOverwrite: false,
        addRandomSuffix: false,
      });
      return true;
    } catch (error) {
      // Confirm an object really exists; do not mistake other failures for a conflict.
      if (await this.read(path, 256 * 1024)) return false;
      throw error;
    }
  },
};

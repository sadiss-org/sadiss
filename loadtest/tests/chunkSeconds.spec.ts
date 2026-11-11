import { describe, expect, it } from "vitest";
import { CHUNK_SECONDS as appChunkSeconds } from "@/composables/chunkTiming";
import { CHUNK_SECONDS as serverChunkSeconds } from "@server/types/ChunkEnvelope";

/**
 * The app cannot import the server's types, so it keeps its own copy of the
 * chunk length. The load test reads chunk numbers with the app's copy and
 * counts the chunks it expects with the server's, so the two must agree.
 */
describe("the chunk length", () => {
  it("is the same in the app as on the server", () => {
    expect(appChunkSeconds).toBe(serverChunkSeconds);
  });
});

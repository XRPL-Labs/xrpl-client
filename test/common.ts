import { XrplClient } from "../dist/src/index.js";

jest.setTimeout(30 * 1000);

let client: XrplClient;

describe("Common", () => {
  describe("Construct & Connect", () => {
    it("should connect, get a response, close again", async () => {
      let timeoutPromise: ReturnType<typeof setTimeout>;

      const response = await Promise.race([
        new Promise(async (resolve) => {
          client = new XrplClient();
          await client.ready();
          await client.close();
          clearTimeout(timeoutPromise);
          resolve(true);
        }),
        new Promise((resolve) => {
          timeoutPromise = setTimeout(() => {
            client.close();
            resolve(false);
          }, 10_000);
        }),
      ]);

      return expect(response).toEqual(true);
    });
  });
});

import { XrplClient } from "../dist/src/index.js";

jest.setTimeout(30 * 1000);

describe("Network specific", () => {
  describe("Handle network definitions", () => {
    const networkWithDefinitions = "wss://hooks-testnet-v3.xrpl-labs.com";
    const networkWithoutDefinitions = "wss://s2.ripple.com";

    it(
      "should work [ WITH ] definitions @ " + networkWithDefinitions,
      async () => {
        const client = new XrplClient(networkWithDefinitions);
        await client.ready();
        const definitions = await client.definitions();
        client.close();
        return expect(typeof definitions?.FIELDS).toEqual("object");
      }
    );

    it(
      "should work [ WITHOUT ] definitions @ " + networkWithoutDefinitions,
      async () => {
        const client = new XrplClient(networkWithoutDefinitions);
        await client.ready();
        const definitions = await client.definitions();
        client.close();
        return expect(definitions).toEqual(null);
      }
    );
  });
});

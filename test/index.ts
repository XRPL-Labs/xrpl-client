import { XrplClient } from "../dist/src/index.js";

let client: XrplClient

describe('Test', () => {
  describe('Construct & Connect', () => {
    it('should connect, get a response, close again', async () => {
      const response = await Promise.race([
        new Promise(async (resolve, reject) => {
          client = new XrplClient()
          await client.ready()
          await client.close()
          resolve(true)
        }),
        new Promise((resolve, reject) => {
          setTimeout(() => {
            client.close()
            resolve(false)
          }, 10_000)
        })
      ])

      return expect(response).toEqual(true);
    });
  });
});

import { AnyJson, PendingCall, XrplClient } from "../dist/src/index.js";
import addSubscription from "../dist/src/util.js";

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
          client.close();
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

describe("Util", () => {
  describe("Add Subscription", () => {
    it("should add a path find subscription", async () => {
      let subscriptions = addSubscription(
          [],
          createFakePendingCall(
            "path_finding_subscribe_1",
            {
              command: "path_find",
              subcommand: "create",
            },
          ),
      );
      return expect(subscriptions.length).toEqual(1);
    });
    it("should add a path find subscription, then add a new one without closing removing the former", async () => {
      let subs = addSubscription(
        [], 
        createFakePendingCall(
          "path_finding_subscribe_1",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      subs = addSubscription(
        subs,
        createFakePendingCall(
          "path_finding_subscribe_2",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      expect(subs.length).toEqual(1);
      return expect(subs[0].request.id._Request).toEqual("path_finding_subscribe_2");
    });
    it("should add a path find subscription, then close it, then add a new one, keeping just the new one", async () => {
      let subs = addSubscription(
        [],
        createFakePendingCall(
          "path_finding_subscribe_1",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      subs = addSubscription(
        subs,
        createFakePendingCall(
          "path_finding_subscribe_2",
          {
            command: "path_find",
            subcommand: "close",
          },
        ),
      );
      subs = addSubscription(
        subs,
        createFakePendingCall(
          "path_finding_subscribe_3",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      expect(subs.length).toEqual(1);
      return expect(subs[0].request.id._Request).toEqual("path_finding_subscribe_3");
    });
    it("should add a path find subscription, not add the path find status request and keep the former", async () => {
      let subs = addSubscription(
        [],
        createFakePendingCall(
          "path_finding_subscribe_1",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      subs = addSubscription(
        subs,
        createFakePendingCall(
          "path_finding_status_2",
          {
            command: "path_find",
            subcommand: "status",
          },
        ),
      );
      expect(subs.length).toEqual(1);
      return expect(subs[0].request.id._Request).toEqual("path_finding_subscribe_1");
    });
    it("should add a non path find subscription", async () => {
      let subs = addSubscription(
        [], 
        createFakePendingCall(
          "ledger_subscribe",
          {
            command: "subscribe",
            streams: ["ledger"],
          },
        ),
      );
      return expect(subs.length).toEqual(1);
    });
    it("should add a non path find subscription, then add a path find one, then a non path find", async () => {
      let subs = addSubscription(
        [], 
        createFakePendingCall(
          "account_subscribe",
          {
            command: "subscribe",
            streams: ["ledger"],
          },
        ),
      );
      subs = addSubscription(
        subs, 
        createFakePendingCall(
          "account_subscribe",
          {
            command: "path_find",
            subcommand: "create",
          },
        ),
      );
      subs = addSubscription(
        subs, 
        createFakePendingCall(
          "account_subscribe",
          {
            command: "subscribe",
            accounts: ["xxx"],
          },
        ),
      );
      return expect(subs.length).toEqual(3);
    });
  });

});

const createFakePendingCall = (id: string, request: AnyJson): PendingCall => {
  const base = Object.assign({}, basicFakePendingCall);
  const deepReq = {...base.request,...request};
  const body = Object.assign({}, base);
  body.request = deepReq;
  body.request.id._Request = id;
  return JSON.parse(JSON.stringify(body)); // deep copy
};

const basicFakePendingCall = {
  id: 4,
  request: {
    id: {
      _WsClient: 4,
      _Request: "",
    },
  },
  promise: {} as any,
  promiseCallables: {} as any,
  sendOptions: {},
};

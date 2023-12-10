# XRPL WebSocket Client [![npm version](https://badge.fury.io/js/xrpl-client.svg)](https://www.npmjs.com/xrpl-client) [![GitHub Actions NodeJS status](https://github.com/XRPL-Labs/xrpl-client/workflows/NodeJS/badge.svg?branch=main)](https://github.com/XRPL-Labs/xrpl-client/actions) 

## 🚨 WARNING! 🚨 If you are using `xrpl-client` in a serverless environment, make sure to `.close()` your connection at the end, to prevent your connection to linger on for a long time (causing massive load on public infrastructure, and massive serverless function invocation time bills from your cloud provider!)

### XRP Ledger WebSocket Client, npm: `xrpl-client`

Auto reconnecting, buffering, subscription remembering XRP Ledger WebSocket client. For in node & the browser.

This client implements a check for a working XRPL connection: the WebSocket being simply online isn't enough to satisfy the online / offline detection of this lib. After connecting, this lib. will issue a `server_info` command to the other connected node. Only if a valid response is retrieved the connection will be marked as online.

### Use in the browser

You can clone this repository and run:

- `npm run install` to install dependencies
- `npm run build` to build the source code
- `npm run browserify` to browserify this lib.

Now the `dist/browser.js` file will exist, for you to use in a browser.

You can get a [prebuilt](https://cdn.jsdelivr.net/npm/xrpl-client/dist/browser.js) / [prebuilt & minified](https://cdn.jsdelivr.net/npm/xrpl-client/dist/browser.min.js) version from Github / CDNJS [![CDNJS Browserified](https://img.shields.io/badge/cdnjs-browserified-blue)](https://cdn.jsdelivr.net/npm/xrpl-client/dist/browser.js) [![CDNJS Browserified Minified](https://img.shields.io/badge/cdnjs-minified-orange)](https://cdn.jsdelivr.net/npm/xrpl-client/dist/browser.min.js)

Sample: [https://jsfiddle.net/WietseWind/p4cd37hf](https://jsfiddle.net/WietseWind/p4cd37hf/)

### A note on connectivity vs. signing

Please note: this lib only provides connectivity to XRPL nodes. To sign transactions, please take a look at `xrpl-accountlib`. Here's an example on how these two libs can work together:
https://gist.github.com/WietseWind/557a5c11fa0d474468e8c9c54e3e5b93

#### Constructor & options

A client connection can be constructed with the exported `XrplClient` class:

```typescript
import { XrplClient } from "xrpl-client";
const client = new XrplClient();
//             ^^ No arguments: defaults to one endpoint:
//     ['wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com']
//             with `maxConnectionAttempts` option `null` (= try forever)
```

If no argument is provided, the default endpoint this lib. will connect to is [`wss://xrplcluster.com`](https://xrplcluster.com), wss://xrpl.link (fallback) and finally wss://s2.ripple.com. Alternatively, two arguments can be provided:

###### Arguments

1. (string | array) The WebSocket endpoint to connect to (e.g. your own node) as a `string`, or an array (`string[]`) with multiple endpoints used in specified order. Empty string or array if you want to use the default nodes, but specify custom options using the second param.:
2. (object) Global options (type: WsClientOptions)

###### Options

Available options are:

- `assumeOfflineAfterSeconds`, `Number` » default **15**, this setting will check if the XRPL node on the other end of the connection is alive and sending regular `server_info` responses (this lib. queries for them). After the timeout, the lib. will disconnect from the node and try to reconnect.
- `maxConnectionAttempts`, `Number` | `null` » default **null** in case of one endpoint, or **3** if an array with endpoints is provided, if (when initially connecting or reconnecting) no (new) connection could be setup in this attempts (see: `connectAttemptTimeoutSeconds` per call) consider the connection dead. Cancel all connect/reconnect attempts, clear the command buffer. An error will be thrown.
- `connectAttemptTimeoutSeconds`, `Number` » default **3**, this setting is the max. delay between reconnect attempts, if no connection could be setup to the XRPL node. A backoff starting at one second, growing with 20% per attempt until this value is reached will be used.
- `feeDropsDefault`, `Number` » default **12**, The min. amount of node reported transaction fee (in drops) respected for the `getState()` reported last/avg fee amount.
- `feeDropsMax`, `Number` » default **3600**, The max. amount of node reported transaction fee (in drops) respected for the `getState()` reported last/avg fee amount.
- `tryAllNodes`, `Boolean` » default **false**, If connection attempts will be made to all nodes at the same time, connecting the client to the first to respond.

Sample with a custom node & option:

```typescript
import { XrplClient } from "xrpl-client";
const client = new XrplClient(
  ["ws://localhost:1337", "wss://xrplcluster.com"],
  {
    assumeOfflineAfterSeconds: 15,
    maxConnectionAttempts: 4,
    connectAttemptTimeoutSeconds: 4,
  }
);
```

#### Methods:

- `send({ command: "..."}, {SendOptions})` » `Promise<AnyJson | CallResponse>` » Send a `command` to the connected XRPL node.
- `ready()` » `Promise<self>` » fires when you're fully connected. While the `state` event (and `getState()` method) only return the WebSocket online state, `ready()` will only return (async) if the first ledger data has been received and the last ledger index is known.
- `getState()` » `ConnectionState` » Get the connection, connectivity & server state (e.g. fees, reserves).
- close() » `void` » Close the connection, but allow the object to be used again (using `reinstate()`).
- reinstate(options?: {forceNextUplink: boolean}) » `void` » Reconnect the object when in closed state (after calling `close()`). By passing `forceNextUplink: true` (default false) the connection will be reinstated to the next uplink instead of starting again from the first provided uplink (constructor). If the Client class was constructed with the `tryAllNodes: true` option, there is no "next uplink", as all will be tried. In which case the `forceNextUplink: true` option will be ignored.
- destroy() » `void` » Fully close the entire object (can't be used again).

#### Send options

The `send({ command: "..." })` method allows you to set these options (second argument, object):

- `timeoutSeconds`, `Number` » The returned Promise will be rejected if a response hasn't been received within this amount of seconds. This timeout starts when the command is issued by your code, no matter the connection state (online or offline, possibly waiting for a connecftion)
- `timeoutStartsWhenOnline`, `Number` » The timeout (see `timeoutSeconds`) will start when the connection has been marked online (WebSocket connected, `server_info` received from the XRPL node), so when your command has been issued by this lib. to the XRPL node on the other end of the connection.
- `sendIfNotReady`, `Boolean` » Your commands will be sent to the XRPL node on the other end of the connection only when the connection has been marked online (WebSocket connected, `server_info` received from the XRPL node). Adding this option (`true`) will send your commands _after_ the WebSocket has been connected, but possibly _before_ a valid `server_info` response has been received by the XRPL node connected to.
- `noReplayAfterReconnect`, `Boolean` » When adding a subscription (resulting in async. updates) like a `subscribe` or `path_find` command, when reconnected your subscription commands will automaticaly replay to the newly connected node. Providing a `false` to this option will prevent your commands from being replayed when reconnected.

#### Events emitted:

- `state` (the state of the connection changed from online to offline or vice versa)
- `message` (all messages, even if duplicate of the ones below)
- `ledger` (a ledger closed)
- `path` (async `path_find` response)
- `transaction`
- `validation`
- `retry` (new connection attempt)
- `close` (upstream closed the connection)
- `reconnect` (reconnecting, after connected: `state`)

#### Connection flow events:

- `retry` - Same node, new connection attempt (attempt timed out)
- `nodeswitch` » string (node) - Switched to a new node
- `online` » Now conneted to an XRPL node, use `.getState()` for more info
- `offline` » Was online, but the connection is gone
- `round` » Tried all nodes, retry the first one

Let's say you have two dead endpoints and a third one that works, then your connection is lost and you switch to the fourth one. The event sequence would look like this:

```
1. retry » 2. retry » 3. retry » 4. nodeswitch
5. retry » 6. retry » 7. retry » 8. nodeswitch
9. online
10. offline
11. retry » 12. retry » 13. retry » 14. nodeswitch
15. online
```

### Syntax

```typescript
import { XrplClient } from "xrpl-client";
const client = new XrplClient("wss://xrplcluster.com");

// await client.ready();

const serverInfo = await client.send({ command: "server_info" });
console.log({ serverInfo });

client.on("ledger", (ledger) => {
  console.log("Ledger", ledger);
});
```

### Migrating from `rippled-ws-client`

1. The constructor doesn't return a promise with the connection: the constructed object passes on your messages. So if you need to wait for a live connection: use `await TheObject.ready()` and then refer to `TheObject`:

```javascript
// Old:
//    new RippledWsClient('wss://testnet.xrpl-labs.com').then(Connection => { ... })
// New:
const Connection = new RippledWsClient('wss://testnet.xrpl-labs.com')
Connection.ready().then(() => {
```

3. When used in combination with `rippled-ws-client-sign` ([please use `xrpl-accountlib` instead!](https://www.npmjs.com/package/xrpl-accountlib)) you need to wrap the class:

```javascript
class RippledWsClient extends XrplClient {} // Then use RippledWsClient
```

### Using with a proxy

You can configure your own proxy-enabled http.Agent and pass it as option:

```
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = new HttpsProxyAgent({
  host: "proxy.corporate.lan",
  port: 3128,
});

const client = new XrplClient("wss://xrplcluster.com", {
  httpRequestOptions: { agent },
});
```

### Development & Debugging

To see all debugging info, run the compiled version with the `DEBUG` env. var:

```bash
tsc
DEBUG=xrplclient* node someFile.js
```

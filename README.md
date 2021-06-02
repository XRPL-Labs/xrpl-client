# XRPL WebSocket Client [![npm version](https://badge.fury.io/js/xrpl-client.svg)](https://www.npmjs.com/xrpl-client) [![GitHub Actions NodeJS status](https://github.com/XRPL-Labs/xrpl-client/workflows/NodeJS/badge.svg?branch=main)](https://github.com/XRPL-Labs/xrpl-client/actions) [![CDNJS Browserified](https://img.shields.io/badge/cdnjs-browserified-blue)](https://cdn.jsdelivr.net/gh/XRPL-Labs/xrpl-client@main/dist/browser.js) [![CDNJS Browserified Minified](https://img.shields.io/badge/cdnjs-minified-orange)](https://cdn.jsdelivr.net/gh/XRPL-Labs/xrpl-client@main/dist/browser.min.js)

### XRP Ledger WebSocket Client, npm: `xrpl-client`

Auto reconnecting, buffering, subscription remembering XRP Ledger WebSocket client. For in node & the browser.

#### Methods:

- `send({ command: "..."})` » `Promise<CallResponse | AnyJson>` » Send a `comand` to the connected XRPL node.
- `ready()` » `Promise<self>` » fires when you're fully connected. While the `state` event (and `getState()` method) only return the WebSocket online state, `ready()` will only return (async) if the first ledger data has been received and the last ledger index is known.
- `getState()` » `ConnectionState` » Get the connection, connectivity & server state (e.g. fees, reserves).
- close() » `void` » Fully close the entire object (can't be used again).

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

### Syntax

```javascript
import { XrplClient } from "xrpl-client";
const client = new XrplClient("wss://xrplcluster.com");

// await client.ready();

const serverInfo = await client.send({ command: "server_info" });
console.log({ serverInfo });

client.on("ledger", (ledger) => {
  console.log("Ledger", ledger);
});
```

### Use in the browser

You can clone this repository and run:

- `npm run install` to install dependencies
- `npm run build` to build the source code
- `npm run browserify` to browserify this lib.

Now the `dist/browser.js` file will exist, for you to use in a browser.

Alternatively you can get a [prebuilt](https://cdn.jsdelivr.net/gh/XRPL-Labs/xrpl-client@main/dist/browser.js) / [prebuilt & minified](https://cdn.jsdelivr.net/gh/XRPL-Labs/xrpl-client@main/dist/browser.min.js) version from Github.

Sample: [https://jsfiddle.net/WietseWind/p4cd37hf](https://jsfiddle.net/WietseWind/p4cd37hf/)

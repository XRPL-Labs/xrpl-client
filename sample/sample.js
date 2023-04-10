"use strict";
exports.__esModule = true;
var index_js_1 = require("../dist/src/index.js");
var client = new index_js_1.XrplClient('wss://s1.ripple.com');
client.on('ledger', function () {
    console.log(client.getState());
});

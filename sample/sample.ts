import { XrplClient } from '../dist/src/index.js'

const client = new XrplClient('wss://s1.ripple.com')

client.on('ledger', () => {
    console.log(client.getState())
})

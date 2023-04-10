import { XrplClient } from '../dist/src/index.js'

const client = new XrplClient('wss://s1.ripple.com')
console.log('Connecting')
client.on('ledger', () => {
    console.log(client.getState())
})

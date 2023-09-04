import { XrplClient } from '../dist/src/index.js'

const client = new XrplClient('wss://s1.ripple.com')
console.log('Connecting')

const promise = client.send({
  id: '123',
  command: 'fee'
}).then(r => {
  console.log(r, r.id)
})

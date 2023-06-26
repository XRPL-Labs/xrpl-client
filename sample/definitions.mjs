import { XrplClient } from '../dist/src/index.js'

const clientWithDefinitions = new XrplClient('wss://hooks-testnet-v3.xrpl-labs.com')
const clientWithoutDefinitions = new XrplClient('wss://s2.ripple.com')

clientWithDefinitions.ready().then(async () => {
  console.log('Client with definitions ready (hooks-testnet-v3.xrpl-labs.com)')
  const definitions = await clientWithDefinitions.definitions()
  console.log('Client with definitions (hooks-testnet-v3.xrpl-labs.com)', { definitions })
})

clientWithoutDefinitions.ready().then(async () => {
  console.log('Client without definitions ready (s2.ripple.com)')
  const definitions = await clientWithoutDefinitions.definitions()
  console.log('Client without definitions (s2.ripple.com)', { definitions })
})

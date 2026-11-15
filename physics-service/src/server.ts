import { createApp } from './app'
import { PORT } from './config'

createApp().listen(PORT, () => {
  console.info(`physics-service listening on :${PORT}`)
})

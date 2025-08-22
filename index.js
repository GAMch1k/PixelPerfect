const express = require('express')
const app = express()
const port = 1873

app.use(express.static("."))

app.listen(port, () => {
  console.log(`app listening on port ${port}`)
})

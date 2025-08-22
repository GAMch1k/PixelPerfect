const express = require('express')
const app = express()
const port = 1873

app.use(express.static("."))

app.all('/', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

app.listen(port, () => {
  console.log(`app listening on port ${port}`)
})

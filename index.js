const express = require('express')
const fs = require('fs')
const path = require('path')
const app = express()
const port = 1873

app.use(express.static("."))
app.use(express.json())

const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json')

// Initialize leaderboard file if it doesn't exist
if (!fs.existsSync(LEADERBOARD_FILE)) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify([]))
}

app.all('/', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  try {
    const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8')
    const leaderboard = JSON.parse(data)
    res.json(leaderboard)
  } catch (error) {
    console.error('Error reading leaderboard:', error)
    res.json([])
  }
})

// Add score to leaderboard
app.post('/api/leaderboard', (req, res) => {
  try {
    const { name, score, time } = req.body
    
    if (!name || typeof score !== 'number' || typeof time !== 'number') {
      return res.status(400).json({ error: 'Invalid data' })
    }
    
    const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8')
    const leaderboard = JSON.parse(data)
    
    const leaderboardScore = Math.round(score * 1000 - time * 10)
    
    const entry = {
      name: name.trim().substring(0, 20), // Limit name length
      score: score,
      time: time,
      leaderboardScore: leaderboardScore,
      date: new Date().toLocaleDateString()
    }
    
    leaderboard.push(entry)
    leaderboard.sort((a, b) => b.leaderboardScore - a.leaderboardScore)
    
    // Keep only top 10
    if (leaderboard.length > 10) {
      leaderboard.splice(10)
    }
    
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2))
    res.json({ success: true, leaderboard })
  } catch (error) {
    console.error('Error saving leaderboard:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

app.listen(port, () => {
  console.log(`app listening on port ${port}`)
})

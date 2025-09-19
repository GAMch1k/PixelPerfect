const express = require('express')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { Server } = require('socket.io')
const app = express()
const server = http.createServer(app)
const io = new Server(server)
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

// Game rooms storage
const gameRooms = {
  'normal': new Map(),
  'rush': new Map()
}

let roomCounter = 1

function generateTargetRect() {
  const canvasWidth = 796 // Account for canvas size
  const canvasHeight = 496
  const maxWidth = canvasWidth * 0.4
  const maxHeight = canvasHeight * 0.4
  
  const width = Math.floor(Math.random() * (maxWidth - 50)) + 50
  const height = Math.floor(Math.random() * (maxHeight - 30)) + 30
  const x = Math.floor(Math.random() * (canvasWidth - width))
  const y = Math.floor(Math.random() * (canvasHeight - height))

  return { x, y, width, height }
}

function createRoom(mode) {
  const roomId = `${mode}-room-${roomCounter++}`
  const room = {
    id: roomId,
    mode: mode,
    players: new Map(),
    targetRect: generateTargetRect(),
    startRect: generateTargetRect(),
    status: 'waiting',
    startTime: null,
    endTime: null,
    maxPlayers: mode === 'normal' ? 4 : 8
  }
  
  gameRooms[mode].set(roomId, room)
  return room
}

function findAvailableRoom(mode) {
  for (const [roomId, room] of gameRooms[mode]) {
    if (room.status === 'waiting' && room.players.size < room.maxPlayers) {
      return room
    }
  }
  return createRoom(mode)
}

function calculateScore(userRect, targetRect) {
  const xDiff = Math.abs(userRect.x - targetRect.x)
  const yDiff = Math.abs(userRect.y - targetRect.y)
  const widthDiff = Math.abs(userRect.width - targetRect.width)
  const heightDiff = Math.abs(userRect.height - targetRect.height)

  const totalDiff = xDiff + yDiff + widthDiff + heightDiff
  const maxPossibleDiff = 796 + 496 // Canvas dimensions
  
  let score = Math.max(0, 100 - (totalDiff / maxPossibleDiff) * 100)
  
  if (totalDiff === 0) {
    score = 100
  }

  return Math.round(score * 100) / 100
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id)
  
  socket.on('joinGame', (data) => {
    const { mode, playerName } = data
    
    if (!gameRooms[mode]) {
      socket.emit('error', { message: 'Invalid game mode' })
      return
    }
    
    const room = findAvailableRoom(mode)
    
    // Add player to room
    const player = {
      id: socket.id,
      name: playerName || `Player${room.players.size + 1}`,
      submissions: [],
      bestScore: 0,
      attemptCount: 0,
      hasSubmitted: false,
      joinTime: Date.now()
    }
    
    room.players.set(socket.id, player)
    socket.join(room.id)
    socket.currentRoom = room.id
    socket.currentMode = mode
    
    // Send room info to player
    socket.emit('roomJoined', {
      roomId: room.id,
      mode: room.mode,
      targetRect: room.targetRect,
      startRect: room.startRect,
      players: Array.from(room.players.values()),
      status: room.status
    })
    
    // Notify other players
    socket.to(room.id).emit('playerJoined', player)
    
    // Start game if conditions are met
    if (mode === 'normal' && room.players.size >= 2 && room.status === 'waiting') {
      // Start normal mode game
      room.status = 'playing'
      room.startTime = Date.now()
      io.to(room.id).emit('gameStarted', {
        targetRect: room.targetRect,
        startRect: room.startRect,
        mode: 'normal'
      })
    } else if (mode === 'rush') {
      if (room.status === 'waiting' && room.players.size >= 2) {
        // Start rush mode game
        room.status = 'playing'
        room.startTime = Date.now()
        room.endTime = room.startTime + 60000 // 60 seconds
        io.to(room.id).emit('gameStarted', {
          targetRect: room.targetRect,
          startRect: room.startRect,
          mode: 'rush',
          timeLeft: 60000
        })
        
        // Set timer to end game
        setTimeout(() => {
          endRushGame(room)
        }, 60000)
      } else if (room.status === 'playing') {
        // Join ongoing rush game
        const timeLeft = room.endTime - Date.now()
        if (timeLeft > 0) {
          socket.emit('gameStarted', {
            targetRect: room.targetRect,
            startRect: room.startRect,
            mode: 'rush',
            timeLeft: timeLeft
          })
        }
      }
    }
  })
  
  socket.on('submitAlignment', (data) => {
    const { x, y, width, height, submissionTime } = data
    
    if (!socket.currentRoom) return
    
    const mode = socket.currentMode
    const room = gameRooms[mode].get(socket.currentRoom)
    if (!room || room.status !== 'playing') return
    
    const player = room.players.get(socket.id)
    if (!player) return
    
    // Check if player can submit
    if (mode === 'normal' && player.hasSubmitted) return
    if (mode === 'rush' && Date.now() > room.endTime) return
    
    const userRect = { x, y, width, height }
    const score = calculateScore(userRect, room.targetRect)
    
    const submission = {
      rect: userRect,
      score: score,
      time: submissionTime,
      timestamp: Date.now()
    }
    
    player.submissions.push(submission)
    player.attemptCount++
    
    if (score > player.bestScore) {
      player.bestScore = score
    }
    
    if (mode === 'normal') {
      player.hasSubmitted = true
      
      // Check if all players have submitted
      const allSubmitted = Array.from(room.players.values()).every(p => p.hasSubmitted)
      if (allSubmitted) {
        endNormalGame(room)
      }
    }
    
    // Broadcast submission to all players in room
    io.to(room.id).emit('playerSubmission', {
      playerId: socket.id,
      playerName: player.name,
      score: score,
      attemptCount: player.attemptCount,
      bestScore: player.bestScore
    })
  })
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
    
    if (socket.currentRoom) {
      const mode = socket.currentMode
      const room = gameRooms[mode].get(socket.currentRoom)
      if (room) {
        room.players.delete(socket.id)
        socket.to(room.id).emit('playerLeft', { playerId: socket.id })
        
        // Clean up empty rooms
        if (room.players.size === 0) {
          gameRooms[mode].delete(room.id)
        }
      }
    }
  })
})

function endNormalGame(room) {
  room.status = 'finished'
  
  // Calculate winners
  const players = Array.from(room.players.values())
  const results = players.map(player => {
    const bestSubmission = player.submissions.reduce((best, current) => 
      current.score > best.score || (current.score === best.score && current.time < best.time) ? current : best
    )
    return {
      playerId: player.id,
      name: player.name,
      score: bestSubmission.score,
      time: bestSubmission.time
    }
  }).sort((a, b) => b.score - a.score || a.time - b.time)
  
  io.to(room.id).emit('gameEnded', {
    mode: 'normal',
    results: results
  })
  
  // Clean up room after 30 seconds
  setTimeout(() => {
    gameRooms.normal.delete(room.id)
  }, 30000)
}

function endRushGame(room) {
  room.status = 'finished'
  
  // Calculate winners based on best score and attempt count
  const players = Array.from(room.players.values())
  const results = players.map(player => ({
    playerId: player.id,
    name: player.name,
    bestScore: player.bestScore,
    attemptCount: player.attemptCount
  })).sort((a, b) => b.bestScore - a.bestScore || a.attemptCount - b.attemptCount)
  
  io.to(room.id).emit('gameEnded', {
    mode: 'rush',
    results: results
  })
  
  // Clean up room after 30 seconds
  setTimeout(() => {
    gameRooms.rush.delete(room.id)
  }, 30000)
}

server.listen(port, () => {
  console.log(`app listening on port ${port}`)
})

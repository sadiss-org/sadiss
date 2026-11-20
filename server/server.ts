// Code in part taken from https://www.pubnub.com/blog/nodejs-websocket-programming-examples/
import express from 'express'
import { TrackDocument } from './types'
import * as dotenv from 'dotenv'
import { passport } from './auth'
import { Server } from 'http'
import { connectDB } from './database'
import { startWebSocketServer } from './services/webSocketService'
import fs from 'fs'
import { logger } from './tools'
import { errorHandler } from './middlewares/errorHandler'
import { readAndParseChunkFile } from './services/fileService'
import { ProcessingError } from './errors'
import { Track } from './models'
import { SadissWebSocketServer } from './lib/SadissWebsocket'
import router from './routes/routes'

const cors = require('cors')
const session = require('express-session')
const cookieParser = require('cookie-parser')

// Connect to database
if (process.env.NODE_ENV !== 'test') {
  // Load .env
  dotenv.config()
  connectDB()
} else {
  // Load .env.test
  dotenv.config({ path: '.env.test' })
}

if (!fs.existsSync(process.env.CHUNKS_DIR!)) {
  fs.mkdirSync(process.env.CHUNKS_DIR!)
  console.log('Directory created: ', process.env.CHUNKS_DIR)
}

let whitelist = ['https://sadiss.net', 'https://fallback.sadiss.net']

if (process.env.NODE_ENV === 'development') {
  whitelist = whitelist.concat([
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://localhost:8081',
    'http://localhost:8080'
  ])
}

const corsOptions = {
  origin: (origin: string, callback: Function) => {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS.'))
    }
  },
  credentials: true
}

const app = express()
  .use(express.json())
  .use(cors(corsOptions))
  .use(express.urlencoded({ extended: false }))
  .use(cookieParser())
  // Initialize express-session middleware
  .use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false
    })
  )
  // Initialize Passport and restore authentication state, if any, from the session.
  .use(passport.initialize())
  .use(passport.session())

let server: Server
let wss: SadissWebSocketServer
if (process.env.NODE_ENV === 'test') {
  wss = startWebSocketServer()
  server = app.listen()
} else {
  wss = startWebSocketServer(+process.env.WS_SERVER_PORT!)
  logger.info(`Websocket server listening on port ${process.env.WS_SERVER_PORT}.`)

  server = app.listen(process.env.BASE_PORT, () => logger.info(`Http server listening on port ${process.env.BASE_PORT}.`))
}

// Inject wss into request
app.use((req, res, next) => {
  req.wss = wss
  next()
})
app.use('/', router).use(errorHandler)
app.use((req, res) => res.status(404))

// IIFE to make sure all tracks have set trackLengthInChunks
;(async () => {
  // Get all tracks and make sure trackLength is set
  const tracks = await Track.find({ trackLengthInChunks: { $exists: false } })
  for (const track of tracks) {
    await setTrackLength(track)
  }
})()

export { app, server, wss }

async function setTrackLength(track: TrackDocument) {
  let trackLengthInChunks = track.trackLengthInChunks

  if (!trackLengthInChunks) {
    const chunks = await readAndParseChunkFile(track)
    if (!chunks) {
      throw new ProcessingError('Error loading track')
    }

    trackLengthInChunks = chunks.length
    await Track.findByIdAndUpdate(track._id, { trackLengthInChunks })
  }

  return trackLengthInChunks
}

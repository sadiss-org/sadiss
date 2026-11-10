import * as dotenv from 'dotenv'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { logger } from './tools'

// Use an ephemeral in-memory MongoDB for tests, and optionally for local dev
// (USE_IN_MEMORY_DB=true) so the server can run with no external database.
const useInMemoryDb = process.env.NODE_ENV === 'test' || process.env.USE_IN_MEMORY_DB === 'true'

let mongoURI = process.env.MONGO_URL || ''
const mongoUser = process.env.MONGO_USER
if (!mongoURI && !useInMemoryDb) {
  if (process.env.NODE_ENV === 'production') {
    const mongoHost = process.env.MONGO_HOST
    const mongoPW = process.env.MONGO_PW
    const mongoDbName = process.env.MONGO_DB_NAME
    mongoURI = `mongodb://${mongoUser}:${mongoPW}@${mongoHost}/${mongoDbName}?directConnection=true&serverSelectionTimeoutMS=2000`
  } else {
    const devMongoHost = process.env.DEV_MONGO_HOST
    const devMongoPW = process.env.DEV_MONGO_PW
    mongoURI = `mongodb+srv://${mongoUser}:${devMongoPW}@${devMongoHost}/test`
  }
}

let mongod: MongoMemoryServer

/** Connects to `uri` when given, and otherwise to the database the environment names. */
const connectDB = async (uri?: string) => {
  if (mongoose.connection.readyState !== 1) {
    try {
      if (uri) {
        mongoURI = uri
      } else if (useInMemoryDb) {
        mongod = await MongoMemoryServer.create()
        mongoURI = mongod.getUri()
      }
      mongoose.set('strictQuery', true)
      await mongoose.connect(mongoURI)
    } catch (err) {
      console.error(err)
      process.exit(1)
    }
  }
}

const disconnectDB = async () => {
  try {
    await mongoose.connection.close()
    if (mongod) {
      await mongod.stop()
    }
  } catch (err) {
    logger.error(err)
    process.exit(1)
  }
}

export { connectDB, disconnectDB }

import { MongoMemoryServer } from 'mongodb-memory-server'
import type { TestProject } from 'vitest/node'

/**
 * One in-memory MongoDB for the whole run. Each test file connects to a
 * database of its own on it (tests/setupTests.ts). A server per file had each
 * one look for a free port at the same time, and two could pick the same one.
 */

let mongod: MongoMemoryServer | undefined

export const setup = async (project: TestProject) => {
  mongod = await MongoMemoryServer.create()
  project.provide('mongoUri', mongod.getUri())
}

export const teardown = async () => {
  await mongod?.stop()
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The shared in-memory MongoDB, without a database name. */
    mongoUri: string
  }
}

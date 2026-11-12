/**
 * Creates an admin account in the database the server is configured for (its
 * environment and `.env`), or leaves it alone if one with that email exists.
 * Accounts are not created through the API, so this is how a fresh database,
 * such as a load test target, gets one.
 *
 * Run: ADMIN_EMAIL=… ADMIN_PASSWORD=… npx ts-node --transpile-only scripts/createAdmin.ts
 */
import 'dotenv/config'
import { connectDB, disconnectDB } from '../database'
import { User } from '../models/user'
import { hashPassword } from '../services/authService'

const main = async () => {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.')
    process.exit(2)
  }
  // The in-memory database lives only as long as this script, so an account
  // made there would be gone before anyone could log in with it.
  if (process.env.NODE_ENV === 'test' || process.env.USE_IN_MEMORY_DB === 'true') {
    console.error(
      'The server is configured for its in-memory database; point it at a real one (MONGO_URL, USE_IN_MEMORY_DB=false).'
    )
    process.exit(2)
  }

  await connectDB()
  if (await User.findOne({ email })) {
    console.log(`An account for ${email} exists already; left unchanged.`)
  } else {
    await User.create({ username: email, email, password: await hashPassword(password) })
    console.log(`Created an account for ${email}.`)
  }
  await disconnectDB()
}

main()

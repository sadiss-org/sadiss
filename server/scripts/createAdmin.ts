/**
 * Creates an admin account in the database the server is configured for, or
 * leaves it alone if one with that email exists. Accounts are not created
 * through the API, so this is how a fresh database, such as a load test
 * target, gets one.
 *
 * Run: ADMIN_EMAIL=… ADMIN_PASSWORD=… npx ts-node --transpile-only scripts/createAdmin.ts
 */
import bcrypt from 'bcryptjs'
import { connectDB, disconnectDB } from '../database'
import { User } from '../models/user'

const main = async () => {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.')
    process.exit(2)
  }

  await connectDB()
  if (await User.findOne({ email })) {
    console.log(`An account for ${email} exists already; left unchanged.`)
  } else {
    await User.create({ username: email, email, password: await bcrypt.hash(password, 10) })
    console.log(`Created an account for ${email}.`)
  }
  await disconnectDB()
}

main()

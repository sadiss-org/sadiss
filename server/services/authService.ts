import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { User } from '../models/user'
import { NotFoundError } from '../errors'

/** How a password is stored. Logging in checks it with bcryptjs in `auth.ts` and in `authenticateUser`. */
export const hashPassword = (password: string) => bcrypt.hash(password, 10)

export const authenticateUser = async (email: string, password: string) => {
  const user = await User.findOne({ email })

  if (!user) {
    throw new NotFoundError('Invalid email or password')
  }

  const isPasswordMatched = await bcrypt.compare(password, user.password)
  if (!isPasswordMatched) {
    throw new NotFoundError('Invalid email or password')
  }

  return user
}

export const generateToken = (userId: string) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET!, { expiresIn: '1d' })
}

/** The account a token was issued to, or nothing if it does not verify. */
export const verifyToken = (token: string): string | undefined => {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!)
    return typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : undefined
  } catch {
    return undefined
  }
}

import { SPLAT } from 'triple-beam'
import { createLogger, format, transports } from 'winston'
const { combine, timestamp, printf, colorize } = format

// Everything passed after the message arrives as `splat`. Winston already
// folds an Error's message into the message itself, so what is left to show
// here are the plain arguments, like an error message or a status text.
const myFormat = printf((info) => {
  const args: unknown[] = info[SPLAT] ?? []
  const rest = args.filter((arg) => typeof arg !== 'object')
  return `${info.timestamp} ${info.level}: ${info.message}${rest.length ? ` ${rest.join(' ')}` : ''}`
})

let desiredLogLevel = 'info'
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  desiredLogLevel = 'debug'
}

export const logger = createLogger({
  level: desiredLogLevel,
  format: combine(timestamp(), colorize(), myFormat),
  transports: [new transports.Console()]
})

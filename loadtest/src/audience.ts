import { setTimeout as sleep } from 'node:timers/promises'
import { PhoneOptions, startVirtualPhone, VirtualPhone } from './virtualPhone'

/** The virtual phones in a performance. Phones can join at any time, before or during a track. */
export interface Audience {
  /** Every phone that has joined so far, in the order they joined. */
  readonly phones: readonly VirtualPhone[]
  join(options: PhoneOptions): VirtualPhone
  /** Disconnects every phone for good. */
  leave(): void
}

export const createAudience = (): Audience => {
  const phones: VirtualPhone[] = []
  return {
    phones,
    join: (options) => {
      const phone = startVirtualPhone(options)
      phones.push(phone)
      return phone
    },
    leave: () => phones.forEach((phone) => phone.close())
  }
}

/** Lets `count` phones join one after another, spread evenly over `overMs`. */
export const joinGradually = async (audience: Audience, count: number, overMs: number, phoneFor: (index: number) => PhoneOptions) => {
  for (let index = 0; index < count; index++) {
    audience.join(phoneFor(index))
    await sleep(overMs / count)
  }
}

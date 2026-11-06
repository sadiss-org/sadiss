import { setTimeout as sleep } from 'node:timers/promises'
import { PhoneOptions, startVirtualPhone, VirtualPhone } from './virtualPhone'

export interface Audience {
  phones: VirtualPhone[]
  /** Disconnects every phone for good. */
  leave(): void
}

/**
 * Lets `count` virtual phones join a performance one after another, spread
 * evenly over `overMs`, and resolves once the last one has joined.
 */
export const join = async (count: number, overMs: number, phoneFor: (index: number) => PhoneOptions): Promise<Audience> => {
  const phones: VirtualPhone[] = []
  for (let index = 0; index < count; index++) {
    phones.push(startVirtualPhone(phoneFor(index)))
    await sleep(overMs / count)
  }
  return {
    phones,
    leave: () => phones.forEach((phone) => phone.close())
  }
}

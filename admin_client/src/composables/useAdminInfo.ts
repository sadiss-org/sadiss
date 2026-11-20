import { onScopeDispose, readonly, ref, Ref } from "vue"
import AdminInfo from "../types/AdminInfo"
import { wsUrl } from "../utils/serverUrls"
import { createResilientSocket } from "./resilientSocket"

/**
 * The state of the room, kept current.
 *
 * `info` is the latest `adminInfo` the server pushed for this performance, or for
 * the room as a whole when no performance is named. `live` says whether it is
 * still arriving; while it is not, `info` is the last thing heard.
 *
 * Everything that follows the same performance shares one connection, opened
 * when the first of them needs it and closed when the last one goes away.
 */

interface Subscription {
  info: Ref<AdminInfo | undefined>
  live: Ref<boolean>
  close: () => void
  users: number
}

const subscriptions = new Map<string, Subscription>()

const registration = (performanceId?: string) =>
  JSON.stringify(
    performanceId ? { message: "isAdmin", performanceId } : { message: "isAdmin" }
  )

const readAdminInfo = (data: string): AdminInfo | undefined => {
  try {
    const parsed = JSON.parse(data)
    return parsed?.message === "adminInfo" ? parsed.adminInfo : undefined
  } catch {
    return undefined
  }
}

const subscribe = (performanceId?: string): Subscription => {
  const info = ref<AdminInfo>()
  const live = ref(false)

  const socket = createResilientSocket({
    url: wsUrl(),
    onOpen: send => send(registration(performanceId)),
    onMessage: data => {
      const received = readAdminInfo(data)
      if (received) info.value = received
    },
    onLiveChange: value => (live.value = value),
  })

  return { info, live, close: socket.close, users: 0 }
}

export const useAdminInfo = (performanceId?: string) => {
  const key = performanceId ?? ""
  const subscription = subscriptions.get(key) ?? subscribe(performanceId)
  subscriptions.set(key, subscription)
  subscription.users++

  onScopeDispose(() => {
    subscription.users--
    if (subscription.users === 0) {
      subscription.close()
      subscriptions.delete(key)
    }
  })

  return { info: readonly(subscription.info), live: readonly(subscription.live) }
}

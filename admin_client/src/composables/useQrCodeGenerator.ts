import type { QrCodeData } from "../types"
import { downloadZip } from "client-zip"
import { ref } from "vue"
import { wsUrl } from "../utils/serverUrls"

export function useQrCodeGenerator() {
  const qrCodeData = ref<QrCodeData[]>([])

  const wsServerUrl = wsUrl()

  const generateQrCodes = async (
    voiceCount: number,
    voiceNames: string[],
    performanceName: string,
    expertMode: boolean,
    performanceId: string,
    ttsLangs: string,
    defaultLanguage: string
  ) => {
    qrCodeData.value = []
    if (voiceCount) {
      for (let i = 0; i < voiceCount; i++) {
        const data: QrCodeData = {
          choirId: String(i),
          roleName: voiceNames[i],
          performanceName: performanceName,
          expertMode: expertMode,
          performanceId: performanceId,
          wsUrl: wsServerUrl,
        }
        if (ttsLangs) {
          data.tts = ttsLangs
            .split(", ")
            .map(iso => ({ iso, lang: convertIsoToLangName(iso) }))
          data.defaultLang = defaultLanguage
        }
        qrCodeData.value.push(data)
      }
    } else if (ttsLangs) {
      qrCodeData.value.push({
        performanceName: performanceName,
        performanceId: performanceId,
        expertMode: expertMode,
        defaultLang: defaultLanguage,
        tts: ttsLangs
          .split(", ")
          .map(iso => ({ iso, lang: convertIsoToLangName(iso) })),
        wsUrl: wsServerUrl,
      })
    }

    // If not enough data to generate QR codes, generate at least one code with performanceName and expertMode
    if (!qrCodeData.value.length) {
      qrCodeData.value.push({
        performanceId: performanceId,
        performanceName: performanceName,
        expertMode: false,
        wsUrl: wsServerUrl,
      })
    }
  }

  const languageMap: Record<string, string> = {
    "en-US": "English",
    "de-DE": "Deutsch",
    "es-ES": "Español",
    "fr-FR": "Français",
    "it-IT": "Italiano",
  }

  const convertIsoToLangName = (iso: string) => languageMap[iso] ?? iso

  const qrCodeContainer = ref()

  const setQrCodeContainerRef = (el: HTMLElement[]) =>
    (qrCodeContainer.value = el)

  // Adapted from https://stackoverflow.com/a/38019175/16725862
  const downloadPartialQrCodes = async () => {
    const svgBlobs = []
    for (const qrCode of qrCodeContainer.value) {
      const svgData = qrCode.innerHTML
      const svgBlob = new Blob([svgData], {
        type: "image/svg+xml;charset=utf-8",
      })
      svgBlobs.push({
        name: `Voice-${qrCodeContainer.value.indexOf(qrCode)}.svg`,
        input: svgBlob,
      })
    }

    const blob = await downloadZip([...svgBlobs]).blob()
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    // link.download = `${data['title'].replace(/ /g, '-')}_Voices_QR-Codes`
    link.download = `QR-Codes`
    link.click()
    link.remove()
  }

  return {
    generateQrCodes,
    qrCodeData,
    setQrCodeContainerRef,
    downloadPartialQrCodes,
  }
}

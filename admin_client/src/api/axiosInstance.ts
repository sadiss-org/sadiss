import axios from "axios"
import { apiUrl } from "../utils/serverUrls"

const apiClient = axios.create({
  baseURL: apiUrl(),
  withCredentials: true,
})

export default apiClient

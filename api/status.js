import { statusResponse } from "../lib/handlers.js";

export function GET(request) {
  return statusResponse(request);
}

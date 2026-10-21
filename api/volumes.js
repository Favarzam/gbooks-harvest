import { volumesResponse } from "../lib/handlers.js";

export function GET(request) {
  return volumesResponse(request);
}

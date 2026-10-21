import { routeApi } from "../lib/handlers.js";

export default {
  fetch(request) {
    return routeApi(request);
  },
};

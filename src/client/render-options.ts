import type { RouteDetails } from "./routing";

export function shouldAllowRawHtmlForRoute(
  route: Pick<RouteDetails, "mode">,
): boolean {
  return route.mode === "html" || route.mode === "canvas";
}

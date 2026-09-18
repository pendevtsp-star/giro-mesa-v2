import type { RouteId } from "../../domain";
import { routeHref } from "../../router";

export function overviewDestinationHref({ id, route }: { id: string; route: RouteId }) {
  if (id === "new-tab" && route === "counter") return `${routeHref(route)}?action=new`;
  return routeHref(route);
}

import { lazy, Suspense } from "react";
import Landing from "./Landing";

const LiveApp = lazy(() => import("./live/LiveApp"));
const EvidenceApp = lazy(() => import("./App"));

function RouteLoading() {
  return <main className="route-loading"><img alt="" className="brand-mark brand-mark-lg" height={44} src="/brand/mark.png" width={44} /><span>SETPOINT</span><p>Loading product surface…</p></main>;
}

export default function Router() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <Landing />;
  if (path === "/app" || path.startsWith("/app/")) return <Suspense fallback={<RouteLoading />}><LiveApp /></Suspense>;
  if (path === "/evidence" || path.startsWith("/evidence/")) return <Suspense fallback={<RouteLoading />}><EvidenceApp /></Suspense>;
  return <main className="not-found"><img alt="" className="brand-mark brand-mark-lg" height={44} src="/brand/mark.png" width={44} /><p className="product-kicker">404 / Route not found</p><h1>This surface does not exist.</h1><a href="/">Return to Setpoint</a></main>;
}

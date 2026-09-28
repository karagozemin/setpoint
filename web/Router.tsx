import { lazy, Suspense } from "react";
import Landing from "./Landing";

const LiveApp = lazy(() => import("./live/LiveApp"));
const EvidenceApp = lazy(() => import("./App"));

function RouteLoading() {
  return <main className="route-loading"><img alt="" className="brand-mark brand-mark-lg" height={44} src="/brand/setpoint.png" width={44} /><span>SETPOINT</span><p>Loading product surface…</p></main>;
}

function NotFound() {
  return <main className="not-found"><img alt="" className="brand-mark brand-mark-lg" height={44} src="/brand/setpoint.png" width={44} /><p className="product-kicker">404 / Route not found</p><h1>This surface does not exist.</h1><a href="/">Return to Setpoint</a></main>;
}

export default function Router() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const vaultRoute = /^\/app\/vault\/(vimen-agentic-mag7|hiss-v2|fides-frontier|rwa-index|mag7-index|wield-rwa)$/.test(path);
  if (path === "/") return <Landing />;
  if (path === "/app" || path === "/app/sandbox" || vaultRoute) return <Suspense fallback={<RouteLoading />}><LiveApp /></Suspense>;
  if (path === "/evidence") return <Suspense fallback={<RouteLoading />}><EvidenceApp /></Suspense>;
  return <NotFound />;
}

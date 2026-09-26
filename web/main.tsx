import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class ConsoleErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Operator console render failed", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-state">
          <p className="eyebrow">Application error</p>
          <h1>Evidence could not be rendered.</h1>
          <p>This is an application error, not a Setpoint NO_TRADE decision.</p>
          <button onClick={() => window.location.reload()} type="button">Reload console</button>
        </main>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <ConsoleErrorBoundary>
    <App />
  </ConsoleErrorBoundary>,
);

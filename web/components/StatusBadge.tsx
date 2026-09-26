import type { ExecutionMode } from "../data/types";

interface StatusBadgeProps {
  mode: ExecutionMode;
  compact?: boolean;
}

const labels: Record<ExecutionMode, string> = {
  FAST_PATH: "Fast path",
  ADAPTIVE_FALLBACK: "Adaptive fallback",
  NO_TRADE: "No trade",
  ERROR: "Error",
};

const symbols: Record<ExecutionMode, string> = {
  FAST_PATH: "01",
  ADAPTIVE_FALLBACK: "02",
  NO_TRADE: "00",
  ERROR: "!!",
};

export function StatusBadge({ mode, compact = false }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${mode.toLowerCase()}${compact ? " status-compact" : ""}`}>
      <span aria-hidden="true" className="status-symbol">
        {symbols[mode]}
      </span>
      <span>{compact ? labels[mode] : mode}</span>
    </span>
  );
}

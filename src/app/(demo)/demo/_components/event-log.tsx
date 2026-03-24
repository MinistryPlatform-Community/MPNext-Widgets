"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface LogEntry {
  timestamp: string;
  type: string;
  detail: string;
}

export function useEventLog() {
  const [entries, setEntries] = useState<LogEntry[]>([
    { timestamp: new Date().toLocaleTimeString(), type: "info", detail: "Initializing widget..." },
  ]);

  const log = useCallback((type: string, detail: unknown) => {
    setEntries((prev) => [
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        detail: typeof detail === "string" ? detail : JSON.stringify(detail, null, 2),
      },
      ...prev,
    ]);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  return { entries, log, clear };
}

export function EventLog({
  entries,
  onClear,
}: {
  entries: LogEntry[];
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-[#002855]">Event Log</h3>
        <button
          onClick={onClear}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          Clear
        </button>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[300px] overflow-y-auto bg-[#1f2937] p-4 font-mono text-sm text-[#10b981]"
      >
        {entries.length === 0 && (
          <div className="text-gray-500">No events captured yet.</div>
        )}
        {entries.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${i}`}
            className="mb-2 rounded bg-[rgba(16,185,129,0.1)] p-2"
          >
            <span className="font-bold">{entry.timestamp}</span>
            {" - "}
            <span className="italic">{entry.type}</span>
            {": "}
            <span className="whitespace-pre-wrap break-all">{entry.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

export default function ScheduleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-2xl">⚠️</div>
      <h2 className="text-lg font-bold text-text-primary">Schedule Error</h2>
      <p className="text-sm text-red-600 max-w-md text-center font-mono bg-red-50 p-4 rounded-xl border border-red-200 break-all">
        {error.message}
      </p>
      {error.stack && (
        <pre className="text-xs text-text-tertiary max-w-lg overflow-auto max-h-48 bg-surface-elevated p-3 rounded-lg border border-border-light">
          {error.stack}
        </pre>
      )}
      <button onClick={reset} className="btn-primary text-sm px-6 py-2">
        Try Again
      </button>
    </div>
  );
}

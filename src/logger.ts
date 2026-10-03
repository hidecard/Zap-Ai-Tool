export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  metadata?: Record<string, unknown>;
}

export function createLogger(write: (line: string) => void = console.log) {
  return (level: LogLevel, event: string, metadata?: Record<string, unknown>): void => {
    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(metadata === undefined ? {} : { metadata }),
    };
    write(JSON.stringify(entry));
  };
}

type Meta = Record<string, unknown> | undefined;

function ts(): string {
  return new Date().toISOString();
}

function redactNwcUrl(url: string): string {
  if (url.length <= 28) return "[nwc-url]";
  return `${url.slice(0, 24)}…(${url.length} chars)`;
}

export const log = {
  info(scope: string, message: string, meta?: Meta) {
    const line = `[${ts()}] [${scope}] ${message}`;
    if (meta && Object.keys(meta).length) {
      console.log(line, meta);
    } else {
      console.log(line);
    }
  },

  warn(scope: string, message: string, meta?: Meta) {
    const line = `[${ts()}] [${scope}] WARN ${message}`;
    if (meta && Object.keys(meta).length) {
      console.warn(line, meta);
    } else {
      console.warn(line);
    }
  },

  error(scope: string, message: string, err?: unknown, meta?: Meta) {
    const line = `[${ts()}] [${scope}] ERROR ${message}`;
    const detail =
      err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { err };
    console.error(line, { ...detail, ...meta });
  },

  redactNwcUrl
};

declare namespace Deno {
  export const env: { get(key: string): string | undefined; toObject(): Record<string, string> };
  export function serve(handler: (req: Request, info?: { remoteAddr: { hostname: string } }) => Response | Promise<Response>): unknown;
}
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

import { transfer } from 'comlink';

import {
  type ILiteProxyManager,
  type SerializedRequest,
  type GenerateResponseOptions,
  type GenerateResponseResult,
} from './tokens';

type HandlerEntry = {
  shouldHandle: (req: Request) => boolean;
  handler: (req: Request, res?: Response) => Response | Promise<Response>;
};

const EXT_CONTENT_TYPES: Record<string, string> = {
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  md: 'text/markdown',
  mjs: 'application/javascript',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  wasm: 'application/wasm',
  webp: 'image/webp',
  xml: 'application/xml',
};

function resolveContentType(headers: Headers, urlPath: string): string {
  const fromHeader = headers.get('content-type');
  if (fromHeader) {
    return fromHeader;
  }
  const ext = urlPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isBinaryContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return !(
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/javascript' ||
    type === 'application/ld+json' ||
    type === 'application/xml' ||
    type === 'application/xhtml+xml' ||
    type === 'image/svg+xml'
  );
}

function deserializeRequest(
  serialized: SerializedRequest,
  body?: ArrayBuffer,
): Request {
  const url = new URL(serialized.urlPath, location.origin);
  if (serialized.params) {
    url.search = serialized.params;
  }
  return new Request(url.toString(), {
    method: serialized.method,
    headers: serialized.headers,
    body,
  });
}

export class LiteProxyManager implements ILiteProxyManager {
  private _handlers: HandlerEntry[] = [];

  register(options: {
    shouldHandle: (req: Request) => boolean;
    handler: (req: Request, res?: Response) => Response | Promise<Response>;
  }): void {
    this._handlers.push(options);
  }

  // Called by the service worker via comlink
  async shouldHandle(serialized: SerializedRequest): Promise<boolean> {
    const req = deserializeRequest(serialized);
    return this._handlers.some((h) => h.shouldHandle(req));
  }

  // Called by the service worker via comlink
  async generateResponse(
    options: GenerateResponseOptions,
  ): Promise<GenerateResponseResult> {
    const { requestBody, ...serialized } = options;
    const req = deserializeRequest(serialized, requestBody);
    let response: Response | undefined;
    for (const h of this._handlers) {
      if (h.shouldHandle(req)) {
        response = await h.handler(req, response);
      }
    }
    if (!response) {
      throw new Error(
        `No proxy handler found for ${options.method} ${options.urlPath}`,
      );
    }
    const contentType = resolveContentType(response.headers, serialized.urlPath);
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });
    if (!respHeaders['content-type']) {
      respHeaders['content-type'] = contentType;
    }
    const result: GenerateResponseResult = {
      headers: respHeaders,
      content: isBinaryContentType(contentType)
        ? await response.arrayBuffer()
        : await response.text(),
      status_code: response.status,
    };
    return result.content instanceof ArrayBuffer
      ? transfer(result, [result.content])
      : result;
  }
}

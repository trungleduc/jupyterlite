import { wrap, transfer, type Remote } from 'comlink';

import type {
  SerializedRequest,
  GenerateResponseOptions,
  GenerateResponseResult,
} from './tokens';

type ProxyManagerRemote = {
  shouldHandle(serialized: SerializedRequest): boolean;
  generateResponse(options: GenerateResponseOptions): GenerateResponseResult;
};

function serializeRequest(request: Request): SerializedRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (!key.startsWith('sec-ch-ua')) {
      headers[key] = value;
    }
  }
  return {
    urlPath: url.pathname,
    method: request.method,
    headers,
    params: url.searchParams.toString(),
  };
}

/**
 * Manages communication between the main thread and the service worker using Comlink's MessagePort-based communication.
 * This class handles registration of communication channels and processing of requests.
 * It's running on the service worker thread
 */
export class ServiceWorkerProxy {
  constructor() {}

  registerComm(clientId: string, port: MessagePort): void {
    if (this._commIds.has(clientId)) {
      throw new Error('Cannot re-register the same tab');
    }
    this._commIds.set(clientId, wrap<ProxyManagerRemote>(port));
  }

  async shouldHandle(options: {
    clientId: string;
    request: Request;
  }): Promise<boolean> {
    const { clientId, request } = options;
    const comm = this._commIds.get(clientId);
    if (!comm) {
      return false;
    }
    return comm.shouldHandle(serializeRequest(request));
  }

  async generateResponse(options: {
    clientId: string;
    request: Request;
  }): Promise<Response> {
    const { clientId, request } = options;
    const comm = this._commIds.get(clientId);
    if (!comm) {
      throw new Error('Missing communication channel');
    }
    const serialized = serializeRequest(request);
    const requestBody = request.body ? await request.arrayBuffer() : undefined;
    const data = await comm.generateResponse({
      ...serialized,
      requestBody: requestBody ? transfer(requestBody, [requestBody]) : undefined,
    });
    if (data) {
      const { headers, content, status_code } = data;
      return new Response(content, { status: status_code, headers });
    }
    throw new Error('Error generating response');
  }

  private _commIds = new Map<string, Remote<ProxyManagerRemote>>();
}

import { PageConfig, URLExt } from '@jupyterlab/coreutils';

import { Contents } from '@jupyterlab/services';

import {
  DRIVE_API_PATH,
  DriveContentsProcessor,
  TDriveMethod,
  TDriveRequest,
} from '@jupyterlite/contents';

import { PromiseDelegate, UUID } from '@lumino/coreutils';

import { ISignal, Signal } from '@lumino/signaling';

import { IServiceWorkerManager, WORKER_NAME } from './tokens';

/**
 * The version of the app
 */
const VERSION = PageConfig.getOption('appVersion');

/**
 * Used to keep the service worker alive
 */
const SW_PING_ENDPOINT = '/api/service-worker-heartbeat';

/**
 * A class that manages the ServiceWorker registration and communication,
 * used for accessing the file system.
 */
export class ServiceWorkerManager implements IServiceWorkerManager {
  /**
   * Construct a new ServiceWorkerManager.
   */
  constructor(options: IServiceWorkerManager.IOptions) {
    const workerUrl =
      options.workerUrl ?? URLExt.join(PageConfig.getBaseUrl(), WORKER_NAME);
    const fullWorkerUrl = new URL(workerUrl, window.location.href);
    const enableCache = PageConfig.getOption('enableServiceWorkerCache') || 'false';
    fullWorkerUrl.searchParams.set('enableCache', enableCache);

    // Initialize broadcast channel related properties
    this._browsingContextId = UUID.uuid4();
    this._contents = options.contents;
    this._broadcastChannel = new BroadcastChannel(DRIVE_API_PATH);
    this._broadcastChannel.addEventListener('message', this._onBroadcastMessage);

    this._driveContentsProcessor = new DriveContentsProcessor({
      contentsManager: this._contents,
    });

    void this._initialize(fullWorkerUrl.href).catch(console.warn);
  }

  /**
   * A signal emitted when the registration changes.
   */
  get registrationChanged(): ISignal<
    IServiceWorkerManager,
    ServiceWorkerRegistration | null
  > {
    return this._registrationChanged;
  }

  /**
   * Whether the ServiceWorker is enabled or not.
   */
  get enabled(): boolean {
    return this._registration !== null;
  }

  /**
   * A unique id to identify the browsing context where the ServiceWorkerManager was instantiated.
   */
  get browsingContextId(): string {
    return this._browsingContextId;
  }

  /**
   * Whether the ServiceWorker is ready or not.
   */
  get ready(): Promise<void> {
    return this._ready.promise;
  }

  /**
   * Initialize the ServiceWorkerManager.
   */
  private async _initialize(workerUrl: string): Promise<void> {
    const { serviceWorker } = navigator;

    let registration: ServiceWorkerRegistration | null = null;

    if (!serviceWorker) {
      console.warn('ServiceWorkers not supported in this browser');
      return;
    } else if (serviceWorker.controller) {
      const scriptURL = serviceWorker.controller.scriptURL;
      await this._unregisterOldServiceWorkers(scriptURL);

      registration = (await serviceWorker.getRegistration(scriptURL)) || null;
      // eslint-disable-next-line no-console
      console.info('JupyterLite ServiceWorker was already registered');
    }

    if (!registration && serviceWorker) {
      try {
        // eslint-disable-next-line no-console
        console.info('Registering new JupyterLite ServiceWorker', workerUrl);
        registration = await serviceWorker.register(workerUrl);
        // eslint-disable-next-line no-console
        console.info('JupyterLite ServiceWorker was sucessfully registered');
      } catch (err: any) {
        console.warn(err);
        console.warn(
          `JupyterLite ServiceWorker registration unexpectedly failed: ${err}`,
        );
      }
    }

    this._setRegistration(registration);

    if (!registration) {
      this._ready.reject(void 0);
    } else {
      this._ready.resolve(void 0);
      setTimeout(this._pingServiceWorker, 20000);
    }
  }

  /**
   * Unregister old service workers if the version has changed.
   */
  private async _unregisterOldServiceWorkers(scriptURL: string): Promise<void> {
    const versionKey = `${scriptURL}-version`;
    // Check if we have an installed version. If we do, compare it to the current version
    // and unregister all service workers if they are different.
    const installedVersion = localStorage.getItem(versionKey);

    if ((installedVersion && installedVersion !== VERSION) || !installedVersion) {
      // eslint-disable-next-line no-console
      console.info('New version, unregistering existing service workers.');
      const registrations = await navigator.serviceWorker.getRegistrations();

      await Promise.all(registrations.map((registration) => registration.unregister()));

      // eslint-disable-next-line no-console
      console.info('All existing service workers have been unregistered.');
    }

    localStorage.setItem(versionKey, VERSION);
  }

  /**
   * Ping the service worker to keep it alive.
   */
  private async _pingServiceWorker(): Promise<void> {
    const response = await fetch(SW_PING_ENDPOINT);
    const text = await response.text();
    if (text === 'ok') {
      setTimeout(this._pingServiceWorker, 20000);
    }
  }

  /**
   * Set the registration and emit a signal.
   */
  private _setRegistration(registration: ServiceWorkerRegistration | null) {
    this._registration = registration;
    this._registrationChanged.emit(this._registration);
  }

  /**
   * Handle a message received on the BroadcastChannel
   */
  private _onBroadcastMessage = async <T extends TDriveMethod>(
    event: MessageEvent<{
      data: TDriveRequest<T>;
      browsingContextId: string;
    }>,
  ): Promise<void> => {
    const { data, browsingContextId } = event.data;

    if (browsingContextId !== this._browsingContextId) {
      // Message is not meant for us
      return;
    }

    const response = await this._driveContentsProcessor.processDriveRequest(data);
    // pass the browsingContextId along so the Service Worker can identify the request
    this._broadcastChannel.postMessage({
      response,
      browsingContextId: this._browsingContextId,
    });
  };

  private _registration: ServiceWorkerRegistration | null = null;
  private _registrationChanged = new Signal<this, ServiceWorkerRegistration | null>(
    this,
  );
  private _ready = new PromiseDelegate<void>();
  private _broadcastChannel: BroadcastChannel;
  private _browsingContextId: string;
  private _contents: Contents.IManager;
  private _driveContentsProcessor: DriveContentsProcessor;
}

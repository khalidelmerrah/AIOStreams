import { StreamRequest, Stream, ParsedStream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import { createLogger, Settings } from '@aiostreams/utils';
import { ProxyAgent, fetch as uFetch } from 'undici';

const logger = createLogger('wrappers');

interface ProwlarrRelease {
  title?: string;
  magnetUrl?: string;
  downloadUrl?: string;
  infoHash?: string;
  size?: number;
  seeders?: number;
  indexer?: string;
}

export class Prowlarr extends BaseWrapper {
  private apiKey: string;
  constructor(
    apiKey: string,
    overrideUrl: string | null,
    addonName: string = 'Prowlarr',
    addonId: string,
    userConfig: Config,
    indexerTimeout?: number
  ) {
    super(
      addonName,
      overrideUrl ? overrideUrl.replace(/\/$/, '') : Settings.PROWLARR_URL.replace(/\/$/, ''),
      addonId,
      userConfig,
      indexerTimeout || Settings.DEFAULT_PROWLARR_TIMEOUT
    );
    this.apiKey = apiKey;
  }

  protected standardizeManifestUrl(url: string): string {
    return url.replace(/\/$/, '');
  }

  protected async getStreams(streamRequest: StreamRequest): Promise<Stream[]> {
    const urlObj = new URL('/api/v1/search', this.addonUrl + '/');
    urlObj.searchParams.set('query', streamRequest.id);
    urlObj.searchParams.set('limit', '100');

    const headers = new Headers();
    headers.set('X-Api-Key', this.apiKey);
    const userIp = this.userConfig.requestingIp;
    if (userIp) {
      headers.set('X-Client-IP', userIp);
      headers.set('X-Forwarded-For', userIp);
      headers.set('X-Real-IP', userIp);
    }

    const url = urlObj.toString();
    const useProxy = this.shouldProxyRequest(url);
    const sanitisedUrl = this.getLoggableUrl(url);
    logger.info(`Making a ${useProxy ? 'proxied' : 'direct'} request to Prowlarr (${sanitisedUrl})`);

    const response = await (useProxy
      ? uFetch(url, {
          dispatcher: new ProxyAgent(Settings.ADDON_PROXY),
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(this.indexerTimeout),
        })
      : fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(this.indexerTimeout) }));

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} - ${response.statusText} ${text}`);
    }
    const releases: ProwlarrRelease[] = await response.json();
    return releases.map((rel) => {
      const stream: Stream = {
        url: rel.magnetUrl || rel.downloadUrl,
        infoHash: rel.infoHash || undefined,
        name: rel.title,
        description: `${rel.title ?? ''}\n🌐 ${rel.indexer ?? ''}${rel.seeders ? `\n👥 ${rel.seeders}` : ''}`,
        behaviorHints: { filename: rel.title, videoSize: rel.size },
      };
      return stream;
    });
  }
}

export async function getProwlarrStreams(
  config: Config,
  prowlarrOptions: {
    prowlarrUrl?: string;
    apiKey: string;
    overrideName?: string;
    indexerTimeout?: string;
  },
  streamRequest: StreamRequest,
  addonId: string
): Promise<{ addonStreams: ParsedStream[]; addonErrors: string[] }> {
  if (!prowlarrOptions.apiKey) {
    throw new Error('Missing API key for Prowlarr');
  }
  const prowlarr = new Prowlarr(
    prowlarrOptions.apiKey,
    prowlarrOptions.prowlarrUrl ?? null,
    prowlarrOptions.overrideName,
    addonId,
    config,
    prowlarrOptions.indexerTimeout ? parseInt(prowlarrOptions.indexerTimeout) : undefined
  );
  return prowlarr.getParsedStreams(streamRequest);
}


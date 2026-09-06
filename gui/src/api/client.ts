export interface ApiResponse<T = any> {
  success: boolean;
  code: number;
  data?: T;
  error?: {
    message: string;
    fieldErrors?: Record<string, string>;
  };
  meta?: {
    timestamp: string;
  };
}

export interface NetworkMeta {
  network: {
    asn: string;
    asnNumber: number;
    networkName: string;
    shortName: string;
    tagline: string;
    description: string;
    maintainer: string;
    ipv4Pool: string;
    ipv6Pool: string;
    routingPolicy: string;
    bgpMode: string;
    portFormulaDisplay: string;
    lookingGlassUrl?: string;
    dn42WhoisUrl?: string;
  };
  nodes: Array<{
    id: string;
    code: string;
    name: string;
    flag: string;
    city: string;
    country: string;
    region: string;
    status: string;
    isp: string;
    endpointDomain: string;
    wgPublicKey: string;
    tunnelIpv4: string;
    tunnelIpv6ULA: string;
    tunnelIpv6LLA: string;
    mtu: number;
    features: string[];
    lgProxyUrl?: string;
  }>;
  contacts: Array<{
    platform: string;
    handle: string;
    link: string;
    type: string;
    preferred?: boolean;
  }>;
  guiPath: string;
}

export interface PeeringSession {
  id: string;
  source?: 'portal' | 'discovered' | string;
  asn?: number | null;
  asName?: string;
  mnt?: string;
  nodeId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  peering: {
    interface?: string;
    publicKey: string;
    endpoint?: string;
    ipv4?: string;
    ipv6Ula?: string;
    linkLocal: string;
    listenPort: number;
    clientPort?: number | string;
    clientPortShifted?: boolean;
    mtu: number;
    bgpMode: string;
  };
  assigned: {
    interface?: string;
    hostPort: number;
    isShifted: boolean;
    clientPort?: number;
    isClientPortShifted?: boolean;
    expectedClientPort?: number;
    serverEndpoint: string;
    serverPublicKey: string;
    serverIpv4: string;
    serverIpv6Ula: string;
    serverLinkLocal: string;
    serverWireguardSnippet?: string;
  };
  runtime?: {
    stage?: number;
    stageText?: string;
    latestHandshake?: number;
    rxBytes?: number;
    txBytes?: number;
    bgpState?: string;
    bgpInfo?: string;
    endpoint?: string;
  };
}

export async function readTokenFromOPFS(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !navigator.storage || !navigator.storage.getDirectory) return null;
    const rootDir = await navigator.storage.getDirectory();
    const dn42Dir = await rootDir.getDirectoryHandle('.dn42');
    const fileHandle = await dn42Dir.getFileHandle('token');
    const file = await fileHandle.getFile();
    const token = (await file.text()).trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function syncTokenToOPFS(token: string | null): Promise<void> {
  try {
    if (typeof window === 'undefined' || !navigator.storage || !navigator.storage.getDirectory) return;
    const rootDir = await navigator.storage.getDirectory();
    if (token) {
      const dn42Dir = await rootDir.getDirectoryHandle('.dn42', { create: true });
      const fileHandle = await dn42Dir.getFileHandle('token', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(token);
      await writable.close();
    } else {
      try {
        const dn42Dir = await rootDir.getDirectoryHandle('.dn42');
        await dn42Dir.removeEntry('token').catch(() => {});
        await dn42Dir.removeEntry('asn').catch(() => {});
      } catch {}
    }
  } catch (e) {
    console.warn('OPFS sync error:', e);
  }
}

export class ApiClient {
  public static getToken(): string | null {
    return localStorage.getItem('dn42_auth_token') || sessionStorage.getItem('dn42_auth_token');
  }

  public static setToken(token: string, rememberMe: boolean = true) {
    if (rememberMe) {
      localStorage.setItem('dn42_auth_token', token);
      sessionStorage.removeItem('dn42_auth_token');
      syncTokenToOPFS(token).catch(() => {});
      if (typeof window !== 'undefined' && typeof (window as any).syncTokenToPersist === 'function') {
        (window as any).syncTokenToPersist(token);
      }
    } else {
      localStorage.removeItem('dn42_auth_token');
      sessionStorage.setItem('dn42_auth_token', token);
    }
  }

  public static clearToken() {
    localStorage.removeItem('dn42_auth_token');
    sessionStorage.removeItem('dn42_auth_token');
    syncTokenToOPFS(null).catch(() => {});
    if (typeof window !== 'undefined' && typeof (window as any).syncTokenToPersist === 'function') {
      (window as any).syncTokenToPersist(null);
    }
  }

  public static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    const token = this.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(endpoint, { ...options, headers });
      const data: ApiResponse<T> = await res.json();
      if (res.status === 401 && endpoint !== '/api/auth/login-password') {
        this.clearToken();
      }
      return data;
    } catch (err: any) {
      return {
        success: false,
        code: 500,
        error: { message: err.message || 'Network request failed' }
      };
    }
  }

  public static async getNetworkMeta(): Promise<ApiResponse<NetworkMeta>> {
    return this.request<NetworkMeta>('/api/network-meta');
  }

  public static async submitPeering(payload: any): Promise<ApiResponse<any>> {
    return this.request('/api/peering/submit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public static async getChallenge(asn: string | number): Promise<ApiResponse<any>> {
    return this.request(`/api/auth/challenge?asn=${asn}`);
  }

  public static async verifySignature(asn: string | number, challengeText: string, signature: string, rememberMe: boolean = false): Promise<ApiResponse<any>> {
    return this.request('/api/auth/verify-signature', {
      method: 'POST',
      body: JSON.stringify({ asn, challengeText, signature, rememberMe })
    });
  }

  public static async loginPassword(asnOrUsername: string | number, password: string, rememberMe: boolean = false): Promise<ApiResponse<any>> {
    return this.request('/api/auth/login-password', {
      method: 'POST',
      body: JSON.stringify({ asn: String(asnOrUsername), username: String(asnOrUsername), password, rememberMe })
    });
  }

  public static async setPassword(password: string): Promise<ApiResponse<any>> {
    return this.request('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
  }

  public static async getMe(): Promise<ApiResponse<any>> {
    return this.request('/api/auth/me');
  }

  public static async getSessions(): Promise<ApiResponse<PeeringSession[]>> {
    return this.request<PeeringSession[]>('/api/sessions');
  }

  public static async deleteSession(sessionId: string): Promise<ApiResponse<any>> {
    return this.request(`/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
  }

  public static async queryLookingGlass(nodeId: string, command: string, target?: string): Promise<ApiResponse<any>> {
    return this.request('/api/looking-glass', {
      method: 'POST',
      body: JSON.stringify({ nodeId, command, target })
    });
  }
}

import { isIPv4 } from 'node:net';
import Bonjour from 'bonjour-service';
import createMdns from 'multicast-dns';

interface E1Address {
    host: string;
    port: number;
    did?: string;
}

interface E1Service {
    port: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
}

interface E1Target {
    did: string;
    host: string;
    port?: number;
    controllerIp?: string;
}

/** Match a configured DID preferentially, allowing DHCP changes; never pick the first camera. */
const matchE1Service = (service: E1Service, target: E1Target): E1Address | undefined => {
    const did = service.txt?.id;
    if (typeof did !== 'string' || !did.startsWith('lumi1.')) return;
    if (target.did && did !== target.did) return;
    const addresses = service.addresses?.filter(isIPv4) ?? [];
    if (!target.did && !addresses.includes(target.host)) return;
    const host = addresses.includes(target.host) ? target.host : addresses[0];
    if (!host || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return;
    return { did, host, port: service.port };
};

/** Discover _aqara-setup._tcp, whose advertised port actually accepts camera UDP. */
const discoverE1 = async (target: E1Target, signal: AbortSignal, makeMdns: typeof createMdns = createMdns): Promise<E1Address> => {
    signal.throwIfAborted();
    if (target.port) return { host: target.host, port: target.port, did: target.did || undefined };
    return new Promise((resolve, reject) => {
        let finished = false;
        let mdns: ReturnType<typeof createMdns> | undefined;
        let browser: Bonjour.Browser | undefined;
        const finish = (error?: Error, address?: E1Address) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            try {
                browser?.stop();
                mdns?.destroy();
            } catch (cause) {
                // multicast-dns closes an unbound socket after a failed bind.
                if ((cause as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') error ??= cause as Error;
            }
            if (error) reject(error);
            else if (address) resolve(address);
        };
        const onAbort = () => finish(new Error('E1 discovery cancelled'));
        const timer = setTimeout(
            () => finish(new Error('E1 discovery timed out. Check multicast access or set a manual control port.')),
            4000
        );
        signal.addEventListener('abort', onAbort, { once: true });
        try {
            mdns = makeMdns({ type: 'udp4' });
            // Bonjour's constructor callback covers DNS responses, not socket
            // errors. Own the transport and install its error listener directly.
            mdns.on('error', error => finish(error));
            browser = new Bonjour.Browser(mdns, { protocol: 'tcp', type: 'aqara-setup' }, service => {
                const address = matchE1Service(service, target);
                if (address) finish(undefined, address);
            });
        } catch (error) {
            finish(error as Error);
        }
    });
};

export { discoverE1, type E1Target, matchE1Service, type E1Address };

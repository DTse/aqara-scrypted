import { isIPv4 } from 'node:net';
import Bonjour from 'bonjour-service';

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
const discoverE1 = async (target: E1Target, signal: AbortSignal): Promise<E1Address> => {
    signal.throwIfAborted();
    if (target.port) return { host: target.host, port: target.port, did: target.did || undefined };
    return new Promise((resolve, reject) => {
        let finished = false;
        let bonjour: Bonjour | undefined;
        let browser: ReturnType<Bonjour['find']> | undefined;
        const finish = (error?: Error, address?: E1Address) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            browser?.stop();
            bonjour?.destroy();
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
            bonjour = new Bonjour(undefined, (error: Error) => finish(error));
            browser = bonjour.find({ protocol: 'tcp', type: 'aqara-setup' }, service => {
                const address = matchE1Service(service, target);
                if (address) finish(undefined, address);
            });
        } catch (error) {
            finish(error as Error);
        }
    });
};

export { discoverE1, type E1Target, matchE1Service, type E1Address };

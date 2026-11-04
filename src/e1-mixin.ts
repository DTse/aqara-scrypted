import { isIPv4 } from 'node:net';
import { MixinDeviceBase, ScryptedInterface } from '@scrypted/sdk';

import { E1Session } from './e1-session';
import { resolveE1Jog } from './e1-protocol';

import type { E1Target } from './e1-discovery';
import type { Setting, Settings, PanTiltZoom, SettingValue, ScryptedDevice, MixinDeviceOptions, PanTiltZoomCommand } from '@scrypted/sdk';

const E1_SETTING_KEYS = ['host', 'did', 'port', 'controllerIp', 'jogDuration'] as const;

/** Optional PTZ on an existing E1 video device; does not own its video or pairing. */
class E1PtzMixin extends MixinDeviceBase<ScryptedDevice & Settings> implements PanTiltZoom, Settings {
    private readonly session: E1Session;

    constructor(options: MixinDeviceOptions<ScryptedDevice & Settings>) {
        super(options);
        this.ptzCapabilities = { pan: true, tilt: true, zoom: false };
        this.session = new E1Session({
            logger: this.console,
            getTarget: () => this.getTarget(),
            onDiscovered: address => {
                if (address.did) this.storage.setItem('did', address.did);
                this.storage.setItem('host', address.host);
            }
        });
    }

    async getSettings(): Promise<Setting[]> {
        const existing = this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings) ? await this.mixinDevice.getSettings() : [];
        const settings = await this.getE1Settings();
        return [...existing, ...settings.map(setting => ({ ...setting, key: `aqaraE1:${setting.key}` }))];
    }

    async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
        await this.session.command(resolveE1Jog(command, Number(this.storage.getItem('jogDuration') || 300)));
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (!key.startsWith('aqaraE1:')) {
            await this.mixinDevice.putSetting(key, value);
            return;
        }
        key = key.slice('aqaraE1:'.length);
        if (key === 'stop') {
            await this.session.command({ duration: 0, action: 'stop' });
            return;
        }
        if (!E1_SETTING_KEYS.some(allowed => allowed === key)) throw new Error('Unknown E1 setting');
        const text = value === undefined ? '' : String(value).trim();
        if ((key === 'host' || key === 'controllerIp') && text && !isIPv4(text)) throw new Error('An IPv4 address is required');
        if (key === 'did' && text && !/^lumi1\.[a-zA-Z0-9]+$/.test(text))
            throw new Error('Expected an Aqara DID such as lumi1.54ef4486d891');
        if (key === 'port' && text && (!Number.isInteger(Number(text)) || Number(text) < 1 || Number(text) > 65535))
            throw new Error('Control port must be 1–65535');
        if (key === 'jogDuration' && (!Number.isFinite(Number(text)) || Number(text) < 250 || Number(text) > 1000))
            throw new Error('Jog duration must be 250–1000 milliseconds');
        // Drain the old endpoint before changing its settings.
        await this.session.cancel();
        this.storage.setItem(key, text);
        await this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async release(): Promise<void> {
        try {
            await this.session.release();
        } finally {
            super.release();
        }
    }

    private async getE1Settings(): Promise<Setting[]> {
        const group = 'Aqara E1 Local PTZ';
        return [
            {
                group,
                key: 'host',
                title: 'Camera IPv4',
                value: this.storage.getItem('host') || '',
                description: 'The E1 address, not the go2rtc or Scrypted host.'
            },
            {
                group,
                key: 'did',
                title: 'Camera DID',
                value: this.storage.getItem('did') || '',
                description: 'Optional lumi1.… identity; retained after discovery to follow address changes.'
            },
            {
                group,
                key: 'port',
                title: 'Manual control port',
                value: this.storage.getItem('port') || '',
                description: 'Leave blank for mDNS discovery. The advertised UDP port may change after a reboot.'
            },
            {
                group,
                key: 'controllerIp',
                title: 'Controller IPv4 override',
                value: this.storage.getItem('controllerIp') || '',
                description: 'For NAT containers, enter the source IPv4 the camera sees. Host networking is recommended.'
            },
            {
                group,
                type: 'number',
                key: 'jogDuration',
                title: 'Default jog (milliseconds)',
                value: Number(this.storage.getItem('jogDuration') || 300),
                description: '250–1000 ms. Direction only; no calibrated position or speed.'
            },
            { group, key: 'stop', type: 'button', title: 'Stop motor' }
        ];
    }

    private getTarget(): E1Target {
        const host = this.storage.getItem('host') || '';
        const did = this.storage.getItem('did') || '';
        const port = Number(this.storage.getItem('port')) || undefined;
        if (!host && !did) throw new Error('Set the E1 camera IPv4 or DID in Aqara E1 Local PTZ settings');
        if (port && !isIPv4(host)) throw new Error('Manual control port requires a camera IPv4');
        return { did, host, port, controllerIp: this.storage.getItem('controllerIp') || undefined };
    }
}

export { E1PtzMixin };
